import { parseBpmn, Engine } from './engine.js';
import { PRIMITIVES, getPrimitive } from './primitives.js';

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
  const fit = () => viewer.get('canvas').zoom('fit-viewport', 'auto');
  fit();
  requestAnimationFrame(fit);
  window.addEventListener('resize', fit);

  for (const scope of processes.values()) {
    eachElement(scope, (el) => {
      if (el.op && getPrimitive(el.op.name).model) mark(el.id, 'is-model');
    });
  }

  const bus = viewer.get('eventBus');
  bus.on('element.hover', ({ element }) => {
    const el = running ? null : find(element.id);
    if (el?.op) {
      const primitive = getPrimitive(el.op.name);
      caption(primitive.label, primitive.signature, settings(el.op.params, true));
    }
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

// What the modeller fills in, as opposed to what flows in from another task.
const SETTINGS = ['prompt', 'shape', 'question', 'source', 'where', 'test', 'metric', 'by', 'how', 'on', 'model'];

function caption(label = '', signature = '', setting = '') {
  $('caption').innerHTML = label
    ? `<span class="label">${label}</span><span class="sig">${signature}</span>`
      + (setting ? `<div class="setting">${setting}</div>` : '')
    : '';
}

function settings(params, quoted = false) {
  return SETTINGS
    .filter((k) => params[k] !== undefined)
    .map((k) => (quoted ? String(params[k]).replace(/^'|'$/g, '') : params[k]))
    .join(' · ');
}

function show(name, params = {}) {
  const primitive = getPrimitive(name);
  caption(primitive.label, primitive.signature, settings(params));
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
      show(name, params);
      await sleep(jitter(getPrimitive(name).ms));
      if (params.fails > Math.random()) throw new Error('unavailable');
      const parts = params.parts?.flat(Infinity).map(size);
      if (name === 'join') return { count: Math.min(...parts) };
      return {
        count: params.count ?? (parts ? parts.reduce((t, n) => t + n, 0) : size(params.of)),
      };
    },
    onEvent: async ({ type, element, index, total }) => {
      if (type === 'enter') {
        mark(element.id, element.scope ? 'is-running' : 'is-active');
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

function renderLegend() {
  $('legend').innerHTML = Object.entries(PRIMITIVES)
    .map(([name, p]) => `<span data-name="${name}"${p.model ? ' class="model"' : ''}>${p.label}</span>`)
    .join('');

  $('legend').onmouseover = ({ target }) => {
    const { name } = target.dataset;
    if (!name || running) return;
    show(name);
    for (const scope of processes.values()) {
      eachElement(scope, (el) => { if (el.op?.name === name) mark(el.id, 'is-lit'); });
    }
  };
  $('legend').onmouseout = () => {
    if (running) return;
    caption();
    for (const scope of processes.values()) eachElement(scope, (el) => unmark(el.id, 'is-lit'));
  };
}

await loadDiagram();
renderLegend();
$('run').onclick = () => run();
