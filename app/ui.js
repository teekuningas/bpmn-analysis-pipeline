import { parseBpmn, Engine } from './engine.js';
import { PRIMITIVES, TYPES, getPrimitive, generic } from './primitives.js';
import { analyse } from './types.js';

const BPMN_URL = 'workflows/pipeline.bpmn';
const PROCESS_ID = 'Process_Pipeline';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms) => ms * (0.85 + Math.random() * 0.3);

let viewer;
let processes;
let model;
let running = false;
const badges = new Map();

async function loadDiagram() {
  const xml = await (await fetch(BPMN_URL)).text();
  processes = parseBpmn(xml);
  model = analyse(processes);
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
    if (running) return;
    if (element.type === 'bpmn:SequenceFlow') carries(element.source?.id);
    else describe(element.id);
  });
  bus.on('element.out', () => { if (!running) caption(); });
}

function eachElement(scope, fn) {
  for (const el of scope.elements.values()) {
    fn(el);
    if (el.scope) eachElement(el.scope, fn);
  }
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

// What the modeller fills in, as opposed to what flows in or what comes out.
const SETTINGS = ['prompt', 'question', 'source', 'where', 'test', 'metric', 'by', 'how', 'on', 'model'];

function caption({ label = '', signature = '', shape = '', loop = '', setting = '' } = {}) {
  $('caption').innerHTML = label
    ? `<div class="line"><span class="label">${label}</span>`
      + (signature ? `<span class="sig">${signature}</span>` : '')
      + (shape ? `<span class="shape">${shape}</span>` : '')
      + '</div>'
      + (loop ? `<div class="loop">${loop}</div>` : '')
      + (setting ? `<div class="setting">${setting}</div>` : '')
    : '';
}

function describe(id) {
  const el = find(id);
  const known = model.info.get(id);
  if (!known) {
    // Events and gateways make nothing; say their name, or say nothing.
    caption(el?.name ? { label: el.name, setting: el.timer ? `${el.timer / 1000} seconds` : '' } : {});
    return;
  }
  caption({
    label: known.label || el.name,
    signature: known.signature,
    shape: known.signature ? known.generic : '',
    loop: known.loop,
    setting: el.op ? settings(el.op.params) : '',
  });
}

/** Hovering an arrow: the value that has just been made, and its type. */
function carries(sourceId) {
  const gives = model.info.get(sourceId)?.gives;
  caption(gives ? { label: gives.name, signature: gives.type } : {});
}

function settings(params) {
  return SETTINGS
    .filter((k) => params[k] !== undefined)
    .map((k) => String(params[k]).replace(/^'|'$/g, ''))
    .join(' · ');
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
    call: async (name, params, el) => {
      describe(el.id);
      await sleep(jitter(getPrimitive(name).ms));
      if (params.fails > Math.random()) throw new Error('unavailable');
      if (name === 'join') return { count: Math.min(size(params.left), size(params.right)) };
      const parts = params.parts?.flat(Infinity).map(size);
      return {
        count: params.count ?? (parts ? parts.reduce((t, n) => t + n, 0) : size(params.of)),
      };
    },
    onEvent: async ({ type, element, index, total }) => {
      if (type === 'enter') {
        mark(element.id, element.scope ? 'is-running' : 'is-active');
        if (!element.op && (model.info.has(element.id) || element.name)) describe(element.id);
        await sleep(20);
      } else if (type === 'exit') {
        unmark(element.id, 'is-active');
        unmark(element.id, 'is-running');
        mark(element.id, 'is-done');
      } else if (type === 'progress') {
        badge(element, `${index}/${total}`);
      }
    },
  };

  await new Engine(processes, services).run(PROCESS_ID, {});
  caption();
  running = false;
  $('run').disabled = false;
  $('run').textContent = 'Run again';
}

function light(ids) {
  for (const scope of processes.values()) {
    eachElement(scope, (el) => { if (ids.has(el.id)) mark(el.id, 'is-lit'); });
  }
}

function unlight() {
  for (const scope of processes.values()) eachElement(scope, (el) => unmark(el.id, 'is-lit'));
}

function renderLegend() {
  $('legend').innerHTML = Object.entries(PRIMITIVES)
    .map(([name, p]) => `<span data-name="${name}"${p.model ? ' class="model"' : ''}>${p.label}</span>`)
    .join('');

  $('legend').onmouseover = ({ target }) => {
    const { name } = target.dataset;
    if (!name || running) return;
    const primitive = getPrimitive(name);
    caption({ label: primitive.label, shape: generic(primitive), setting: primitive.note });
    const ids = new Set();
    for (const scope of processes.values()) {
      eachElement(scope, (el) => { if (el.op?.name === name) ids.add(el.id); });
    }
    light(ids);
  };
  $('legend').onmouseout = () => {
    if (running) return;
    caption();
    unlight();
  };
}

/** The types this model names, the modeller's first and the constructors last. */
function renderTypes() {
  const order = Object.keys(TYPES);
  const rank = (name) => (order.includes(name) ? order.indexOf(name) : order.length);
  const used = [...model.mentions.keys()].sort((a, b) => rank(a) - rank(b));
  $('types').innerHTML = used
    .map((name) => `<span data-type="${name}">${name}</span>`)
    .join('');

  $('types').onmouseover = ({ target }) => {
    const name = target.dataset.type;
    if (!name || running) return;
    caption({ label: name, setting: TYPES[name] || '' });
    light(model.mentions.get(name) || new Set());
  };
  $('types').onmouseout = () => {
    if (running) return;
    caption();
    unlight();
  };
}

await loadDiagram();
renderLegend();
renderTypes();

if (model.problems.length) {
  $('caption').innerHTML = model.problems.map((p) => `<div class="problem">${p}</div>`).join('');
  $('run').disabled = true;
}
$('run').onclick = () => run();
