// The Setup panel: which model, how much to run, what the browser is holding.
//
// One model, chosen here rather than asked for. A person arriving at this page
// should be able to press Run and watch, and every question this panel could ask
// is a question they should not have to answer.

import {
  scriptedProvider, wasmProvider, remembering, forgetReplies, forgetWeights,
  heldWeights, keepStorage, stopped, threads, accelerator, MODEL,
} from '../runtime/providers.js';
import { escape } from './html.js';

// Three siblings behind one interface: two of them are the same weights from the
// same download, differing only in where the layers run. Nothing above this file
// — not a task, not the engine, not the diagram — learns which one it got.
const WAYS = [
  {
    id: 'gpu',
    name: 'In this tab, on the GPU',
    cost: () => MODEL.size,
    about: 'llama.cpp in WebAssembly with every layer offloaded to WebGPU. '
      + 'The fast one, where the browser has an adapter.',
  },
  {
    id: 'cpu',
    name: 'In this tab, on the CPU',
    cost: () => MODEL.size,
    about: () => `The same weights and the same download, run on ${threads()} `
      + `thread${threads() === 1 ? '' : 's'} instead. Works everywhere; slow.`,
  },
  {
    id: 'scripted',
    name: 'Scripted stand-in',
    cost: () => 'no download',
    about: 'Keyword matching, not a language model. Every step still runs and the '
      + 'statistics at the end are computed — the baseline a real model has to beat.',
  },
];

// Scripted to begin with: a page that has just loaded should do something the
// moment Run is pressed, and a real model is gigabytes away. Choosing one is
// what opts into that.
const choice = { way: 'scripted' };

let live = null;
let progress = null;
let loading = false;
let held = null;
let trouble = null;
let device = null;

export const ready = () => Boolean(progress?.total && progress.done >= progress.total);

const way = () => WAYS.find((one) => one.id === choice.way) || WAYS[0];

export const chosen = () => way().name;

/** What pressing Run will cost before it computes anything, or nothing. */
export const firstCost = () => (choice.way === 'scripted' || ready() ? '' : MODEL.size);

export function providerFor(study) {
  if (choice.way === 'scripted') return remembering(scriptedProvider(study));
  if (!live || live.name !== choice.way) live = engine();
  return remembering(live);
}

/** Load the weights if they are not here yet. Run calls this so that pressing
 *  Run is the only thing anyone has to do. */
export async function ensureModel(onProgress) {
  if (choice.way === 'scripted' || ready()) return;
  await keepStorage();
  loading = true;
  live = engine(onProgress);
  try {
    await live.load();
  } finally {
    loading = false;
    held = await heldWeights();
  }
}

const engine = (also) => wasmProvider({
  url: MODEL.url,
  gpu: choice.way === 'gpu',
  onProgress: (at) => { progress = at; also?.(at); },
});

const gb = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${(n / 1e6).toFixed(0)} MB`);
const share = () => (progress?.total ? Math.round((100 * progress.done) / progress.total) : 0);

export function renderSetup(container, { study, settings, onChange }) {
  const redraw = () => renderSetup(container, { study, settings, onChange });
  if (held === null) heldWeights().then((bytes) => { held = bytes; redraw(); });
  if (device === null) {
    accelerator().then((found) => { device = found; redraw(); });
  }

  const cores = threads();
  const knobs = (study?.settings || []).map(({ name, label, note, min, max, step }) => `
    <label class="knob" title="${escape(note || '')}">
      <span>${escape(label)}</span>
      <input type="range" id="set-${name}" min="${min}" max="${max}" step="${step || 1}"
        value="${settings[name]}"/>
      <output id="out-${name}">${settings[name]}</output>
    </label>`).join('');

  const picks = WAYS.map((one) => {
    const off = one.id === 'gpu' && device === 'cpu';
    const cost = typeof one.cost === 'function' ? one.cost() : one.cost;
    const about = typeof one.about === 'function' ? one.about() : one.about;
    return `
    <label class="pick${choice.way === one.id ? ' on' : ''}${off ? ' off' : ''}">
      <input type="radio" name="way" value="${one.id}"
        ${choice.way === one.id ? ' checked' : ''}${off ? ' disabled' : ''}/>
      <span class="name">${escape(one.name)}</span>
      <span class="cost">${escape(cost)}</span>
      <span class="about">${escape(about)}${off
        ? ' <b>This browser has no WebGPU adapter.</b>' : ''}</span>
    </label>`;
  }).join('');

  container.innerHTML = `
    <h2>Model</h2>
    <p class="lede">The two in-tab options are the same ${escape(MODEL.label)} weights and the
      same download — only where the layers run differs. Nothing in the process knows which
      one it got.</p>
    ${picks}

    ${choice.way === 'scripted' ? '' : `
    <div class="detail stack">
      ${loading || progress ? `<div class="bar"><span style="width:${share()}%"></span></div>` : ''}
      <p class="lede" id="state">${loading
        ? `downloading · ${gb(progress?.done || 0)} of ${gb(progress?.total || 0)}`
        : (ready() ? 'ready in this browser' : 'downloads the first time you press Run')}</p>
      ${loading ? '<button type="button" id="stop-load">Stop</button>' : ''}
      ${choice.way === 'cpu' && threads() === 1 ? `<p class="note">One thread only — this page
        is not cross-origin isolated, so there is no <code>SharedArrayBuffer</code> and
        llama.cpp cannot use more.</p>` : ''}
      ${trouble ? `<p class="problem">${escape(trouble)}</p>` : ''}
    </div>`}

    ${knobs ? `<h3>How much to run</h3><div class="knobs">${knobs}
      <label class="knob" title="How long to hold on each step, so a run can be followed">
        <span>Delay</span>
        <input type="range" id="pace" min="0" max="600" step="50" value="${settings.pace ?? 150}"/>
        <output id="pace-out">${settings.pace ?? 150} ms</output>
      </label></div>` : ''}

    <h3>Stored here</h3>
    <p class="lede">Weights <b>${held === null ? '…' : gb(held)}</b>, shared by both in-tab
      options. Remembered replies make re-running an unchanged step cost nothing.</p>
    <div class="row">
      <button type="button" id="forget-weights"${held ? '' : ' disabled'}>Delete weights</button>
      <button type="button" id="forget">Forget replies</button>
    </div>`;

  for (const radio of container.querySelectorAll('input[name="way"]')) {
    radio.onchange = () => {
      choice.way = radio.value;
      // Picking the GPU where there is none would only fail at the first call.
      if (choice.way === 'gpu' && device === 'cpu') choice.way = 'cpu';
      redraw();
      onChange?.();
    };
  }

  for (const { name } of study?.settings || []) {
    container.querySelector(`#set-${name}`).oninput = ({ target }) => {
      settings[name] = Number(target.value);
      container.querySelector(`#out-${name}`).textContent = target.value;
    };
  }
  const pace = container.querySelector('#pace');
  if (pace) {
    pace.oninput = ({ target }) => {
      settings.pace = Number(target.value);
      container.querySelector('#pace-out').textContent = `${target.value} ms`;
    };
  }

  const halt = container.querySelector('#stop-load');
  if (halt) {
    halt.onclick = () => {
      halt.disabled = true;
      halt.textContent = 'Stopping…';
      live?.stop();
    };
  }

  container.querySelector('#forget-weights').onclick = async () => {
    await forgetWeights();
    live = null;
    progress = null;
    trouble = null;
    held = await heldWeights();
    redraw();
  };

  container.querySelector('#forget').onclick = ({ target }) => {
    forgetReplies();
    target.textContent = 'Forgotten';
  };
}

/** Called by the run when loading failed, so the panel can say why. */
export function loadFailed(err) {
  live = null;
  progress = null;
  trouble = stopped(err) ? null : (err?.message || String(err));
  return trouble;
}
