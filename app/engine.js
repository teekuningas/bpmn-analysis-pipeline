// A deliberately small BPMN interpreter (~200 lines, no dependencies).
//
// It understands the subset this pipeline needs:
//   start / end events, service tasks, user tasks,
//   parallel gateways (fork + join), exclusive gateways,
//   expanded sub-processes, and multi-instance loops on both tasks and
//   sub-processes.
//
// It is NOT a production engine -- for that use SpiffWorkflow (Python) or
// bpmn-engine (Node), which handle timers, messages, compensation, transactions
// and persistence. The XML here follows SpiffWorkflow's spiff:serviceTaskOperator
// convention on purpose, so the same .bpmn file can be handed to a real engine.

const BPMN_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';

const TASKISH = new Set(['serviceTask', 'userTask', 'subProcess', 'task', 'scriptTask']);

// ------------------------------------------------------------------ parsing --

function localName(node) {
  return node.localName || node.nodeName.replace(/^.*:/, '');
}

function children(node, name) {
  return [...node.childNodes].filter((n) => n.nodeType === 1 && localName(n) === name);
}

function deepFind(node, name) {
  return [...node.getElementsByTagName('*')].filter((n) => localName(n) === name);
}

function parseOperator(el) {
  const [ext] = children(el, 'extensionElements');
  if (!ext) return null;
  const [operator] = deepFind(ext, 'serviceTaskOperator');
  if (!operator) return null;
  const params = {};
  for (const p of deepFind(operator, 'parameter')) {
    params[p.getAttribute('id')] = p.getAttribute('value');
  }
  return {
    name: operator.getAttribute('id'),
    resultVariable: operator.getAttribute('resultVariable'),
    params,
  };
}

function parseForm(el) {
  const [ext] = children(el, 'extensionElements');
  if (!ext) return null;
  const [form] = deepFind(ext, 'form');
  if (!form) return null;
  return {
    field: form.getAttribute('field'),
    type: form.getAttribute('type') || 'number',
    min: form.getAttribute('min'),
    max: form.getAttribute('max'),
    step: form.getAttribute('step'),
    label: form.getAttribute('label') || form.getAttribute('field'),
  };
}

function parseMultiInstance(el) {
  const [mi] = children(el, 'multiInstanceLoopCharacteristics');
  if (!mi) return null;
  const text = (name) => (children(mi, name)[0] || {}).textContent;
  const itemName = (name) => {
    const [n] = children(mi, name);
    return n && n.getAttribute('name');
  };
  return {
    sequential: mi.getAttribute('isSequential') === 'true',
    inputRef: text('loopDataInputRef'),
    inputItem: itemName('inputDataItem'),
    outputRef: text('loopDataOutputRef'),
    outputItem: itemName('outputDataItem'),
  };
}

function parseScope(node) {
  const elements = new Map();
  const flows = [];

  for (const child of [...node.childNodes].filter((n) => n.nodeType === 1)) {
    const type = localName(child);
    const id = child.getAttribute('id');
    if (type === 'sequenceFlow') {
      flows.push({
        id,
        source: child.getAttribute('sourceRef'),
        target: child.getAttribute('targetRef'),
        condition: (children(child, 'conditionExpression')[0] || {}).textContent || null,
      });
    } else if (TASKISH.has(type) || type.endsWith('Event') || type.endsWith('Gateway')) {
      elements.set(id, {
        id,
        type,
        name: child.getAttribute('name') || id,
        op: type === 'serviceTask' ? parseOperator(child) : null,
        form: type === 'userTask' ? parseForm(child) : null,
        mi: parseMultiInstance(child),
        scope: type === 'subProcess' ? parseScope(child) : null,
        incoming: [],
        outgoing: [],
      });
    }
  }

  for (const flow of flows) {
    const src = elements.get(flow.source);
    const dst = elements.get(flow.target);
    if (src) src.outgoing.push(flow);
    if (dst) dst.incoming.push(flow);
  }

  const starts = [...elements.values()].filter((e) => e.incoming.length === 0);
  return { elements, flows, startIds: starts.map((e) => e.id) };
}

export function parseBpmn(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error(`invalid BPMN XML: ${err.textContent}`);
  const processes = new Map();
  for (const proc of doc.getElementsByTagNameNS(BPMN_NS, 'process')) {
    processes.set(proc.getAttribute('id'), parseScope(proc));
  }
  return processes;
}

// ---------------------------------------------------------------- execution --

/** Evaluate a BPMN expression against the current workflow data. */
export function evaluate(expression, data) {
  const keys = Object.keys(data).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k));
  try {
    // eslint-disable-next-line no-new-func
    return new Function(...keys, `"use strict"; return (${expression});`)(...keys.map((k) => data[k]));
  } catch (cause) {
    throw new Error(`could not evaluate BPMN expression "${expression}": ${cause.message}`);
  }
}

export class Engine {
  /**
   * @param {Map} processes     from parseBpmn()
   * @param {object} services   { getOp, store, log, onEvent, onUserTask }
   */
  constructor(processes, services) {
    this.processes = processes;
    this.services = services;
  }

  async run(processId, data) {
    const scope = this.processes.get(processId);
    if (!scope) throw new Error(`no process "${processId}" in this BPMN file`);
    await this.runScope(scope, data);
    return data;
  }

  async runScope(scope, data) {
    const arrivals = new Map();
    const queue = [...scope.startIds];

    while (queue.length) {
      const el = scope.elements.get(queue.shift());

      // A join waits until every incoming branch has arrived.
      if (el.incoming.length > 1 && el.type === 'parallelGateway') {
        const seen = (arrivals.get(el.id) || 0) + 1;
        arrivals.set(el.id, seen);
        if (seen < el.incoming.length) continue;
      }

      await this.execute(el, data);

      for (const flow of this.successors(el, data)) queue.push(flow.target);
    }
  }

  successors(el, data) {
    if (el.type === 'exclusiveGateway' && el.outgoing.length > 1) {
      const taken = el.outgoing.find((f) => f.condition && evaluate(f.condition, data));
      return [taken || el.outgoing.find((f) => !f.condition)].filter(Boolean);
    }
    return el.outgoing;
  }

  async execute(el, data) {
    const { onEvent } = this.services;
    await onEvent({ type: 'enter', element: el, data });

    if (el.mi) await this.runMultiInstance(el, data);
    else await this.executeBody(el, data);

    await onEvent({ type: 'exit', element: el, data });
  }

  /** One multi-instance activity: run its body once per item in a collection. */
  async runMultiInstance(el, data) {
    const items = evaluate(el.mi.inputRef, data);
    if (!Array.isArray(items)) {
      throw new Error(`multi-instance input "${el.mi.inputRef}" is not a list`);
    }
    const collected = [];
    for (let i = 0; i < items.length; i++) {
      const scoped = { ...data, [el.mi.inputItem]: items[i], loopIndex: i };
      const result = await this.executeBody(el, scoped);
      const value = el.mi.outputItem ? scoped[el.mi.outputItem] : result;
      if (value !== undefined) collected.push(value);
      await this.services.onEvent({
        type: 'progress', element: el, index: i + 1, total: items.length, item: items[i],
      });
    }
    if (el.mi.outputRef) data[el.mi.outputRef] = collected;
  }

  async executeBody(el, data) {
    switch (el.type) {
      case 'serviceTask': {
        if (!el.op) throw new Error(`service task "${el.name}" has no operator`);
        const op = this.services.getOp(el.op.name);
        const params = Object.fromEntries(
          Object.entries(el.op.params).map(([k, expr]) => [k, evaluate(expr, data)]),
        );
        await this.services.onEvent({ type: 'call', element: el, op: el.op.name, params });
        const result = await op.run(params, this.services);
        if (el.op.resultVariable) data[el.op.resultVariable] = result;
        await this.services.onEvent({ type: 'result', element: el, op: el.op.name, result });
        return result;
      }
      case 'userTask': {
        const value = await this.services.onUserTask(el, data);
        if (el.form) data[el.form.field] = value;
        return value;
      }
      case 'subProcess':
        return this.runScope(el.scope, data);
      default:
        return undefined; // events and gateways carry no work in this subset
    }
  }
}
