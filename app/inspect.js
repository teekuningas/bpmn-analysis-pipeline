// Looking at values. The type a box declared is what chooses how to draw what
// it gave — a second job for types written to prevent mistakes.
//
// Read-only for now; the shapes drawn here are the ones an editor would later
// have to make writable.

import { renderChart } from './chart.js';
import { isText } from '../runtime/study.js';
import { escape, short } from './html.js';

function shape(type) {
  const match = String(type || '').match(/^([A-Za-z_]\w*)(?:\[(.*)\])?$/);
  if (!match) return { name: String(type || ''), inner: '' };
  return { name: match[1], inner: match[2] || '' };
}

const chips = (items) => `<div class="chips">${items
  .map((one) => `<span>${escape(one)}</span>`).join('')}</div>`;

const accounts = (items) => `<ol class="cards">${items.map((one) => `
  <li><details><summary><code>${escape(one.id ?? '')}</code> ${escape(short(one.text || '', 90))}</summary>
    <p>${escape(one.text || '')}</p></details></li>`).join('')}</ol>`;

const records = (items) => {
  const keys = [...new Set(items.flatMap((one) => Object.keys(one)))];
  return `<div class="scroll"><table>
    <thead><tr>${keys.map((k) => `<th>${escape(k)}</th>`).join('')}</tr></thead>
    <tbody>${items.map((one) => `<tr>${keys
    .map((k) => `<td>${escape(short(one[k] ?? '', 60))}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
};

const judgements = (items) => `<ul class="plain">${items.map((j) => `
  <li><b class="${j.same ? 'yes' : 'no'}">${j.same ? 'same' : 'not'}</b>
    ${escape(j.a ?? '')} <span class="why">· ${escape(j.b ?? '')}${j.same ? ` → ${escape(j.label ?? '')}` : ''}
    ${j.why ? `<br/>${escape(short(j.why, 140))}` : ''}</span></li>`).join('')}</ul>`;

const verdicts = (items) => `<ul class="plain">${items.map((v) => `
  <li><b class="${v.present ? 'yes' : 'no'}">${v.present ? 'yes' : 'no'}</b>
    ${escape(v.theme ?? '')}<span class="why">${escape(short(v.why || '', 120))}</span></li>`).join('')}</ul>`;

const row = (one) => {
  const entries = Object.entries(one.present || {});
  return `<p class="id">${escape(one.id ?? '')}</p><ul class="plain">${entries.map(([theme, present]) => `
    <li><b class="${present ? 'yes' : 'no'}">${present ? 'yes' : 'no'}</b> ${escape(theme)}</li>`).join('')}</ul>`;
};

const pairs = (items) => {
  const themes = [...new Set(items.flatMap(({ left }) => Object.keys(left.present || {})))];
  const extra = Object.keys(items[0]?.right || {}).filter((k) => k !== 'id');
  return `<div class="scroll"><table class="grid">
    <thead><tr><th>account</th>${extra.map((k) => `<th>${escape(k)}</th>`).join('')}
      ${themes.map((t) => `<th class="turn" title="${escape(t)}"><span>${escape(t)}</span></th>`).join('')}</tr></thead>
    <tbody>${items.map(({ left, right }) => `<tr>
      <td><code>${escape(left.id ?? '')}</code></td>
      ${extra.map((k) => `<td>${escape(right[k] ?? '')}</td>`).join('')}
      ${themes.map((t) => `<td class="mark ${left.present[t] ? 'yes' : 'no'}">${left.present[t] ? '●' : '·'}</td>`).join('')}
    </tr>`).join('')}</tbody></table></div>`;
};

// Writing, drawn as writing: one card each, open, because a summary that has to
// be unfolded to be read is a summary nobody reads.
const writings = (items) => `<ol class="cards">${items
  .map((one) => `<li><p class="prose">${escape(String(one))}</p></li>`).join('')}</ol>`;

const nested = (value, inner, study) => `<ol class="nest">${value
  .map((part) => `<li>${draw(part, inner, study)}</li>`).join('')}</ol>`;

function draw(value, type, study) {
  if (value === undefined || value === null) return '<p class="empty">nothing yet</p>';
  const { name, inner } = shape(type);

  if (name === 'collection') {
    if (!Array.isArray(value)) return `<pre>${escape(JSON.stringify(value, null, 1))}</pre>`;
    if (!value.length) return '<p class="empty">empty</p>';
    const { name: innerName } = shape(inner);
    if (innerName === 'collection') return nested(value, inner, study);
    if (innerName === 'theme') return chips(value);
    if (innerName === 'account') return accounts(value);
    if (innerName === 'verdict') return verdicts(value);
    if (innerName === 'judgement') return judgements(value);
    if (innerName === 'vector') return chips(value.map((v) => `${v.length} numbers`));
    if (innerName === 'pair') return pairs(value);
    if (innerName === 'finding') return '<div class="findings"></div>';
    if (isText(study, innerName)) return writings(value);
    if (innerName === 'row') return `<ol class="cards">${value.map((one) => `<li>${row(one)}</li>`).join('')}</ol>`;
    if (typeof value[0] === 'object') return records(value);
    return chips(value);
  }

  if (name === 'row') return row(value);
  if (name === 'verdict') return verdicts([value]);
  if (name === 'judgement') return judgements([value]);
  if (name === 'vector') return `<p class="lede">${value.length} numbers</p>`;
  if (isText(study, name)) return `<p class="prose">${escape(String(value))}</p>`;
  if (typeof value === 'string') return `<p class="prose">${escape(value)}</p>`;
  return `<pre>${escape(JSON.stringify(value, null, 1))}</pre>`;
}

export function renderValue(container, value, type, study) {
  container.innerHTML = draw(value, type, study);
  const findings = container.querySelector('.findings');
  if (findings) renderChart(findings, value, { study });
}

export function renderSources(container, study) {
  container.innerHTML = Object.entries(study.data).map(([name, rows_]) => {
    const spec = study.shows?.[name] || {};
    const body = spec.body
      ? accounts(rows_.map((one) => ({ id: one[spec.title] ?? one.id, text: one[spec.body] })))
      : records(rows_);
    return `<section class="source">
      <h3>${escape(name)} <span class="count">${rows_.length}</span></h3>
      ${body}</section>`;
  }).join('') || '<p class="empty">nothing to read</p>';
}

// Every call to a model, and only those: Read, Select, Combine, Join and Test
// compute rather than ask, so they never appear here. The diagram is where those
// are watched, and the Output panel is what they made.
export function renderLog(container, calls) {
  if (!calls.length) {
    container.innerHTML = `<p class="empty">Nothing asked of a model yet.</p>
      <p class="lede">Only <b>Generate</b> and <b>Embed</b> ask one. Click any box for what
      it made.</p>`;
    return;
  }
  container.innerHTML = `<ol class="log">${calls.slice(-200).map((call) => `
    <li><details ${call.error ? 'open' : ''}>
      <summary><code>${escape(call.element.id)}</code> ${call.error
    ? `<span class="bad">failed: ${escape(short(call.error, 60))}</span>`
    : (call.pending ? '<span class="waiting">asking…</span>' : escape(short(call.text, 70)))}</summary>
      ${call.instruction ? `<h4>instruction</h4><p class="prose">${escape(call.instruction)}</p>` : ''}
      <h4>given</h4><pre>${escape(short(call.content, 1200))}</pre>
      ${call.thought ? `<h4>thought</h4><p class="thought">${escape(call.thought)}</p>` : ''}
      ${call.error ? `<h4>error</h4><p class="problem">${escape(call.error)}</p>` : ''}
      <h4>replied</h4><pre>${call.pending
    ? '<span class="waiting">still writing…</span>' : escape(call.text || '(no reply)')}</pre>
    </details></li>`).join('')}</ol>`;
}
