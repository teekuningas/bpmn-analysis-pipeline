// Minimal BPMN interpreter: events, tasks, gateways, sub-processes,
// multi-instance and standard loops, error boundaries, timers.

const BPMN_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
const TASKISH = new Set(['serviceTask', 'userTask', 'manualTask', 'subProcess', 'task']);

const localName = (node) => node.localName || node.nodeName.replace(/^.*:/, '');
const children = (node, name) => [...node.childNodes]
  .filter((n) => n.nodeType === 1 && localName(n) === name);
const deepFind = (node, name) => [...node.getElementsByTagName('*')]
  .filter((n) => localName(n) === name);
const text = (node, name) => (children(node, name)[0] || {}).textContent;

function parseOperator(el) {
  const [ext] = children(el, 'extensionElements');
  const [operator] = ext ? deepFind(ext, 'serviceTaskOperator') : [];
  if (!operator) return null;
  const params = {};
  for (const p of deepFind(operator, 'parameter')) params[p.getAttribute('id')] = p.getAttribute('value');
  return { name: operator.getAttribute('id'), resultVariable: operator.getAttribute('resultVariable'), params };
}

function parseLoop(el) {
  const [mi] = children(el, 'multiInstanceLoopCharacteristics');
  if (mi) {
    return {
      cardinality: text(mi, 'loopCardinality'),
      outputRef: text(mi, 'loopDataOutputRef'),
      outputItem: (children(mi, 'outputDataItem')[0] || {}).getAttribute?.('name'),
    };
  }
  const [std] = children(el, 'standardLoopCharacteristics');
  return std ? { cardinality: std.getAttribute('loopMaximum') } : null;
}

function parseTimer(el) {
  const [def] = children(el, 'timerEventDefinition');
  const duration = def && text(def, 'timeDuration');
  const match = duration && duration.match(/PT([\d.]+)S/);
  return match ? Number(match[1]) * 1000 : null;
}

function parseScope(node) {
  const elements = new Map();
  const flows = [];

  for (const child of [...node.childNodes].filter((n) => n.nodeType === 1)) {
    const type = localName(child);
    const id = child.getAttribute('id');
    if (type === 'sequenceFlow') {
      flows.push({
        source: child.getAttribute('sourceRef'),
        target: child.getAttribute('targetRef'),
        condition: text(child, 'conditionExpression') || null,
      });
    } else if (TASKISH.has(type) || type.endsWith('Event') || type.endsWith('Gateway')) {
      elements.set(id, {
        id,
        type,
        name: child.getAttribute('name') || '',
        attachedTo: child.getAttribute('attachedToRef'),
        timer: parseTimer(child),
        op: parseOperator(child),
        loop: parseLoop(child),
        scope: type === 'subProcess' ? parseScope(child) : null,
        incoming: [],
        outgoing: [],
      });
    }
  }

  for (const flow of flows) {
    elements.get(flow.source)?.outgoing.push(flow);
    elements.get(flow.target)?.incoming.push(flow);
  }

  const boundaries = new Map();
  for (const el of elements.values()) if (el.attachedTo) boundaries.set(el.attachedTo, el);

  return {
    elements,
    boundaries,
    startIds: [...elements.values()]
      .filter((e) => !e.incoming.length && !e.attachedTo)
      .map((e) => e.id),
  };
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

// The one helper an expression may use: how many are in a value, whether it
// arrived as a collected list or as a single result.
const HELPERS = {
  count: (value) => (Array.isArray(value) ? value.length : value?.count ?? 1),
};

function evaluate(expression, data) {
  const scope = { ...data, ...HELPERS };
  const keys = Object.keys(scope).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k));
  try {
    return new Function(...keys, `"use strict"; return (${expression});`)(...keys.map((k) => scope[k]));
  } catch (cause) {
    throw new Error(`cannot evaluate "${expression}": ${cause.message}`);
  }
}

export class Engine {
  constructor(processes, services) {
    this.processes = processes;
    this.services = services;
  }

  async run(processId, data) {
    await this.runScope(this.processes.get(processId), data);
    return data;
  }

  async runScope(scope, data) {
    const arrivals = new Map();
    const queue = [...scope.startIds];

    while (queue.length) {
      const el = scope.elements.get(queue.shift());

      if (el.type === 'parallelGateway' && el.incoming.length > 1) {
        const seen = (arrivals.get(el.id) || 0) + 1;
        arrivals.set(el.id, seen);
        if (seen < el.incoming.length) continue;
      }

      try {
        await this.execute(el, data);
      } catch (err) {
        const handler = scope.boundaries.get(el.id);
        if (!handler) throw err;
        await this.execute(handler, data);
        queue.push(...handler.outgoing.map((f) => f.target));
        continue;
      }

      queue.push(...this.successors(el, data).map((f) => f.target));
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
    await this.services.onEvent({ type: 'enter', element: el });
    if (el.loop) await this.runLoop(el, data);
    else await this.executeBody(el, data);
    await this.services.onEvent({ type: 'exit', element: el });
  }

  // A multi-instance loop isolates each instance and collects the results.
  // A standard loop is plain repetition over the same data.
  async runLoop(el, data) {
    const total = Number(evaluate(el.loop.cardinality, data));
    const collects = Boolean(el.loop.outputRef);
    const collected = [];

    for (let i = 0; i < total; i++) {
      const scoped = collects ? { ...data } : data;
      const result = await this.executeBody(el, scoped);
      if (collects) collected.push(el.loop.outputItem ? scoped[el.loop.outputItem] : result);
      await this.services.onEvent({ type: 'progress', element: el, index: i + 1, total });
    }

    if (collects) data[el.loop.outputRef] = collected;
  }

  async executeBody(el, data) {
    if (el.timer) return this.services.wait(el.timer);
    if (el.scope) return this.runScope(el.scope, data);
    if (!el.op) return undefined;

    const params = Object.fromEntries(
      Object.entries(el.op.params).map(([k, expr]) => [k, evaluate(expr, data)]),
    );
    const result = await this.services.call(el.op.name, params, el);
    if (el.op.resultVariable) data[el.op.resultVariable] = result;
    return result;
  }
}
