// The Setup panel: which model, how much to run, what the browser is holding.
//
// One model, chosen here rather than asked for. A person arriving at this page
// should be able to press Run and watch, and every question this panel could ask
// is a question they should not have to answer.

import {
  scriptedProvider, wasmProvider, forgetWeights, heldWeights, keepStorage,
  stopped, threads, accelerator, MODEL, EMBEDDER, weightsCost,
} from '../runtime/providers.js';
import { defaultsFor } from '../runtime/study.js';
import { escape } from './html.js';

const gb = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${(n / 1e6).toFixed(0)} MB`);

// Three siblings behind one interface: two of them are the same weights from the
// same download, differing only in where the layers run. Nothing above this file
// — not a task, not the engine, not the diagram — learns which one it got.
const WAYS = [
  {
    id: 'gpu',
    name: 'In this tab, on the GPU',
    cost: () => gb(weightsCost()),
    about: 'The fast one, where the browser can give llama.cpp a GPU.',
  },
  {
    id: 'cpu',
    name: 'In this tab, on the CPU',
    cost: () => gb(weightsCost()),
    about: () => `Works everywhere. Slow — ${threads()} thread${threads() === 1 ? '' : 's'}.`,
  },
  {
    id: 'scripted',
    name: 'Scripted stand-in',
    cost: () => 'no download',
    about: 'Keyword matching, not a language model. Runs the whole diagram at once.',
  },
];

// Scripted to begin with: a page that has just loaded should do something the
// moment Run is pressed, and a real model is gigabytes away. Choosing one is
// what opts into that.
const choice = { way: 'scripted' };

// How long to hold on each step, so a run can be followed. An app knob rather
// than a study one — it changes nothing about what is computed — but it takes
// its default the same way, from the way of answering that was picked.
export const PACE = {
  name: 'pace', label: 'Delay', min: 0, max: 600, step: 50, value: 50,
  note: 'How long to hold on each step, so a run can be watched rather than only waited for.',
};

/** Every knob at what this way of answering should start it at. A model in the
 *  tab computes as little as the study allows; the stand-in computes the lot. */
export const startingSettings = (study, way = choice.way) => ({
  ...defaultsFor(study, way),
  pace: PACE.value,
});

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
export const firstCost = () => (choice.way === 'scripted' || ready() ? '' : gb(weightsCost()));

/** Nothing between a box and the model. Replies used to be remembered, and a
 *  remembered reply is indistinguishable from an answered one — which is exactly
 *  what a person debugging a run needs to be able to tell apart. It also hid two
 *  real faults: a cached empty reply outlived the fix for it, and a changed
 *  schema went on being answered by the old key. Every Run asks for real. */
export function providerFor(study) {
  if (choice.way === 'scripted') return scriptedProvider(study);
  if (!live || live.name !== choice.way) live = engine();
  return live;
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
  gpu: choice.way === 'gpu',
  onProgress: (at) => { progress = at; also?.(at); },
  onTrouble: (word) => { trouble = word; },
});

/** Anything llama.cpp's worker called an error, for whoever is watching a run
 *  that has stopped moving. A worker that dies rejects nothing, so this is the
 *  only sign there is. */
export const workerTrouble = () => trouble;

const share = () => (progress?.total ? Math.round((100 * progress.done) / progress.total) : 0);

export function renderSetup(container, { study, settings, onChange }) {
  const redraw = () => renderSetup(container, { study, settings, onChange });
  if (held === null) heldWeights().then((bytes) => { held = bytes; redraw(); });
  if (device === null) {
    accelerator().then((found) => { device = found; redraw(); });
  }

  const knobs = [...(study?.settings || []), PACE].map(({ name, label, note, min, max, step }) => `
    <label class="knob" title="${escape(note || '')}">
      <span>${escape(label)}</span>
      <input type="range" id="set-${name}" min="${min}" max="${max}" step="${step || 1}"
        value="${settings[name]}"/>
      <output id="out-${name}">${settings[name]}${name === 'pace' ? ' ms' : ''}</output>
    </label>`).join('');

  // What llama.cpp itself reported, once it has loaded something. It is the
  // only account of where the work went: a browser can hand out an adapter that
  // ggml then fails to take, and nothing else says so.
  const got = live?.device?.();
  const lines = live?.heard?.() || [];
  const said = !got ? '' : `
    <p class="lede">Running on <b>${got.got === 'webgpu'
    ? `the GPU · ${escape(got.adapter)}` : 'the CPU'}</b>.</p>
    ${got.asked === 'webgpu' && got.got !== 'webgpu' ? `<p class="problem">llama.cpp got no
      GPU, so this is on the CPU and will be slow. Chromium on Linux may also need
      <code>--enable-features=Vulkan</code>.</p>` : ''}
    ${lines.length ? `<details class="heard"><summary>what the engine said
      (${lines.length})</summary><pre>${escape(lines
    .map((one) => one.line).join('\n'))}</pre></details>` : ''}`;

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
    <p class="lede">${escape(MODEL.label)}, in this tab. The first two are the same download.</p>
    ${picks}

    ${choice.way === 'scripted' ? '' : `
    <div class="detail stack">
      ${loading || progress ? `<div class="bar"><span style="width:${share()}%"></span></div>` : ''}
      <p class="lede" id="state">${loading
        ? `downloading · ${gb(progress?.done || 0)} of ${gb(progress?.total || 0)}`
        : (ready() ? 'ready in this browser' : 'downloads the first time you press Run')}</p>
      ${loading ? '<button type="button" id="stop-load">Stop</button>' : ''}
      ${said}
      ${choice.way === 'cpu' && threads() === 1 ? `<p class="note">One thread only: this page
        is not cross-origin isolated.</p>` : ''}
      ${trouble ? `<p class="problem">${escape(trouble)}</p>` : ''}
    </div>`}

    <h3>How much to run</h3>
    <p class="lede">Switching the model resets these.</p>
    <div class="knobs">${knobs}</div>

    <h3>Stored here</h3>
    <p class="lede">Weights <b>${held === null ? '…' : gb(held)}</b>. Replies are never kept —
      every Run asks again.</p>
    <div class="row">
      <button type="button" id="forget-weights"${held ? '' : ' disabled'}>Delete weights</button>
    </div>`;

  for (const radio of container.querySelectorAll('input[name="way"]')) {
    radio.onchange = () => {
      choice.way = radio.value;
      // Picking the GPU where there is none would only fail at the first call.
      if (choice.way === 'gpu' && device === 'cpu') choice.way = 'cpu';
      // What is worth computing is a property of the pair — this study, this way
      // of answering — so picking a way is what puts the knobs where they belong.
      Object.assign(settings, startingSettings(study, choice.way));
      redraw();
      onChange?.();
    };
  }

  for (const { name } of [...(study?.settings || []), PACE]) {
    container.querySelector(`#set-${name}`).oninput = ({ target }) => {
      settings[name] = Number(target.value);
      container.querySelector(`#out-${name}`).textContent
        = `${target.value}${name === 'pace' ? ' ms' : ''}`;
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

}

/** Called by the run when loading failed, so the panel can say why. */
export function loadFailed(err) {
  live = null;
  progress = null;
  trouble = stopped(err) ? null : (err?.message || String(err));
  return trouble;
}
