// What the six primitives do. Every one is a pure function of its wired
// parameters and a context; only `generate` reaches outside, and only to the
// provider it was handed.
//
//   account  { id, text }        theme    a short label
//   draft    a free-form reading verdict  { theme, present, why }
//   vector   numbers, a place in meaning-space
//   judgement { a, b, same, label }  — are these two themes the same concept?
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

/** The value a box was handed, split into the slots its `labels` name. A pair is
 *  two parts, which is what lets a box be asked about one pair at a time. */
const slots = (of, labels) => {
  const names = labels ? String(labels).split('|').map((s) => s.trim()) : null;
  const many = Array.isArray(of) ? of
    : (of && typeof of === 'object' && 'left' in of && 'right' in of ? [of.left, of.right] : null);
  if (!names || !many) return [{ name: null, value: of }];
  return many.map((value, i) => ({ name: names[i] || `PART ${i + 1}`, value }));
};

const asPrompt = (parts) => (parts.length === 1 && !parts[0].name
  ? render(parts[0].value)
  : parts.map(({ name, value }) => `${name}:\n${render(value)}`).join('\n\n'));

function extractToolOrJson(text) {
  if (!text) return null;
  const str = String(text).trim();

  // Try direct JSON or tool_calls object
  try {
    const parsed = JSON.parse(str);
    if (parsed && typeof parsed === 'object') {
      if (parsed.function?.arguments) {
        return typeof parsed.function.arguments === 'string'
          ? JSON.parse(parsed.function.arguments)
          : parsed.function.arguments;
      }
      if (parsed.arguments) {
        return typeof parsed.arguments === 'string'
          ? JSON.parse(parsed.arguments)
          : parsed.arguments;
      }
      return parsed;
    }
  } catch {}

  // Look for JSON block in markdown ```json ... ```
  const codeMatch = str.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeMatch) {
    try {
      const parsed = JSON.parse(codeMatch[1].trim());
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {}
  }

  // Look for Gemma tool call format: call:name{...} or <|tool_call>call:name{...}<tool_call|>
  const toolMatch = str.match(/call:[A-Za-z0-9_]+(\{[\s\S]*?\})(?:<tool_call\|>|$)/);
  if (toolMatch) {
    const rawArgs = toolMatch[1];
    try {
      return JSON.parse(rawArgs);
    } catch {
      try {
        const fixed = rawArgs.replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":');
        return JSON.parse(fixed);
      } catch {}
    }
  }

  // Look for any standalone JSON object
  const braceMatch = str.match(/\{[\s\S]*?\}/);
  if (braceMatch) {
    try {
      return JSON.parse(braceMatch[0]);
    } catch {
      try {
        const fixed = braceMatch[0].replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":');
        return JSON.parse(fixed);
      } catch {}
    }
  }

  return null;
}

// A model gives back text; the type the box declared says what to make of it.
// The shape is enforced on the sampler (see SHAPES in providers.js), so the JSON
// path is the normal one — the line-based heuristics below are what is left for
// a runtime that cannot constrain, and for a reply that arrives fenced.
const READERS = {
  draft: (text) => {
    const structured = extractToolOrJson(text);
    if (structured?.reading) return String(structured.reading).trim();
    if (structured?.text) return String(structured.text).trim();
    if (structured?.draft) return String(structured.draft).trim();
    return String(text).trim();
  },

  theme: (text) => {
    const structured = extractToolOrJson(text);
    if (structured?.label) return clean(structured.label).slice(0, 60);
    if (structured?.theme) return clean(structured.theme).slice(0, 60);
    if (structured?.name) return clean(structured.name).slice(0, 60);
    const [first] = lines(text.replace(/```[a-z]*|```/g, ''));
    if (!first) throw new Error('no label in the reply');
    return first.split(/[;|]/)[0].slice(0, 60).trim();
  },

  'collection[theme]': (text) => {
    const structured = extractToolOrJson(text);
    if (structured) {
      const arr = Array.isArray(structured) ? structured
        : (Array.isArray(structured.themes) ? structured.themes
        : (Array.isArray(structured.labels) ? structured.labels : null));
      if (arr && arr.length) {
        const cleaned = arr.map(clean).filter((t) => t.length > 1 && t.length < 60);
        if (cleaned.length) return cleaned.slice(0, 8);
      }
    }
    const found = lines(text.replace(/```[a-z]*|```/g, ''))
      .filter((line) => line.length > 2 && line.length < 60 && !/[:?]$/.test(line))
      .map((line) => line.split(/\s+[-–]\s+/)[0].trim());
    const seen = new Map(found.map((one) => [key(one), one]).reverse());
    if (!seen.size) throw new Error('no labels in the reply');
    return [...seen.values()].reverse().slice(0, 8);
  },

  // The reply says yes or no and offers a wording; which two labels were asked
  // about comes from what the box was handed, exactly as `verdict` does.
  judgement: (text, parts) => {
    const [a, b] = parts.map((part) => render(part.value));
    const structured = extractToolOrJson(text);
    const head = String(text).slice(0, 200);
    const same = typeof structured?.same === 'boolean'
      ? structured.same
      : (/\b(yes|true|same)\b/i.test(head) && !/\bnot\b/i.test(head));
    const spoken = structured?.label || head.split(/[.\u2014]/).slice(1).join(' ');
    const label = clean(spoken || '').slice(0, 60);
    return { a, b, same, label: same ? (label || a) : '' };
  },

  verdict: (text, parts) => {
    const themeName = render(parts.at(-1)?.value);
    const structured = extractToolOrJson(text);
    if (structured && typeof structured.present === 'boolean') {
      return {
        theme: themeName,
        present: structured.present,
        why: String(structured.why || '').replace(/\s+/g, ' ').trim().slice(0, 240),
      };
    }
    const head = String(text).slice(0, 400);
    const present = /\b(yes|true|present)\b/i.test(head) ? true
      : (/\b(no|false|absent)\b/i.test(head) ? false : null);
    if (present === null) throw new Error('the reply says neither yes nor no');
    return {
      theme: themeName,
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

  // Rank every pair of themes by how close their vectors sit, nearest first, and
  // keep the most promising few. Guidance only: which pairs are worth asking
  // about. The asking is what does the work.
  nearest: (vectors, themes, how_many = 10) => {
    const dot = (u, v) => u.reduce((at, one, i) => at + one * (v[i] ?? 0), 0);
    const norm = (u) => Math.sqrt(dot(u, u)) || 1e-9;
    const pairs = [];
    for (let i = 0; i < themes.length; i += 1) {
      for (let j = i + 1; j < themes.length; j += 1) {
        pairs.push({
          left: themes[i],
          right: themes[j],
          near: dot(vectors[i], vectors[j]) / (norm(vectors[i]) * norm(vectors[j])),
        });
      }
    }
    return pairs.sort((one, two) => two.near - one.near)
      .slice(0, Math.max(1, Number(how_many)))
      .map(({ left, right }) => ({ left, right }));
  },

  // Apply the one merge a round agreed on: both labels become the agreed
  // wording. A round that agreed nothing leaves the vocabulary alone.
  merge: (judgements, themes) => {
    const agreed = judgements.find((one) => one.same);
    if (!agreed) return themes;
    const gone = new Set([key(agreed.a), key(agreed.b)]);
    const kept = themes.filter((one) => !gone.has(key(one)));
    kept.push(agreed.label || agreed.a);
    const seen = new Map();
    for (const one of kept) if (!seen.has(key(one))) seen.set(key(one), one);
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
    let reply = { text: '', thought: '' };
    try {
      reply = await provider.generate(instruction, content, { gives: wants, parts, seed, element });
      const reader = READERS[wants];
      if (!reader) throw new Error(`nothing knows how to read a ${wants} out of a reply`);
      const result = reader(reply.text, parts);
      log?.({ element, instruction, content, ...reply, seed });
      return result;
    } catch (err) {
      log?.({ element, instruction, content, ...reply, seed, error: err.message });
      throw err;
    }
  },

  combine: ({ parts, how, with: subject, by }) => {
    if (!Array.isArray(parts)) throw new Error('Combine was given something that is not a collection');
    return pick(FOLDS, how, 'fold')(parts, subject, by);
  },

  embed: async ({ of }, { provider, element }) => {
    const place = await provider.embed?.(render(of));
    if (!Array.isArray(place)) throw new Error(`${element.id}: this model gives no embeddings`);
    return place;
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
