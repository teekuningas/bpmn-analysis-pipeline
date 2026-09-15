// BPMN XML in, a tree of scopes out. The only file here that knows about XML.

const BPMN_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
const TASKISH = new Set(['serviceTask', 'userTask', 'manualTask', 'subProcess', 'task']);

// What this interpreter promises to understand. A file reaching outside it is
// refused by name rather than half-run.
const SUPPORTED = new Set([
  'definitions', 'process', 'property', 'extensionElements', 'documentation',
  'incoming', 'outgoing',
  'startEvent', 'endEvent', 'intermediateCatchEvent', 'boundaryEvent',
  'errorEventDefinition', 'timerEventDefinition', 'timeDuration',
  'parallelGateway', 'exclusiveGateway',
  'serviceTask', 'userTask', 'subProcess',
  'sequenceFlow', 'conditionExpression',
  'multiInstanceLoopCharacteristics', 'loopCardinality', 'loopDataOutputRef',
  'outputDataItem', 'standardLoopCharacteristics',
  'textAnnotation', 'text', 'association',
]);

const localName = (node) => node.localName || node.nodeName.replace(/^.*:/, '');
const children = (node, name) => [...node.childNodes]
  .filter((n) => n.nodeType === 1 && localName(n) === name);
const deepFind = (node, name) => [...node.getElementsByTagName('*')]
  .filter((n) => localName(n) === name);
const text = (node, name) => (children(node, name)[0] || {}).textContent;

const parseOperator = (el) => {
  const [ext] = children(el, 'extensionElements');
  const [operator] = ext ? deepFind(ext, 'serviceTaskOperator') : [];
  if (!operator) return null;
  return {
    name: operator.getAttribute('id'),
    resultVariable: operator.getAttribute('resultVariable'),
    params: Object.fromEntries(deepFind(operator, 'parameter')
      .map((p) => [p.getAttribute('id'), p.getAttribute('value')])),
  };
};

const parseLoop = (el) => {
  const [mi] = children(el, 'multiInstanceLoopCharacteristics');
  if (mi) {
    return {
      sequential: mi.getAttribute('isSequential') === 'true',
      cardinality: text(mi, 'loopCardinality'),
      outputRef: text(mi, 'loopDataOutputRef'),
      outputItem: (children(mi, 'outputDataItem')[0] || {}).getAttribute?.('name'),
    };
  }
  const [std] = children(el, 'standardLoopCharacteristics');
  return std ? { cardinality: std.getAttribute('loopMaximum'), standard: true } : null;
};

const parseTimer = (el) => {
  const [def] = children(el, 'timerEventDefinition');
  const match = def && String(text(def, 'timeDuration')).match(/PT([\d.]+)S/);
  return match ? Number(match[1]) * 1000 : null;
};

function parseScope(node) {
  const elements = new Map();
  const flows = [];

  for (const child of [...node.childNodes].filter((n) => n.nodeType === 1)) {
    const type = localName(child);
    if (type === 'sequenceFlow') {
      flows.push({
        source: child.getAttribute('sourceRef'),
        target: child.getAttribute('targetRef'),
        condition: text(child, 'conditionExpression') || null,
      });
    } else if (TASKISH.has(type) || type.endsWith('Event') || type.endsWith('Gateway')) {
      const id = child.getAttribute('id');
      elements.set(id, {
        id,
        type,
        name: child.getAttribute('name') || '',
        attachedTo: child.getAttribute('attachedToRef'),
        retries: Number(child.getAttribute('retries') || 3),
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

  return {
    elements,
    boundaries: new Map([...elements.values()]
      .filter((el) => el.attachedTo).map((el) => [el.attachedTo, el])),
    startIds: [...elements.values()]
      .filter((el) => !el.incoming.length && !el.attachedTo).map((el) => el.id),
  };
}

const unsupported = (doc) => [...new Set([...doc.getElementsByTagNameNS(BPMN_NS, '*')]
  .map(localName).filter((name) => !SUPPORTED.has(name)))].sort();

export function parseBpmn(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error(`invalid BPMN XML: ${err.textContent}`);

  const outside = unsupported(doc);
  if (outside.length) {
    throw new Error(`this runner does not understand ${outside.join(', ')} — the process `
      + 'uses more of BPMN than the toy engine covers');
  }

  const processes = new Map([...doc.getElementsByTagNameNS(BPMN_NS, 'process')]
    .map((proc) => [proc.getAttribute('id'), parseScope(proc)]));
  if (!processes.size) throw new Error('no process in this file');
  return processes;
}

/** Every element in a scope, outermost first, each with the path down to it. */
export function walk(scope, path = [], found = []) {
  for (const el of scope.elements.values()) {
    const here = [...path, el];
    found.push({ el, path: here });
    if (el.scope) walk(el.scope, here, found);
  }
  return found;
}

export const everyElement = (processes) => [...processes.values()].flatMap((scope) => walk(scope));
