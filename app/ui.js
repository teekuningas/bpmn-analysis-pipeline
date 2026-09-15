// Pick a study, look at it, run it, look at what came out. The only file that
// knows there is a page.

import { TYPES } from '../core/primitives.js';
import { loadStudy } from '../runtime/study.js';
import { Run } from '../runtime/run.js';
import { Diagram, renderLegend, renderTypes } from './diagram.js';
import { renderValue, renderSources, renderLog } from './inspect.js';
import { renderModel, providerFor, chosen } from './model.js';

const $ = (id) => document.getElementById(id);

const text = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} — ${response.status}`);
  return response.text();
};

const state = {
  diagram: null, study: null, xml: null, processes: null, processId: null,
  model: null, run: null, picked: null, tab: 'data',
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
  if (state.tab === 'result') return drawResult(panel);
  if (state.tab === 'model') return renderModel(panel, { onChange: showChosen });
  return drawValue(panel);
}

function drawResult(panel) {
  const value = state.run?.data?.[state.study.chart?.of];
  if (!value) {
    panel.innerHTML = '<p class="empty">Nothing yet — run the process.</p>';
    return;
  }
  renderValue(panel, value, 'collection[finding]', state.study);
}

function drawValue(panel) {
  const known = state.picked && state.model.info.get(state.picked);
  if (!known) {
    panel.innerHTML = '<p class="empty">Click a box to see what it made.</p>';
    return;
  }

  const value = state.run?.valueOf(state.picked);
  const notes = state.run?.notesOf(state.picked) || [];
  panel.innerHTML = `
    <h2>${known.label}</h2>
    <p class="signature">${known.signature || ''}</p>
    ${known.loop ? `<p class="lede">${known.loop}</p>` : ''}
    ${notes.map((note) => `<p class="lede">${note}</p>`).join('')}
    <h3>gives <code>${known.gives?.name || ''}</code></h3>
    <div id="value"></div>`;

  if (value === undefined) $('value').innerHTML = '<p class="empty">Not made yet.</p>';
  else renderValue($('value'), value, known.gives?.type, state.study);
}

const showChosen = () => { $('model').textContent = chosen(); };

const hold = () => new Promise((resolve) => setTimeout(resolve, Number($('pace').value)));

function watch(provider) {
  const started = Date.now();
  let calls = 0;
  const elapsed = () => Math.round((Date.now() - started) / 1000);

  return {
    summary: () => `${calls} calls in ${elapsed()}s · ${provider.hits} cached`,
    onEvent: ({ type, element, index, total, attempt }) => {
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
      } else if (type === 'fail') {
        state.diagram.mark(element.id, 'is-failed');
        say(`${element.id} gave nothing usable — trying again (${attempt})`, true);
      } else if (type === 'call') {
        calls += 1;
        say(`${calls} calls · ${elapsed()}s · ${provider.hits} cached`);
        if (state.tab === 'log') drawPanel();
      }
      return new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

async function run() {
  let provider;
  try { provider = providerFor(state.study); } catch (err) { say(err.message, true); return; }

  const watcher = watch(provider);
  state.diagram.clear();
  state.diagram.frozen = true;
  $('run').hidden = true;
  $('stop').hidden = false;
  say('running…');

  state.run = new Run({
    study: state.study,
    processes: state.processes,
    processId: state.processId,
    provider,
    settings: readSettings(),
    onEvent: watcher.onEvent,
  });

  try {
    await state.run.start();
    say(`done · ${watcher.summary()}`);
    openDrawer('result');
  } catch (err) {
    if (state.run.stopped) say('stopped');
    else say(err.message, true);
  } finally {
    state.diagram.frozen = false;
    state.diagram.caption();
    $('run').hidden = false;
    $('stop').hidden = true;
    $('run').textContent = 'Run again';
  }
}

const readSettings = () => Object.fromEntries(state.study.settings
  .map(({ name }) => [name, Number($(`set-${name}`).value)]));

function renderSettings() {
  $('settings').innerHTML = state.study.settings.map(({ name, label, note, value, min, max, step }) => `
    <label class="field" title="${note || ''}">
      ${label}
      <input type="range" id="set-${name}" min="${min}" max="${max}" step="${step || 1}" value="${value}"/>
      <output id="out-${name}">${value}</output>
    </label>`).join('');

  for (const { name } of state.study.settings) {
    $(`set-${name}`).oninput = ({ target }) => { $(`out-${name}`).textContent = target.value; };
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
  renderSettings();
  $('run').textContent = 'Run';
  if (!$('drawer').hidden) openDrawer(state.tab === 'model' ? 'model' : 'data');

  const { problems } = state.model;
  $('run').disabled = problems.length > 0;
  if (problems.length) {
    $('caption').innerHTML = problems.map((p) => `<div class="problem">${p}</div>`).join('');
  }
}

async function boot() {
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

  $('pace').oninput = ({ target }) => { $('pace-out').textContent = `${target.value} ms`; };
  $('run').onclick = run;
  $('stop').onclick = () => state.run?.stop();
  $('browse').onclick = () => openDrawer('data');
  $('model').onclick = () => openDrawer('model');
  $('close').onclick = () => { $('drawer').hidden = true; state.diagram.select(null); };
  for (const button of $('tabs').querySelectorAll('[data-tab]')) {
    button.onclick = () => openDrawer(button.dataset.tab);
  }

  showChosen();
  await open(studies[0]);
}

boot().catch((err) => {
  $('caption').innerHTML = `<div class="problem">${err.message}</div>`;
  say('nothing loaded', true);
});
