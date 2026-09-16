// Runs a study end to end against a real model over the OpenAI wire, outside
// the browser, and prints what every Generate box was asked and what it said.
//
// The point is to read the answers. In the tab a run is an hour of watching a
// progress badge; here the same prompts, the same schemas — `askFor()` builds
// the request, so this cannot drift from what the page sends — go to a model
// that answers in seconds, and every thought and reply lands on the terminal.
//
//     LLM_URL=http://host:9999/v1 LLM_KEY=sk-… LLM_MODEL=gemma4-31B \
//       node tools/probe.mjs nature-and-place --sample 4 --pairs 6
//
// Embeddings: an endpoint that serves them is used; one that does not falls
// back to the stand-in's hashed places, and says so. `Embed` is guidance —
// which pairs are worth asking about — never a judgement, so a probe of the
// *language* work is still honest without it.

import { readFile } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from './xmldom.mjs';

globalThis.DOMParser = DOMParser;

// The page has no reply cache — a remembered answer cannot be told apart from a
// fresh one, which is the whole point of watching a run. A probe is the opposite
// case: it is re-run against the same study while a prompt is being worked on,
// and paying ten seconds a call for the ones that did not change is what stops
// it being used. So the cache lives here, in a file, and nowhere near the app.
const CACHE = process.env.LLM_CACHE || '/tmp/bpmn-probe-cache.json';

function remembering(provider) {
  let entries;
  try { entries = new Map(JSON.parse(readFileSync(CACHE, 'utf8'))); } catch { entries = new Map(); }
  const keep = () => { try { writeFileSync(CACHE, JSON.stringify([...entries])); } catch { /* read-only */ } };

  return {
    ...provider,
    hits: 0,
    async generate(instruction, content, opts) {
      const at = `${opts?.gives ?? ''}\u0000${opts?.seed ?? ''}\u0000${instruction}\u0000${content}`;
      if (entries.has(at)) { this.hits += 1; return entries.get(at); }
      const reply = await provider.generate(instruction, content, opts);
      // An empty reply is not an answer; remembering one makes a silence
      // permanent and outlives whatever fixes it.
      if (String(reply?.text ?? '').trim()) { entries.set(at, reply); keep(); }
      return reply;
    },
    async embed(text, opts) {
      const at = `embed\u0000${text}`;
      if (entries.has(at)) { this.hits += 1; return entries.get(at); }
      const place = await provider.embed(text, opts);
      entries.set(at, place);
      keep();
      return place;
    },
  };
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const { loadStudy, settingsOf, defaultsFor } = await import('../runtime/study.js');
const { Run } = await import('../runtime/run.js');
const { askFor, said, scriptedProvider } = await import('../runtime/providers.js');

const args = process.argv.slice(2);
const TAKES = new Set(['sample', 'pairs']);
const opts = {};
const loose = [];
for (let at = 0; at < args.length; at += 1) {
  const name = args[at].startsWith('--') ? args[at].slice(2) : null;
  if (!name) loose.push(args[at]);
  else if (TAKES.has(name)) opts[name] = args[at += 1];
  else opts[name] = true;
}

const id = loose[0] || 'nature-and-place';

const URL_ = process.env.LLM_URL || 'http://localhost:8080/v1';
const KEY = process.env.LLM_KEY || '';
const MODEL = process.env.LLM_MODEL || 'local';

const short = (text, n = 300) => (String(text ?? '').length > n
  ? `${String(text).slice(0, n).replace(/\s+/g, ' ')}…` : String(text ?? '').replace(/\s+/g, ' '));

const grey = (s) => `[2m${s}[0m`;
const bold = (s) => `[1m${s}[0m`;

/** The third transport. Same request body as both llama.cpp paths in the page,
 *  because it is the same builder. */
function wireProvider(study) {
  const fallback = scriptedProvider(study);
  let embeds = null; // null until tried, then true/false

  const post = async (path, body) => {
    const response = await fetch(`${URL_}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(KEY ? { Authorization: `Bearer ${KEY}` } : {}) },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${path} — ${response.status} ${short(await response.text(), 200)}`);
    return response.json();
  };

  return {
    name: 'probe',
    model: MODEL,

    async generate(instruction, content, options = {}) {
      const response = await post('/chat/completions', { model: MODEL, ...askFor(instruction, content, options) });
      const reply = said(response);
      // An empty reply is the interesting failure, and why it was empty is the
      // whole question: a budget spent on thinking looks nothing like a refusal.
      if (!reply.text.trim()) {
        const why = response?.choices?.[0]?.finish_reason;
        console.log(`    [33mempty reply · finish_reason=${why} · ${JSON.stringify(response?.usage)}[0m`);
      }
      return reply;
    },

    async embed(text) {
      if (embeds === false) return fallback.embed(text);
      try {
        const out = await post('/embeddings', { model: MODEL, input: text });
        const place = out?.data?.[0]?.embedding;
        if (!Array.isArray(place)) throw new Error('no embedding in the reply');
        embeds = true;
        return place;
      } catch (err) {
        if (embeds === null) {
          embeds = false;
          console.log(grey(`  embeddings: ${short(err.message, 90)} — using the stand-in's hashed places`));
        }
        return fallback.embed(text);
      }
    },
  };
}

const loaded = await loadStudy(id, (file) => readFile(join(root, 'studies', id, file), 'utf8'));
const { study, processes, processId, model } = loaded;

if (model.problems.length) {
  console.log('TYPE PROBLEMS');
  model.problems.forEach((p) => console.log(`  ${p}`));
  process.exit(1);
}

// With no flags this runs what a model in the tab would run, which is the thing
// worth knowing before anyone waits for it. `--sample` and `--pairs` set the
// study's first and second knob, whatever the study calls them, so a probe of a
// new study needs no new flag.
const settings = defaultsFor(study, 'gpu');
const [first, second] = study.settings;
if (opts.sample !== undefined && first) settings[first.name] = Number(opts.sample);
if (opts.pairs !== undefined && second) settings[second.name] = Number(opts.pairs);

console.log(`\n${bold(study.title)}  (${id})`);
console.log(`  ${MODEL} at ${URL_}`);
console.log(`  ${Object.entries(settingsOf(study, settings)).map(([k, v]) => `${k}=${v}`).join(' ')}\n`);

const started = Date.now();
let calls = 0;
let failed = 0;

const run = new Run({
  study,
  processes,
  processId,
  provider: remembering(wireProvider(study)),
  settings,
  onEvent: ({ type, element, call }) => {
    // A call is logged when it is sent and again when it settles; the terminal
    // wants the settled one, with the reply in it.
    if (type !== 'call' || call.pending) return;
    calls += 1;
    if (call.error) failed += 1;
    const seconds = ((Date.now() - started) / 1000).toFixed(0);
    console.log(`${bold(`${String(calls).padStart(3)} ${call.element.id}`)} ${grey(`${seconds}s`)}`);
    console.log(grey(`    given   ${short(call.content, opts.full ? 4000 : 220)}`));
    if (call.thought) console.log(grey(`    thought ${short(call.thought, opts.full ? 4000 : 220)}`));
    console.log(`    replied ${short(call.text, opts.full ? 4000 : 220)}`);
    if (call.error) console.log(`    [31mFAILED  ${call.error}[0m`);
  },
});

try {
  await run.start();
} catch (err) {
  console.log(`\n[31mrun failed: ${err.message}[0m`);
  process.exitCode = 1;
}

const seconds = ((Date.now() - started) / 1000).toFixed(0);
const findings = run.data?.[study.chart?.of] || [];
console.log(`\n${bold('—')} ${calls} calls in ${seconds}s · ${failed} unreadable`);
if (run.valueOf('Pool')) {
  console.log(`  ${run.valueOf('Pool').length} raw labels → ${(run.data.themes || []).length} agreed`);
  console.log(`  vocabulary: ${(run.data.themes || []).join(' · ')}`);
}
for (const f of findings) {
  console.log(`  ${f.theme.slice(0, 38).padEnd(40)}`
    + `${f.groups.map((g) => `${g.name} ${Math.round(g.rate * 100)}%`).join('  ')}   q ${f.q.toFixed(3)}`
    + `${f.significant ? ' *' : ''}`);
}
