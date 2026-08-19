// Wires the diagram, the engine and the page together.
//
// Everything here is presentation. The pipeline itself does not know a browser
// exists -- swap this file for a CLI and the same .bpmn and the same registry
// would run unchanged.

import { parseBpmn, Engine } from './engine.js';
import { getOp, catalog } from './registry.js';
import { ArtifactStore } from './artifacts.js';
import './ops.js'; // registers every op as a side effect

const BPMN_URL = 'workflows/pipeline.bpmn';
const PROCESS_ID = 'Process_NatureNarratives';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let viewer;
let processes;
let calls = new Map();     // elementId -> { op, params, result, instances }
let overlayIds = [];
const progressState = new Map();

// ------------------------------------------------------------------ diagram --

async function loadDiagram() {
  const xml = await (await fetch(BPMN_URL)).text();
  processes = parseBpmn(xml);

  viewer = new BpmnJS({ container: '#canvas' });
  await viewer.importXML(xml);
  viewer.get('canvas').zoom('fit-viewport', 'auto');
  viewer.get('eventBus').on('element.click', (e) => inspect(e.element.id));
}

function mark(id, cls) {
  try { viewer.get('canvas').addMarker(id, cls); } catch { /* not on the diagram */ }
}
function unmark(id, cls) {
  try { viewer.get('canvas').removeMarker(id, cls); } catch { /* ignore */ }
}

function clearDiagram() {
  const overlays = viewer.get('overlays');
  overlayIds.forEach((id) => overlays.remove(id));
  overlayIds = [];
  progressState.clear();
  for (const scope of processes.values()) markAllScopes(scope, unmark);
}
function markAllScopes(scope, fn) {
  for (const el of scope.elements.values()) {
    ['pipeline-active', 'pipeline-done', 'pipeline-waiting'].forEach((c) => fn(el.id, c));
    if (el.scope) markAllScopes(el.scope, fn);
  }
}

function badgeProgress(element, evt) {
  const overlays = viewer.get('overlays');
  const old = progressState.get(element.id);
  if (old !== undefined) overlays.remove(old);
  const id = overlays.add(element.id, {
    position: { top: -12, right: 12 },
    html: `<span class="mi-badge">${evt.index}/${evt.total}</span>`,
  });
  progressState.set(element.id, id);
  overlayIds.push(id);
}

// ---------------------------------------------------------------- inspector --

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function inspect(elementId) {
  const call = calls.get(elementId);
  const box = $('inspector');
  if (!call) {
    box.className = 'hint';
    box.textContent = 'No call recorded for this element yet.';
    return;
  }
  const op = catalog().find((o) => o.name === call.op);
  box.className = '';
  box.innerHTML = `
    <div class="op">${escapeHtml(call.op)}</div>
    <p style="margin:4px 0 8px">${op ? escapeHtml(op.summary) : ''}</p>
    ${call.instances > 1 ? `<p class="hint">ran ${call.instances}x (multi-instance)</p>` : ''}
    <strong style="font-size:12px">parameters</strong>
    <pre>${escapeHtml(JSON.stringify(call.params, null, 2))}</pre>
    <strong style="font-size:12px">result</strong>
    <pre>${escapeHtml(JSON.stringify(call.result, null, 2))}</pre>`;
}

// --------------------------------------------------------------------- log --

function log(line) {
  const el = $('log');
  el.textContent += `${line}\n`;
  el.scrollTop = el.scrollHeight;
}

// --------------------------------------------------------------- user task --

function askUser(element, data) {
  return new Promise((resolve) => {
    const form = element.form;
    const slot = $('question-slot');
    slot.innerHTML = `
      <div class="question">
        <h3>${escapeHtml(element.name)}</h3>
        <p>${escapeHtml(form.label)}. The pipeline is waiting &mdash; this step is a
           person's judgement call, so the diagram says so out loud.
           ${data.pooled ? `${data.pooled.n} codes were pooled.` : ''}</p>
        <input type="number" id="q-value" value="0.22"
               min="${form.min}" max="${form.max}" step="${form.step}"/>
        <p style="margin-top:10px"><button id="q-ok">Continue</button></p>
      </div>`;
    $('q-ok').onclick = () => {
      const value = parseFloat($('q-value').value);
      slot.innerHTML = '';
      log(`threshold set to ${value} by the analyst`);
      resolve(value);
    };
  });
}

// --------------------------------------------------------------------- run --

async function run() {
  $('run').disabled = true;
  $('log').textContent = '';
  $('results').className = 'hint';
  $('results').textContent = 'running...';
  calls = new Map();
  clearDiagram();

  const store = new ArtifactStore();
  const delay = () => sleep(Number($('in-delay').value));

  const services = {
    store,
    getOp,
    log,
    onUserTask: async (element, data) => {
      mark(element.id, 'pipeline-waiting');
      const value = await askUser(element, data);
      unmark(element.id, 'pipeline-waiting');
      calls.set(element.id, {
        op: '(human decision)', params: { field: element.form.field }, result: value,
      });
      return value;
    },
    onEvent: async (evt) => {
      const { element } = evt;
      if (evt.type === 'enter') {
        mark(element.id, 'pipeline-active');
        await delay();
      } else if (evt.type === 'exit') {
        unmark(element.id, 'pipeline-active');
        mark(element.id, 'pipeline-done');
      } else if (evt.type === 'progress') {
        badgeProgress(element, evt);
        await delay();
      } else if (evt.type === 'call') {
        const prev = calls.get(element.id);
        calls.set(element.id, {
          op: evt.op,
          params: evt.params,
          result: prev ? prev.result : null,
          instances: (prev ? prev.instances || 1 : 0) + 1,
        });
      } else if (evt.type === 'result') {
        const prev = calls.get(element.id) || {};
        calls.set(element.id, { ...prev, result: evt.result });
      }
    },
  };

  const engine = new Engine(processes, services);
  const inputs = {
    data_path: 'demo/data',
    filter_mode: $('in-filter-mode').value,
    min_words: 20,
    seed: Number($('in-seed').value),
    min_cluster_size: Number($('in-min-cluster').value),
    prevalence_min: Number($('in-prev-min').value),
    prevalence_max: Number($('in-prev-max').value),
    alpha: Number($('in-alpha').value),
    context_variable: 'site',
    top_n: 12,
  };

  try {
    const data = await engine.run(PROCESS_ID, { inputs });
    showResults(store, data);
    log('done.');
  } catch (err) {
    log(`ERROR: ${err.message}`);
    $('results').textContent = `Failed: ${err.message}`;
    throw err;
  } finally {
    $('run').disabled = false;
  }
}

function showResults(store, data) {
  const report = store.get(data.report);
  const box = $('results');
  if (!report.rows.length) {
    box.textContent = 'No associations found.';
    return;
  }
  box.className = '';
  box.innerHTML = `
    <p class="hint" style="margin-top:0">${data.matrix.themes.length} themes x
      ${data.context.levels.join(' / ')}, n = ${report.n_records} narratives.
      Green rows survive FDR correction.</p>
    <table>
      <tr><th>theme</th><th>context</th><th class="num">in</th><th class="num">out</th>
          <th class="num">V</th><th class="num">p</th><th class="num">q</th></tr>
      ${report.rows.map((r) => `
        <tr class="${r.significant ? 'sig' : ''}">
          <td>${escapeHtml(r.theme)}</td><td>${escapeHtml(r.predictor)}</td>
          <td class="num">${r.prevalence_in}</td><td class="num">${r.prevalence_out}</td>
          <td class="num">${r.cramers_v}</td><td class="num">${r.p_value}</td>
          <td class="num">${r.p_fdr}</td>
        </tr>`).join('')}
    </table>`;
}

function renderRegistry() {
  $('registry').innerHTML = catalog().map((o) => `
    <div style="margin-bottom:10px">
      <div class="op">${o.name}${o.callsLlm
    ? ' <span class="mi-badge" style="background:var(--muted)">llm</span>' : ''}</div>
      <div style="font-size:12px;color:var(--muted)">${escapeHtml(o.summary)}</div>
      <div style="font-size:11.5px;color:var(--muted);font-family:ui-monospace,monospace">
        (${Object.keys(o.params || {}).join(', ')})</div>
    </div>`).join('');
}

// -------------------------------------------------------------------- boot --

await loadDiagram();
renderRegistry();
$('run').onclick = () => run().catch((e) => console.error(e));
$('reset').onclick = () => {
  clearDiagram();
  calls = new Map();
  $('log').textContent = '';
  $('results').className = 'hint';
  $('results').textContent = 'Run the pipeline to get results.';
  $('inspector').className = 'hint';
  $('inspector').textContent = 'Click any task in the diagram to see the op it calls.';
};
log(`${catalog().length} ops registered`);
