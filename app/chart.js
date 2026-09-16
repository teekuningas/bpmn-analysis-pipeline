// One row per theme: how often it appears in each group, as dots on a shared
// 0–100% track, joined so the distance between them is the finding. Colours are
// the fixed categorical slots in app/theme.css, assigned by group name and
// never by rank.

import { escape } from './html.js';

const pct = (x) => `${Math.round(x * 100)}%`;
const fixed = (x, n = 3) => (Number.isFinite(x) ? x.toFixed(n) : '—');

const slot = (i) => `var(--series-${(i % 4) + 1})`;

function stars(q) {
  if (!(q < 0.05)) return '';
  if (q < 0.001) return '***';
  if (q < 0.01) return '**';
  return '*';
}

// Percentages rather than a stretched viewBox: the track has to widen with the
// panel, and a viewBox that widens with it turns every dot into an ellipse.
function track(finding, groups) {
  const x = (rate) => `${8 + rate * 84}%`;
  const dots = finding.groups.map((g) => ({ ...g, at: x(g.rate), colour: slot(groups.indexOf(g.name)) }));
  const rates = finding.groups.map((g) => g.rate);

  return `<svg class="track" height="20" aria-hidden="true">
    <line class="rule" x1="8%" y1="10" x2="92%" y2="10"/>
    <line class="span" x1="${x(Math.min(...rates))}" y1="10" x2="${x(Math.max(...rates))}" y2="10"/>
    ${dots.map((d) => `<circle class="dot" cx="${d.at}" cy="10" r="4.2" fill="${d.colour}"
        data-label="${escape(d.name)}: ${d.present} of ${d.total} (${pct(d.rate)})"/>`).join('')}
  </svg>`;
}

function rows(findings, groups) {
  return findings.map((finding) => `
    <div class="row${finding.significant ? ' is-significant' : ''}">
      <div class="theme" title="${escape(finding.theme)}">${escape(finding.theme)}</div>
      ${track(finding, groups)}
      <div class="rates">${finding.groups
    .map((g) => `<span style="color:${slot(groups.indexOf(g.name))}">●</span>${pct(g.rate)}`)
    .join(' ')}</div>
      <div class="q" title="Benjamini–Hochberg corrected">${fixed(finding.q)}<b>${stars(finding.q)}</b></div>
    </div>`).join('');
}

function table(findings, groups) {
  const head = groups.map((g) => `<th>${escape(g)}</th>`).join('');
  const body = findings.map((f) => `<tr>
      <td>${escape(f.theme)}</td>
      ${f.groups.map((g) => `<td class="num">${g.present}/${g.total}</td>`).join('')}
      <td class="num">${fixed(f.chi2, 2)}</td>
      <td class="num">${fixed(f.v, 2)}</td>
      <td class="num">${fixed(f.p)}</td>
      <td class="num">${fixed(f.q)}${stars(f.q)}</td>
    </tr>`).join('');
  return `<table>
    <thead><tr><th>Theme</th>${head}<th>χ²</th><th>V</th><th>p</th><th>q</th></tr></thead>
    <tbody>${body}</tbody></table>`;
}

export function renderChart(container, findings, { study } = {}) {
  if (!findings?.length) {
    container.innerHTML = '<p class="empty">Nothing yet.</p>';
    return;
  }

  const groups = [...new Set(findings.flatMap((f) => f.groups.map((g) => g.name)))];
  const survived = findings.filter((f) => f.significant).length;
  const thin = findings.filter((f) => f.thin).length;
  const spec = study?.chart || {};

  container.innerHTML = `
    <div class="chart" data-view="plot">
      <div class="chart-head">
        <h2>${escape(spec.title || 'How often each theme appears, by group')}</h2>
        <button class="as-table" type="button">Table</button>
      </div>
      <p class="lede">
        ${findings.length} themes against <b>${escape(findings[0].by)}</b>, ${findings[0].n} rows.
        ${survived ? `<b>${survived}</b> survive correction.` : 'None survive correction.'}
      </p>
      <div class="legend">${groups.map((g, i) => `
        <span><i style="background:${slot(i)}"></i>${escape(g)}</span>`).join('')}
      </div>
      <div class="plot">
        <div class="axis"><span></span><span class="scale"><span>0%</span><span>50%</span><span>100%</span></span></div>
        ${rows(findings, groups)}
      </div>
      <div class="sheet">${table(findings, groups)}</div>
      <p class="foot">
        χ², Cramér's V, Benjamini–Hochberg across ${findings.length} themes. A star marks q &lt; 0.05.
        ${thin ? `${thin} of them have an expected count below 5.` : ''}
        ${spec.note ? escape(spec.note) : ''}
      </p>
      <div class="tip" hidden></div>
    </div>`;

  const chart = container.querySelector('.chart');
  const tip = chart.querySelector('.tip');

  chart.querySelector('.as-table').onclick = (event) => {
    const showing = chart.dataset.view === 'plot';
    chart.dataset.view = showing ? 'table' : 'plot';
    event.target.textContent = showing ? 'Plot' : 'Table';
  };

  chart.onpointermove = ({ target, clientX, clientY }) => {
    const label = target.closest?.('.dot')?.dataset.label;
    if (!label) { tip.hidden = true; return; }
    const box = chart.getBoundingClientRect();
    tip.textContent = label;
    tip.hidden = false;
    tip.style.left = `${clientX - box.left}px`;
    tip.style.top = `${clientY - box.top}px`;
  };
  chart.onpointerleave = () => { tip.hidden = true; };
}
