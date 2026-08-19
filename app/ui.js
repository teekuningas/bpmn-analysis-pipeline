import { parseBpmn, Engine } from './engine.js';
import { getOp, catalog } from './registry.js';
import { ArtifactStore } from './artifacts.js';
import './ops.js';

const BPMN_URL = 'workflows/pipeline.bpmn';
const PROCESS_ID = 'Process_NatureNarratives';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const escapeHtml = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

let viewer;
let processes;
let calls = new Map();
let overlayIds = [];
const progressState = new Map();

async function loadDiagram() {
  const xml = await (await fetch(BPMN_URL)).text();
  processes = parseBpmn(xml);
  viewer = new BpmnJS({ container: '#canvas' });
  await viewer.importXML(xml);
  viewer.get('canvas').zoom('fit-viewport', 'auto');
  viewer.get('eventBus').on('element.click', (e) => inspect(e.element.id));
}

function mark(id, cls) {
  try { viewer.get('canvas').addMarker(id, cls); } catch { /* off-diagram */ }
}
function unmark(id, cls) {
  try { viewer.get('canvas').removeMarker(id, cls); } catch { /* off-diagram */ }
}

function eachElement(scope, fn) {
  for (const el of scope.elements.values()) {
    fn(el);
    if (el.scope) eachElement(el.scope, fn);
  }
}

function clearDiagram() {
  const overlays = viewer.get('overlays');
  overlayIds.forEach((id) => overlays.remove(id));
  overlayIds = [];
  progressState.clear();
  for (const scope of processes.values()) {
    eachElement(scope, (el) => ['pipeline-active', 'pipeline-done', 'pipeline-waiting']
      .forEach((c) => unmark(el.id, c)));
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

function inspect(elementId) {
  const call = calls.get(elementId);
  const box = $('inspector');
  if (!call) {
    box.className = 'hint';
    box.textContent = 'Nothing recorded for this element.';
    return;
  }
  const op = catalog().find((o) => o.name === call.op);
  box.className = '';
  box.innerHTML = `
    <div class="op">${escapeHtml(call.op)}</div>
    <p style="margin:4px 0 8px">${op ? escapeHtml(op.summary) : ''}</p>
    ${call.instances > 1 ? `<p class="hint">ran ${call.instances}x</p>` : ''}
    <pre>${escapeHtml(JSON.stringify(call.params, null, 2))}</pre>
    <pre>${escapeHtml(JSON.stringify(call.result, null, 2))}</pre>`;
}

function log(line) {
  const el = $('log');
  el.textContent += `${line}\n`;
  el.scrollTop = el.scrollHeight;
}

function askUser(element, data) {
  return new Promise((resolve) => {
    const { form } = element;
    $('question-slot').innerHTML = `
      <div class="question">
        <h3>${escapeHtml(element.name)}</h3>
        <p>${escapeHtml(form.label)}${data.pooled ? `, over ${data.pooled.n} codes` : ''}.</p>
        <input type="number" id="q-value" value="0.22"
               min="${form.min}" max="${form.max}" step="${form.step}"/>
        <p style="margin-top:10px"><button id="q-ok">Continue</button></p>
      </div>`;
    $('q-ok').onclick = () => {
      const value = parseFloat($('q-value').value);
      $('question-slot').innerHTML = '';
      log(`threshold ${value}`);
      resolve(value);
    };
  });
}

function showResults(store, data) {
  const report = store.get(data.report);
  const box = $('results');
  if (!report.rows.length) {
    box.textContent = 'No associations.';
    return;
  }
  box.className = '';
  box.innerHTML = `
    <p class="hint" style="margin-top:0">${data.matrix.themes.length} themes,
      ${data.context.levels.join(' / ')}, n = ${report.n_records}.</p>
    <table>
      <tr><th>theme</th><th>context</th><th class="num">in</th><th class="num">out</th>
          <th class="num">p</th><th class="num">q</th></tr>
      ${report.rows.map((r) => `
        <tr class="${r.significant ? 'sig' : ''}">
          <td>${escapeHtml(r.theme)}</td><td>${escapeHtml(r.predictor)}</td>
          <td class="num">${r.prevalence_in}</td><td class="num">${r.prevalence_out}</td>
          <td class="num">${r.p_value}</td><td class="num">${r.p_fdr}</td>
        </tr>`).join('')}
    </table>`;
}

function renderRegistry() {
  $('registry').innerHTML = catalog().map((o) => `
    <div style="margin-bottom:10px">
      <div class="op">${o.name}${o.callsLlm ? ' <span class="tag">llm</span>' : ''}</div>
      <div class="hint">${escapeHtml(o.summary)}</div>
    </div>`).join('');
}

async function run() {
  $('run').disabled = true;
  $('log').textContent = '';
  $('results').className = 'hint';
  $('results').textContent = 'running';
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
      calls.set(element.id, { op: 'human decision', params: { field: element.form.field }, result: value });
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
        calls.set(element.id, { ...(calls.get(element.id) || {}), result: evt.result });
      }
    },
  };

  const iterations = Number($('in-iterations').value);
  const inputs = {
    data_path: 'demo/data',
    filter_mode: $('in-filter-mode').value,
    min_words: 20,
    seeds: Array.from({ length: iterations }, (_, i) => i + 1),
    min_cluster_size: Number($('in-min-cluster').value),
    prevalence_min: Number($('in-prev-min').value),
    prevalence_max: Number($('in-prev-max').value),
    test: $('in-test').value,
    alpha: Number($('in-alpha').value),
    context_variable: 'site',
    top_n: 12,
  };

  try {
    const data = await new Engine(processes, services).run(PROCESS_ID, { inputs });
    showResults(store, data);
    log('done');
  } catch (err) {
    log(`error: ${err.message}`);
    $('results').textContent = err.message;
    throw err;
  } finally {
    $('run').disabled = false;
  }
}

await loadDiagram();
renderRegistry();
$('run').onclick = () => run().catch((e) => console.error(e));
$('reset').onclick = () => {
  clearDiagram();
  calls = new Map();
  $('log').textContent = '';
  $('results').className = 'hint';
  $('results').textContent = 'Run to get results.';
  $('inspector').className = 'hint';
  $('inspector').textContent = 'Click a task.';
};
