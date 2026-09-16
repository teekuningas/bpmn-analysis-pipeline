// The canvas. Everything that touches bpmn-js is here.

import { walk } from '../core/bpmn.js';
import { PRIMITIVES, SETTINGS, getPrimitive, generic } from '../core/primitives.js';

const MARKERS = ['is-active', 'is-running', 'is-done', 'is-lit', 'is-failed'];

export class Diagram {
  constructor(container, { onPick } = {}) {
    this.container = container;
    this.onPick = onPick || (() => {});
    this.badges = new Map();
    this.frozen = false;
    // Shown in the caption band whenever nothing is hovered, so the empty space
    // teaches the page instead of just holding its height.
    this.hint = '';
  }

  async show(xml, processes, model) {
    this.processes = processes;
    this.model = model;
    this.viewer?.destroy();
    this.viewer = new BpmnJS({ container: this.container });
    await this.viewer.importXML(xml);

    this.fit();
    // The canvas is told its new size but not re-zoomed: widening the drawer
    // takes viewport away from the diagram, it does not shrink the diagram. Fit
    // happens once, when a process is first shown; after that the zoom is the
    // reader's.
    this.watching ??= new ResizeObserver(() => this.resized());
    this.watching.observe(this.container);

    this.each((el) => {
      if (el.op && getPrimitive(el.op.name).model) this.mark(el.id, 'is-model');
    });

    const bus = this.viewer.get('eventBus');
    bus.on('element.hover', ({ element }) => {
      if (this.frozen) return;
      if (element.type === 'bpmn:SequenceFlow') this.sayCarried(element.source?.id);
      else this.describe(element.id);
    });
    bus.on('element.out', () => { if (!this.frozen) this.caption(); });
    bus.on('element.click', ({ element }) => this.onPick(element.id));
  }

  fit() {
    try { this.viewer.get('canvas').zoom('fit-viewport', 'auto'); } catch { /* not shown yet */ }
  }

  resized() {
    try { this.viewer.get('canvas').resized(); } catch { /* not shown yet */ }
  }

  each(fn) {
    for (const scope of this.processes.values()) for (const { el } of walk(scope)) fn(el);
  }

  find(id) {
    let found = null;
    this.each((el) => { if (el.id === id) found = el; });
    return found;
  }

  caption({ label = '', signature = '', shape = '', loop = '', setting = '' } = {}) {
    const box = document.getElementById('caption');
    if (!label) {
      // Mid-run the band holds what it last said. A start event or a gateway has
      // nothing of its own to say, and a caption that blanks between steps reads
      // as flicker rather than as information.
      if (this.frozen) return;
      box.innerHTML = this.hint ? `<div class="hint">${this.hint}</div>` : '';
      return;
    }
    box.innerHTML = `<div class="line"><span class="label">${label}</span>`
        + (signature ? `<span class="sig">${signature}</span>` : '')
        + (shape ? `<span class="shape">${shape}</span>` : '')
        + '</div>'
        + (loop ? `<div class="loop">${loop}</div>` : '')
        + (setting ? `<div class="setting">${setting}</div>` : '');
  }

  describe(id) {
    const el = this.find(id);
    const known = this.model.info.get(id);
    if (!known) {
      this.caption(el?.name ? { label: el.name, setting: el.timer ? `${el.timer / 1000} seconds` : '' } : {});
      return;
    }
    this.caption({
      label: known.label || el.name,
      signature: known.signature,
      shape: known.signature ? known.generic : '',
      loop: known.loop,
      setting: el.op ? settingLine(el.op.params) : '',
    });
  }

  sayCarried(sourceId) {
    const gives = this.model.info.get(sourceId)?.gives;
    this.caption(gives ? { label: gives.name, signature: gives.type } : {});
  }

  mark(id, cls) { try { this.viewer.get('canvas').addMarker(id, cls); } catch { /* not drawn */ } }

  unmark(id, cls) { try { this.viewer.get('canvas').removeMarker(id, cls); } catch { /* not drawn */ } }

  badge(id, label) {
    const overlays = this.viewer.get('overlays');
    if (this.badges.has(id)) overlays.remove(this.badges.get(id));
    this.badges.set(id, overlays.add(id, {
      position: { top: -10, right: 14 },
      html: `<span class="count">${label}</span>`,
    }));
  }

  clear() {
    const overlays = this.viewer.get('overlays');
    this.badges.forEach((at) => overlays.remove(at));
    this.badges.clear();
    this.each((el) => MARKERS.forEach((cls) => this.unmark(el.id, cls)));
  }

  light(ids) { this.each((el) => { if (ids.has(el.id)) this.mark(el.id, 'is-lit'); }); }

  unlight() { this.each((el) => this.unmark(el.id, 'is-lit')); }

  select(id) {
    this.each((el) => this.unmark(el.id, 'is-picked'));
    if (id) this.mark(id, 'is-picked');
  }
}

const settingLine = (params) => SETTINGS
  .filter((k) => params[k] !== undefined)
  .map((k) => String(params[k]).replace(/^'|'$/g, ''))
  .join(' · ');

export function renderLegend(diagram) {
  const box = document.getElementById('legend');
  box.innerHTML = Object.entries(PRIMITIVES)
    .map(([name, p]) => `<span data-name="${name}"${p.model ? ' class="model" title="LLM (uses a language model)"' : ''}>${p.label}</span>`)
    .join('');

  box.onmouseover = ({ target }) => {
    const { name } = target.dataset;
    if (!name || diagram.frozen) return;
    const primitive = getPrimitive(name);
    diagram.caption({ label: primitive.label, shape: generic(primitive), setting: primitive.note });
    const ids = new Set();
    diagram.each((el) => { if (el.op?.name === name) ids.add(el.id); });
    diagram.light(ids);
  };
  box.onmouseout = () => {
    if (diagram.frozen) return;
    diagram.caption();
    diagram.unlight();
  };
}

export function renderTypes(diagram, study, vocabularyTypes) {
  const known = { ...vocabularyTypes, ...(study.types || {}) };
  const order = Object.keys(study.types || {}).concat(Object.keys(vocabularyTypes));
  const rank = (name) => (order.includes(name) ? order.indexOf(name) : order.length);
  const used = [...diagram.model.mentions.keys()].sort((a, b) => rank(a) - rank(b));

  const box = document.getElementById('types');
  box.innerHTML = used.map((name) => `<span data-type="${name}">${name}</span>`).join('');

  box.onmouseover = ({ target }) => {
    const name = target.dataset.type;
    if (!name || diagram.frozen) return;
    diagram.caption({ label: name, setting: known[name] || 'named by this study' });
    diagram.light(diagram.model.mentions.get(name) || new Set());
  };
  box.onmouseout = () => {
    if (diagram.frozen) return;
    diagram.caption();
    diagram.unlight();
  };
}
