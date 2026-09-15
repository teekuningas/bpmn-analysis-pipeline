// What the six primitives do. Every one is a pure function of its wired
// parameters and a context; only `generate` reaches outside, and only to the
// provider it was handed.
//
//   account  { id, text }        theme    a short label
//   draft    a free-form reading verdict  { theme, present, why }
//   row      { id, present: { theme: boolean }, why: { theme: string } }
//   site     { id, ...the study's own fields }        pair  { left, right }
//   finding  { theme, by, groups, n, chi2, df, v, p, q, thin, significant }

import { chiSquared, benjaminiHochberg } from './stats.js';

const clean = (line) => line
  .replace(/^\s*[-*•]\s*/, '')
  .replace(/^\s*\d+[.)]\s*/, '')
  .replace(/^["'`]+|["'`:.]+$/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const lines = (text) => String(text).split('\n').map(clean).filter(Boolean);
const key = (value) => String(value).toLowerCase().trim();
const unquote = (value) => String(value).replace(/^'|'$/g, '');

const render = (value) => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((one) => `- ${render(one)}`).join('\n');
  if (typeof value === 'object') return value.text ?? value.theme ?? JSON.stringify(value);
  return String(value);
};

/** The value a box was handed, split into the slots its `labels` name. */
const slots = (of, labels) => {
  const names = labels ? String(labels).split('|').map((s) => s.trim()) : null;
  if (!names || !Array.isArray(of)) return [{ name: null, value: of }];
  return of.map((value, i) => ({ name: names[i] || `PART ${i + 1}`, value }));
};

const asPrompt = (parts) => (parts.length === 1 && !parts[0].name
  ? render(parts[0].value)
  : parts.map(({ name, value }) => `${name}:\n${render(value)}`).join('\n\n'));

// A model gives back text; the type the box declared says what to make of it.
// Forgiving on purpose — nothing here has grammar-constrained decoding, so a
// fence, a preamble or a stray full stop must not fail a run.
const READERS = {
  draft: (text) => String(text).trim(),

  theme: (text) => {
    const [first] = lines(text.replace(/```[a-z]*|```/g, ''));
    if (!first) throw new Error('no label in the reply');
    return first.split(/[;|]/)[0].slice(0, 60).trim();
  },

  'collection[theme]': (text) => {
    const found = lines(text.replace(/```[a-z]*|```/g, ''))
      .filter((line) => line.length > 2 && line.length < 60 && !/[:?]$/.test(line))
      .map((line) => line.split(/\s+[-–]\s+/)[0].trim());
    const seen = new Map(found.map((one) => [key(one), one]).reverse());
    if (!seen.size) throw new Error('no labels in the reply');
    return [...seen.values()].reverse().slice(0, 8);
  },

  verdict: (text, parts) => {
    const head = String(text).slice(0, 400);
    const present = /\b(yes|true|present)\b/i.test(head) ? true
      : (/\b(no|false|absent)\b/i.test(head) ? false : null);
    if (present === null) throw new Error('the reply says neither yes nor no');
    return {
      theme: render(parts.at(-1).value),
      present,
      why: String(text).replace(/\s+/g, ' ').trim().slice(0, 240),
    };
  },
};

const FOLDS = {
  flatten: (parts) => parts.flat(Infinity),

  distinct: (parts) => {
    const seen = new Map();
    for (const one of parts.flat(Infinity)) if (!seen.has(key(one))) seen.set(key(one), one);
    return [...seen.values()];
  },

  row: (parts, subject) => ({
    id: subject?.id ?? null,
    present: Object.fromEntries(parts.map((v) => [v.theme, v.present])),
    why: Object.fromEntries(parts.map((v) => [v.theme, v.why])),
  }),
};

const pick = (table, name, kind) => {
  const found = table[String(name)];
  if (!found) throw new Error(`no ${kind} called "${name}" — there is ${Object.keys(table).join(', ')}`);
  return found;
};

export const OPERATIONS = {
  read: ({ source }, { study }) => pick(study.data, source, 'source'),

  select: ({ of, where }, { settings }) => {
    if (!Array.isArray(of)) throw new Error('Select was given something that is not a collection');
    if (where === undefined) return of;
    const names = Object.keys(settings);
    const test = new Function('item', 'index', ...names, `"use strict"; return (${where});`);
    return of.filter((item, index) => Boolean(test(item, index, ...names.map((n) => settings[n]))));
  },

  generate: async ({ of, prompt, gives, labels, seed }, { provider, log, element }) => {
    const wants = unquote(gives);
    const parts = slots(of, labels);
    const content = asPrompt(parts);
    const instruction = unquote(prompt);
    const reply = await provider.generate(instruction, content, { gives: wants, parts, seed, element });
    log?.({ element, instruction, content, reply, seed });
    const reader = READERS[wants];
    if (!reader) throw new Error(`nothing knows how to read a ${wants} out of a reply`);
    return reader(reply, parts);
  },

  combine: ({ parts, how, with: subject }) => {
    if (!Array.isArray(parts)) throw new Error('Combine was given something that is not a collection');
    return pick(FOLDS, how, 'fold')(parts, subject);
  },

  join: ({ left, right, on }) => {
    const index = new Map(right.map((one) => [one[String(on)], one]));
    return left
      .map((one) => ({ left: one, right: index.get(one[String(on)]) }))
      .filter(({ right: match }) => match !== undefined);
  },

  // One test per theme: does it appear more often in one group than another?
  // Chi-squared on the 2 × k table, Cramér's V for the size of it, and
  // Benjamini–Hochberg because the same question was asked of every theme.
  test: ({ of, by }) => {
    const field = String(by);
    const themes = [...new Set(of.flatMap(({ left }) => Object.keys(left.present || {})))];
    const groups = [...new Set(of.map(({ right }) => right[field]))].sort();
    if (groups.length < 2) {
      throw new Error(`Test needs at least two groups, but every row has ${field} = ${groups[0]}`);
    }

    const measured = themes.map((theme) => {
      const counts = groups.map((group) => {
        const rows = of.filter(({ right }) => right[field] === group);
        const present = rows.filter(({ left }) => left.present[theme] === true).length;
        return { name: group, present, total: rows.length, rate: rows.length ? present / rows.length : 0 };
      });
      const result = chiSquared([counts.map((c) => c.present), counts.map((c) => c.total - c.present)]);
      return {
        theme, by: field, groups: counts, n: of.length,
        chi2: result?.chi2 ?? NaN,
        df: result?.df ?? NaN,
        v: result?.v ?? NaN,
        p: result?.p ?? NaN,
        thin: result?.thin ?? true,
      };
    });

    const q = benjaminiHochberg(measured.map((f) => f.p));
    const last = (x) => (Number.isFinite(x) ? x : Infinity);
    return measured
      .map((finding, i) => ({ ...finding, q: q[i], significant: q[i] < 0.05 }))
      .sort((a, b) => (last(a.q) - last(b.q)) || (last(b.v) - last(a.v)));
  },
};

export const getOperation = (name) => pick(OPERATIONS, name, 'operation');

/** What a box's own numbers say about itself, for the panel beside it. */
export function notesFor(name, took, gave) {
  if (name === 'join' && took?.left) {
    const dropped = took.left.length - gave.length;
    return dropped ? [`${dropped} of ${took.left.length} dropped: no match on ${took.on}`] : [];
  }
  if (name === 'test') {
    const thin = gave.filter((f) => f.thin).length;
    return thin ? [`${thin} of ${gave.length} tables have an expected count below 5`] : [];
  }
  return [];
}
