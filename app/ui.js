import { parseBpmn, Engine } from './engine.js';
import { getPrimitive } from './primitives.js';

const BPMN_URL = 'workflows/pipeline.bpmn';
const PROCESS_ID = 'Process_Pipeline';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms) => ms * (0.85 + Math.random() * 0.3);

let viewer;
let processes;
let running = false;
const badges = new Map();

async function loadDiagram() {
  const xml = await (await fetch(BPMN_URL)).text();
  processes = parseBpmn(xml);
  viewer = new BpmnJS({ container: '#canvas' });
  await viewer.importXML(xml);
  viewer.get('canvas').zoom('fit-viewport', 'auto');

  const bus = viewer.get('eventBus');
  bus.on('element.hover', ({ element }) => {
    const el = running ? null : find(element.id);
    if (el?.op) show(el.op.name);
  });
  bus.on('element.out', () => { if (!running) caption(); });
}

function find(id) {
  const search = (scope) => {
    if (scope.elements.has(id)) return scope.elements.get(id);
    for (const el of scope.elements.values()) {
      const found = el.scope && search(el.scope);
      if (found) return found;
    }
    return null;
  };
  for (const scope of processes.values()) {
    const found = search(scope);
    if (found) return found;
  }
  return null;
}

function caption(label = '', signature = '') {
  $('caption').innerHTML = label
    ? `<span class="label">${label}</span><span class="sig">${signature}</span>`
    : '';
}

function show(name) {
  const primitive = getPrimitive(name);
  caption(primitive.label, primitive.signature);
}

function mark(id, cls) {
  try { viewer.get('canvas').addMarker(id, cls); } catch { /* not drawn */ }
}
function unmark(id, cls) {
  try { viewer.get('canvas').removeMarker(id, cls); } catch { /* not drawn */ }
}

function badge(element, label) {
  const overlays = viewer.get('overlays');
  if (badges.has(element.id)) overlays.remove(badges.get(element.id));
  badges.set(element.id, overlays.add(element.id, {
    position: { top: -10, right: 14 },
    html: `<span class="count">${label}</span>`,
  }));
}

function eachElement(scope, fn) {
  for (const el of scope.elements.values()) {
    fn(el);
    if (el.scope) eachElement(el.scope, fn);
  }
}

function clearDiagram() {
  const overlays = viewer.get('overlays');
  badges.forEach((id) => overlays.remove(id));
  badges.clear();
  for (const scope of processes.values()) {
    eachElement(scope, (el) => ['is-active', 'is-running', 'is-done']
      .forEach((c) => unmark(el.id, c)));
  }
}

const size = (value) => (Array.isArray(value) ? value.length : value?.count ?? 1);

async function run() {
  running = true;
  $('run').disabled = true;
  clearDiagram();

  const services = {
    wait: sleep,
    call: async (name, params) => {
      await sleep(jitter(getPrimitive(name).ms));
      if (params.fails > Math.random()) throw new Error('unavailable');
      return {
        count: params.count
          ?? (params.parts ? params.parts.flat(Infinity).reduce((t, p) => t + size(p), 0)
            : size(params.of)),
      };
    },
    onEvent: async ({ type, element, index, total }) => {
      if (type === 'enter') {
        mark(element.id, element.scope ? 'is-running' : 'is-active');
        if (element.op) show(element.op.name);
        await sleep(35);
      } else if (type === 'exit') {
        unmark(element.id, 'is-active');
        unmark(element.id, 'is-running');
        mark(element.id, 'is-done');
      } else if (type === 'progress') {
        badge(element, `${index}/${total}`);
      }
    },
  };

  await new Engine(processes, services).run(PROCESS_ID, { options: { translate: true } });
  caption();
  running = false;
  $('run').disabled = false;
  $('run').textContent = 'Run again';
}

await loadDiagram();
$('run').onclick = () => run();
setTimeout(run, 900);
