// Choosing where Generate's answers come from.

import {
  scriptedProvider, browserProvider, remembering, forgetReplies, accelerator, BROWSER_MODELS,
} from '../runtime/providers.js';
import { escape } from './html.js';

const KINDS = [
  {
    id: 'scripted',
    label: 'Scripted stand-in',
    cost: 'nothing to download',
    about: 'Keyword matching, not a language model. Everything still runs and the numbers '
      + 'at the end are real.',
  },
  {
    id: 'browser',
    label: 'Gemma, in this tab',
    cost: 'downloaded once',
    about: 'Weights come from Hugging Face and stay in your browser.',
  },
];

const choice = { kind: 'scripted', model: BROWSER_MODELS[0].id };

let inTab = null;
let progress = null;
let device = null;

export const chosen = () => KINDS.find((one) => one.id === choice.kind).label;

export function providerFor(study) {
  if (choice.kind !== 'browser') return remembering(scriptedProvider(study));
  if (!inTab || inTab.model !== choice.model) inTab = browserProvider({ model: choice.model });
  return remembering(inTab);
}

const mb = (n) => `${(n / 1e6).toFixed(0)} MB`;
const share = () => (progress ? Math.round((100 * progress.done) / progress.total) : 0);
const told = () => (progress ? `${mb(progress.done)} of ${mb(progress.total)}` : 'not downloaded');

const slow = '<p class="problem">No WebGPU here, so this would run on the processor — '
  + 'minutes per answer. Chrome, or Firefox with <code>dom.webgpu.enabled</code>, is far faster.</p>';

export function renderModel(container, { onChange }) {
  const redraw = () => renderModel(container, { onChange });
  if (device === null) accelerator().then((found) => { device = found; redraw(); });

  container.innerHTML = `
    <h2>Model</h2>
    <p class="lede">Where <b>Generate</b> gets its answers.</p>
    ${KINDS.map(({ id, label, cost, about }) => `
      <label class="pick${choice.kind === id ? ' on' : ''}">
        <input type="radio" name="kind" value="${id}"${choice.kind === id ? ' checked' : ''}/>
        <span class="name">${label}</span><span class="cost">${cost}</span>
        <span class="about">${about}</span>
      </label>
      ${id === 'browser' && choice.kind === 'browser' ? `
        <div class="detail">
          <select id="which-model">${BROWSER_MODELS.map(({ id: m, label: l, size }) => `
            <option value="${m}"${choice.model === m ? ' selected' : ''}>${l} · ${size}</option>`).join('')}
          </select>
          <button type="button" id="download">Download</button>
          <div class="bar"><span style="width:${share()}%"></span></div>
          <p class="lede" id="downloaded">${told()}</p>
          ${device === 'wasm' ? slow : ''}
        </div>` : ''}
    `).join('')}
    <h3>Remembered replies</h3>
    <p class="lede">Kept, so running the same thing again is free.</p>
    <button type="button" id="forget">Forget them</button>`;

  for (const radio of container.querySelectorAll('[name="kind"]')) {
    radio.onchange = ({ target }) => { choice.kind = target.value; redraw(); onChange(); };
  }

  const which = container.querySelector('#which-model');
  if (which) which.onchange = ({ target }) => { choice.model = target.value; progress = null; redraw(); };

  const download = container.querySelector('#download');
  if (download) {
    download.onclick = async () => {
      download.disabled = true;
      download.textContent = 'Downloading…';
      const files = new Map();
      inTab = browserProvider({
        model: choice.model,
        onProgress: ({ file, done, total }) => {
          files.set(file, { done, total });
          progress = [...files.values()].reduce((a, b) => ({
            done: a.done + b.done, total: a.total + b.total,
          }), { done: 0, total: 0 });
          container.querySelector('.bar span').style.width = `${share()}%`;
          container.querySelector('#downloaded').textContent = told();
        },
      });
      try {
        await inTab.load();
        redraw();
        container.querySelector('#download').textContent = 'Ready';
      } catch (err) {
        inTab = null;
        progress = null;
        redraw();
        container.insertAdjacentHTML('beforeend', `<p class="problem">${escape(err.message)}</p>`);
      }
    };
  }

  container.querySelector('#forget').onclick = ({ target }) => {
    forgetReplies();
    target.textContent = 'Forgotten';
  };
}
