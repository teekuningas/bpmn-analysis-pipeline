// Pick a study, look at it, run it, look at what came out. The only file that
// knows there is a page.

import { TYPES, SETTINGS } from '../core/primitives.js';
import { escape } from './html.js';
import { loadStudy } from '../runtime/study.js';
import { Run } from '../runtime/run.js';
import { Diagram, renderLegend, renderTypes } from './diagram.js';
import { renderValue, renderSources, renderLog } from './inspect.js';
import {
  renderSetup, providerFor, chosen, ensureModel, ready, loadFailed, firstCost,
} from './model.js';

const $ = (id) => document.getElementById(id);

const text = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} — ${response.status}`);
  return response.text();
};

const state = {
  diagram: null, study: null, xml: null, processes: null, processId: null,
  model: null, run: null, picked: null, tab: 'data',
  // Every knob lives here rather than in the DOM, so the panel they are drawn in
  // can be closed without the run losing them.
  settings: { pace: 150 },
};

const say = (message, bad = false) => {
  $('progress').innerHTML = message ? `<span class="${bad ? 'bad' : ''}">${message}</span>` : '';
};

function openDrawer(tab) {
  state.tab = tab;
  $('drawer').hidden = false;
  for (const button of $('tabs').querySelectorAll('[data-tab]')) {
    button.classList.toggle('on', button.dataset.tab === tab);
  }
  drawPanel();
}

function drawPanel() {
  const panel = $('panel');
  if (state.tab === 'data') return renderSources(panel, state.study);
  if (state.tab === 'log') return renderLog(panel, state.run?.calls || []);
  if (state.tab === 'setup') {
    return renderSetup(panel, {
      study: state.study, settings: state.settings, onChange: showRun,
    });
  }
  return drawValue(panel);
}

function findResultElement() {
  let found = null;
  const targetVar = state.study?.chart?.of;
  state.diagram.each((el) => {
    if (el.op?.resultVariable === targetVar) found = el;
  });
  if (!found) {
    state.diagram.each((el) => {
      const type = state.model?.info?.get(el.id)?.gives?.type;
      if (type === 'collection[finding]') found = el;
    });
  }
  return found;
}

function drawValue(panel) {
  const known = state.picked && state.model.info.get(state.picked);
  if (!known) {
    panel.innerHTML = '<p class="empty">Click a box to see what it made.</p>';
    return;
  }

  const value = state.run?.valueOf(state.picked);
  const notes = state.run?.notesOf(state.picked) || [];
  const el = state.diagram.find(state.picked);
  const settingsHtml = el?.op ? SETTINGS
    .filter(k => el.op.params[k] !== undefined)
    .map(k => {
      const val = String(el.op.params[k]).replace(/^'|'$/g, '');
      return `<div class="param"><span class="param-key">${k}</span> ${escape(val)}</div>`;
    }).join('') : '';
  panel.innerHTML = `
    <h2>${known.label}</h2>
    <p class="signature">${known.signature || ''}</p>
    ${settingsHtml}
    ${known.loop ? `<p class="lede">${known.loop}</p>` : ''}
    ${notes.map((note) => `<p class="lede">${note}</p>`).join('')}
    <h3>gives <code>${known.gives?.name || ''}</code></h3>
    <div id="value"></div>`;

  if (value === undefined) $('value').innerHTML = '<p class="empty">Not made yet.</p>';
  else renderValue($('value'), value, known.gives?.type, state.study);
}

const showRun = () => {
  $('run').textContent = state.run ? 'Run again' : 'Run';
  $('run').title = `using ${chosen()}`;
  // The first Run on a real model fetches gigabytes. Saying so under the button
  // is the difference between waiting and wondering.
  $('hint').innerHTML = firstCost() ? `first run fetches the model · ${firstCost()}` : '';
};

const hold = () => new Promise((resolve) => setTimeout(resolve, state.settings.pace || 0));

function watch(provider) {
  const started = Date.now();
  let calls = 0;
  const elapsed = () => Math.round((Date.now() - started) / 1000);

  return {
    summary: () => `${calls} calls in ${elapsed()}s · ${provider.hits} cached`,
    onEvent: ({ type, element, index, total, attempt, error }) => {
      if (type === 'enter') {
        state.diagram.mark(element.id, element.scope ? 'is-running' : 'is-active');
        state.diagram.describe(element.id);
        return hold();
      }
      if (type === 'exit') {
        state.diagram.unmark(element.id, 'is-active');
        state.diagram.unmark(element.id, 'is-running');
        state.diagram.mark(element.id, 'is-done');
      } else if (type === 'progress') {
        state.diagram.badge(element.id, `${index}/${total}`);
        return hold();
      } else if (type === 'fail') {
        state.diagram.mark(element.id, 'is-failed');
        const reason = error?.message || 'gave nothing usable';
        say(`${element.id} failed (${reason}) — attempt ${attempt}`, true);
        if (state.tab === 'log') drawPanel();
      } else if (type === 'call') {
        calls += 1;
        say(`${calls} calls · ${elapsed()}s · ${provider.hits} cached`);
        if (state.tab === 'log') drawPanel();
      }
      return new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

const gb = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${(n / 1e6).toFixed(0)} MB`);

async function run() {
  $('run').hidden = true;
  $('stop').hidden = false;

  // Pressing Run is the only thing anyone should have to do: if the weights are
  // not here yet, this is where they arrive, with the progress said out loud.
  if (!ready()) {
    try {
      await ensureModel(({ done, total }) => say(`fetching the model · ${gb(done)} of ${gb(total)}`));
    } catch (err) {
      const why = loadFailed(err);
      say(why ? `the model did not load — ${why}` : 'stopped', Boolean(why));
      $('run').hidden = false;
      $('stop').hidden = true;
      if (state.tab === 'setup') drawPanel();
      return;
    }
    if (state.tab === 'setup') drawPanel();
  }

  let provider;
  try { provider = providerFor(state.study); } catch (err) { say(err.message, true); return; }

  const watcher = watch(provider);
  state.diagram.clear();
  state.diagram.frozen = true;
  say('running…');

  state.run = new Run({
    study: state.study,
    processes: state.processes,
    processId: state.processId,
    provider,
    settings: state.settings,
    onEvent: watcher.onEvent,
  });

  try {
    await state.run.start();
    say(`done · ${watcher.summary()}`);
    const resEl = findResultElement();
    if (resEl) {
      state.picked = resEl.id;
      state.diagram.select(resEl.id);
    }
    openDrawer('value');
  } catch (err) {
    if (state.run.stopped) say('stopped');
    else say(err.message, true);
  } finally {
    state.diagram.frozen = false;
    state.diagram.hint = 'Click any box to inspect its output';
    state.diagram.caption();
    $('run').hidden = false;
    $('stop').hidden = true;
    showRun();
  }
}

async function open(entry) {
  say('');
  const loaded = await loadStudy(entry.id, (file) => text(`studies/${entry.id}/${file}`));
  Object.assign(state, loaded, { run: null, picked: null });

  $('question').textContent = state.study.question || '';
  document.title = `${state.study.title} — analysis pipelines as BPMN`;

  await state.diagram.show(state.xml, state.processes, state.model);
  state.diagram.hint = 'Hover a box · click it for what it made · <b>Run</b> to compute';
  state.diagram.caption();
  renderLegend(state.diagram);
  renderTypes(state.diagram, state.study, TYPES);
  for (const { name, value } of state.study.settings) state.settings[name] = value;
  showRun();
  openDrawer(state.tab === 'setup' ? 'setup' : 'data');

  const { problems } = state.model;
  $('run').disabled = problems.length > 0;
  if (problems.length) {
    $('caption').innerHTML = problems.map((p) => `<div class="problem">${p}</div>`).join('');
  }
}

function wireResize() {
  const handle = $('resize');
  const drawer = $('drawer');
  if (!handle) return;

  let startX, startW;
  const move = (e) => {
    const width = Math.max(280, startW - (e.clientX - startX));
    drawer.style.setProperty('--drawer-width', `${width}px`);
  };
  const up = () => {
    handle.classList.remove('dragging');
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
  };
  handle.onpointerdown = (e) => {
    startX = e.clientX;
    startW = drawer.getBoundingClientRect().width;
    handle.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  };
}

async function boot() {
  // Stopping a download aborts fetches inside Transformers.js, whose own
  // internal promises then surface that as an unhandled rejection. Ours is
  // handled, and a deliberate stop is not an error.
  addEventListener('unhandledrejection', (event) => {
    if (event.reason?.name === 'AbortError') event.preventDefault();
  });


  state.diagram = new Diagram($('canvas'), {
    onPick: (id) => {
      if (!state.model.info.has(id)) return;
      state.picked = id;
      state.diagram.select(id);
      openDrawer('value');
    },
  });

  const studies = JSON.parse(await text('studies/index.json'));
  $('study').innerHTML = studies
    .map(({ id, title }) => `<option value="${id}">${title}</option>`).join('');
  $('study').onchange = () => open(studies.find((one) => one.id === $('study').value));

  $('run').onclick = run;
  $('stop').onclick = () => state.run?.stop();
  $('close').onclick = () => { $('drawer').hidden = true; state.diagram.select(null); };
  for (const button of $('tabs').querySelectorAll('[data-tab]')) {
    button.onclick = () => openDrawer(button.dataset.tab);
  }

  wireResize();
  await open(studies[0]);
}

boot().catch((err) => {
  $('caption').innerHTML = `<div class="problem">${err.message}</div>`;
  say('nothing loaded', true);
});
