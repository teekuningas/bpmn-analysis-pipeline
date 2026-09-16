// Where Generate's model comes from. One interface —
//
//   generate(instruction, content, { gives, parts, seed })  →  { text, thought }
//
// — where a reply is `{ text, thought }`: what the model said, and the thinking
// it showed on the way, which may be empty. A primitive never learns which
// provider it got.

import { isText } from './study.js';

const words = (text) => String(text).toLowerCase().match(/[\p{L}]{3,}/gu) || [];

/** Not a language model: keyword matching, so the whole pipeline runs and the
 *  statistics at the end are computed rather than staged before anything is
 *  downloaded. The honest baseline a real model has to beat. */
export function scriptedProvider(study) {
  const lexicon = study.scripted?.lexicon || [];

  const say = (value) => {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(say).join('\n');
    return value.text ?? value.theme ?? String(value);
  };

  // The words that put a label there, as well as the label: the formatting step
  // reads the draft, and can only find labels whose own words are in it.
  const matches = (text) => {
    const seen = new Set(words(text));
    return lexicon
      .map(({ label, match }) => ({ label, on: match.filter((w) => seen.has(String(w).toLowerCase())) }))
      .filter(({ on }) => on.length);
  };

  const overlap = (a, b) => {
    const left = new Set(words(a));
    const right = [...new Set(words(b))];
    const shared = right.filter((w) => left.has(w)).length;
    return shared / Math.max(1, Math.min(left.size, right.length));
  };

  // A place in meaning-space that is not meaning: words hashed to fixed slots,
  // so labels sharing words sit near each other. Enough to rank pairs.
  const place = (text) => {
    const at = new Array(64).fill(0);
    for (const word of words(text)) {
      let hash = 0;
      for (const ch of word) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
      at[Math.abs(hash) % 64] += 1;
    }
    return at;
  };

  // A type the study declared as writing: a summary, a reading — whatever the
  // study called it. Naming the labels it matched *and the words that put them
  // there* is what a free reading would contain anyway, and it is what lets a
  // formatting step downstream find labels whose own wording is not in the text.
  const writing = (body) => {
    const found = matches(body);
    if (!found.length) return answer('This text does not settle on anything nameable.');
    return answer(`Reading this, what stands out is ${found.map((f) => f.label.toLowerCase()).join(', ')}.`
      + ` It speaks of ${[...new Set(found.flatMap((f) => f.on))].join(', ')}.`);
  };

  return {
    name: 'scripted',
    label: 'Scripted stand-in',

    async embed(text) { return place(text); },

    // The replies are JSON of the same shape the real model's sampler is
    // constrained to, so both go through the same readers and the stand-in
    // cannot quietly exercise a path the model never takes.
    async generate(instruction, content, { gives, parts = [] } = {}) {
      const values = parts.map((part) => part.value);
      const subject = say(values[values.length - 1]);
      const body = say(values.length > 1 ? values.slice(0, -1) : values);

      if (isText(study, gives)) return writing(body);

      if (gives === 'collection[theme]') {
        const found = matches(body);
        return answer(JSON.stringify({
          themes: (found.length ? found : [{ label: 'Something unnamed' }]).map(({ label }) => label),
        }));
      }

      if (gives === 'judgement') {
        const [a, b] = values.map(say);
        const same = Math.max(overlap(a, b), overlap(b, a)) >= 0.6;
        return answer(JSON.stringify({
          same,
          label: same ? (a.length <= b.length ? a : b) : '',
          why: same
            ? 'The two wordings are made of mostly the same words.'
            : 'The two wordings share too few words to be the same concept.',
        }));
      }

      if (gives === 'theme') {
        const fresh = say(values[0]);
        const agreed = Array.isArray(values[1]) ? values[1].map(say) : [];
        const best = agreed
          .map((one) => ({ one, score: overlap(one, fresh) }))
          .sort((a, b) => b.score - a.score)[0];
        return answer(JSON.stringify({ label: best && best.score >= 0.6 ? best.one : fresh }));
      }

      if (gives === 'verdict') {
        const entry = lexicon.find((one) => one.label.toLowerCase() === subject.toLowerCase());
        const needles = entry ? entry.match : words(subject);
        const seen = new Set(words(body));
        const present = needles.some((w) => seen.has(String(w).toLowerCase()));
        return answer(JSON.stringify({
          present,
          why: present
            ? 'The words this theme is made of are in the text.'
            : 'None of the words this theme is made of appear.',
        }));
      }

      // A study can ask a model for a type the stand-in has never heard of. It
      // should say so rather than hand back '' and fail somewhere downstream.
      throw new Error(`the stand-in has nothing to say about a ${gives}`);
    },
  };
}

// What a reply of each type has to look like, as a JSON schema that constrains
// the sampler. Two rules, both learned the hard way against Gemma 4 E2B:
//
//   Name the value, never its type. A field called `theme` is read as "name the
//   kind of thing" and comes back `new_label_wording`; called `label`, it comes
//   back with a label.
//
//   Constrain shape, not prose. A schema whose only content is one unbounded
//   string is not a shape. `draft` had one, and the model returned the account it
//   had just been given — the likeliest long string, with the source in context.
//   There is no entry for `draft` here, so its reply is asked for and read as
//   what it is: writing.
export const SHAPES = {
  theme: {
    type: 'object',
    properties: {
      label: {
        type: 'string',
        description: 'The wording itself, as it should be written from now on',
      },
    },
    required: ['label'],
  },

  'collection[theme]': {
    type: 'object',
    properties: {
      themes: {
        type: 'array',
        items: { type: 'string' },
        description: 'Short labels, one to five words each, no numbering and no explanation',
      },
    },
    required: ['themes'],
  },

  // Two lessons, both paid for against a real model, and the second undoes half
  // of the first.
  //
  //   A model writes its most salient answer into the **first string field it
  //   meets**, whatever that field is called. With `why` declared first, a
  //   `same: true` came back `why: "The peace of the countryside"` — the chosen
  //   wording, in the field meant for the reason — and no `label` at all. With
  //   `label` first it answers `label: "The peace of the countryside"` and
  //   `why: "Both phrases describe the same concept of rural tranquility…"`.
  //   Declaration order is the whole of the fix, and only for *required*
  //   fields: llama.cpp's grammar ignores the order of optional ones, so
  //   reordering while `label` was optional changed nothing at all.
  //
  //   `why` still has to exist. Before it did, a `same: false` wrote its
  //   reasoning into `label` — `"Theme B is broader than Theme A."` — a theme
  //   label that is not one. Making `label` optional did not stop that; giving
  //   the explanation a home of its own did.
  //
  // So: both required, `label` first. When `same` is false the model writes
  // something like `"no"` into `label`, which is its answer to the question
  // rather than a label — and the reader throws it away, because a wording to
  // keep is meaningless when nothing is being merged.
  judgement: {
    type: 'object',
    properties: {
      same: {
        type: 'boolean',
        description: 'true only if the two are the same concept, false if either is broader, '
          + 'narrower, or a different side of the same subject',
      },
      label: {
        type: 'string',
        description: 'When same is true, whichever of the two given wordings is clearer, '
          + 'copied exactly. When same is false, an empty string.',
      },
      why: {
        type: 'string',
        description: 'One short sentence saying why they are or are not the same concept',
      },
    },
    required: ['same', 'label', 'why'],
  },

  verdict: {
    type: 'object',
    properties: {
      present: {
        type: 'boolean',
        description: 'true if the theme clearly appears in the account, false otherwise',
      },
      why: {
        type: 'string',
        description: 'One short sentence saying why it is present or absent',
      },
    },
    required: ['present', 'why'],
  },
};

/** The schema a reply of this type has to satisfy, or nothing — which is what
 *  makes a type prose rather than a shape. */
export const schemaFor = (gives) => SHAPES[gives];

// Built once: both runtimes are llama.cpp and take the same request.
// `response_format` is the point of it — it constrains the sampler to the schema
// the box's type declares, so a reply cannot arrive in the wrong shape.
export const askFor = (instruction, content, { gives, seed } = {}) => {
  const schema = schemaFor(gives);
  return {
    messages: [
      ...(instruction ? [{ role: 'system', content: instruction }] : []),
      { role: 'user', content },
    ],
    // Room for a thought *and* an answer: `max_tokens` counts both. A trace runs
    // to a couple of hundred tokens on an easy question and past nine hundred on
    // a hard one — measured, on a `collection[theme]` whose whole budget went to
    // thinking and returned `content: ""` at the old cap of 900. The cap is not a
    // target: a ceiling nothing reaches costs nothing, and hitting one costs the
    // whole run. Half the context, against prompts of a few hundred tokens.
    max_tokens: 4096,
    // A seeded box samples, an unseeded one is greedy and says the same thing
    // every run — the same rule the scripted stand-in follows by being a function.
    temperature: seed === undefined ? 0 : 0.8,
    ...(seed === undefined ? {} : { seed }),
    ...(schema ? {
      response_format: {
        type: 'json_schema',
        json_schema: { name: String(gives).replace(/\W/g, '_'), schema },
      },
    } : {}),
  };
};

/** What a provider gives back. The thought is kept because in a qualitative
 *  analysis the *why* is the finding, and the Log is where it is read. */
export const answer = (text, thought = '') => ({
  text: String(text ?? ''),
  thought: String(thought || ''),
});

/** What the model said, and what it thought on the way.
 *
 *  A reply cut off mid-thought is the one failure that does not look like one:
 *  `content` is `''`, the schema was never reached, and whatever reads it
 *  reports "no labels in the reply" — which blames the model for an answer it
 *  was never given room to write. Say what actually happened instead. */
export const said = (response) => {
  const turn = response?.choices?.[0]?.message ?? {};
  if (!String(turn.content ?? '').trim() && response?.choices?.[0]?.finish_reason === 'length') {
    throw new Error('the model was still thinking when max_tokens ran out, so it never answered');
  }
  return answer(turn.content, turn.reasoning_content);
};

const WLLAMA = 'https://cdn.jsdelivr.net/npm/@wllama/wllama@3.6.1/esm';

// The model, chosen once so that nobody arriving at this page has to choose it.
// Straight from the Hugging Face CDN, unsplit, and no hosting to arrange.
//
// Quantisation-aware trained, and requantised per layer by Unsloth — which is
// what makes it 2700 MiB where Google's own Q4_0 is 3494. Everything lives in
// wllama's 4.29 GB heap, so those 800 MB are the difference between a 2048
// context and a 4096 one. Reasoning traces are long; the room is the point.
export const MODEL = {
  label: 'Gemma 4 E2B',
  bytes: 2620e6,
  note: 'Google\u2019s quantisation-aware weights at 4 bits, requantised per layer '
    + 'by Unsloth. Runs in this tab; the browser keeps it, so it downloads once.',
  url: 'https://huggingface.co/unsloth/gemma-4-E2B-it-qat-GGUF'
    + '/resolve/main/gemma-4-E2B-it-qat-UD-Q4_K_XL.gguf',
};

// The second model, and the reason there is one is in `wasmProvider` below: a
// llama.cpp context cannot both write and place.
//
// Small because the job is small — rank which pairs of theme labels are worth
// asking a real question about — and because a 33M-parameter model is where
// quantising stops being economy: f16 is 67 MB, q8_0 is 37, and the thirty
// megabytes buy nothing against a 2.6 GB sibling while costing precision on the
// one number this model produces. 384 dimensions, BERT, and near the top of its
// size class at sentence similarity.
export const EMBEDDER = {
  label: 'BGE small en v1.5',
  bytes: 67e6,
  note: 'Places a theme label in meaning-space, so the pairs worth asking about '
    + 'can be ranked. Guidance for the model that judges; never the judgement.',
  url: 'https://huggingface.co/CompendiumLabs/bge-small-en-v1.5-gguf'
    + '/resolve/main/bge-small-en-v1.5-f16.gguf',
};

/** What the tab has to fetch before it can answer anything, as bytes and as
 *  words. Both models, because both are needed and neither is optional. */
export const weightsCost = () => MODEL.bytes + EMBEDDER.bytes;

/** WebGPU if the browser has an adapter, CPU otherwise. wllama decides this for
 *  itself — `n_gpu_layers` defaults to everything — but the page should be able
 *  to say which it got, because it is most of the difference in how long a run
 *  takes. */
export async function accelerator() {
  try {
    return (await navigator.gpu?.requestAdapter()) ? 'webgpu' : 'cpu';
  } catch {
    return 'cpu';
  }
}

/** Where a model in the tab keeps its weights: wllama's own cache, not the
 *  Cache Storage key Transformers.js used. */
const cacheManager = async () => new (await import(/* @vite-ignore */ `${WLLAMA}/index.js`)).CacheManager();

export async function heldWeights() {
  try {
    const entries = await (await cacheManager()).list();
    return entries.reduce((at, one) => at + (one.size || 0), 0);
  } catch {
    return 0;
  }
}

export async function forgetWeights() {
  try { await (await cacheManager()).clear(); } catch { /* nothing cached */ }
}

/** Ask the browser to treat this origin's storage as worth keeping. A model is
 *  gigabytes, and best-effort storage is the first thing evicted. */
export const keepStorage = async () => {
  try { return await navigator.storage?.persist?.() ?? false; } catch { return false; }
};

export const stopped = (err) => err?.name === 'AbortError' || /abort/i.test(err?.message || '');

/** How many threads a tab can actually use. Without cross-origin isolation there
 *  is no SharedArrayBuffer and llama.cpp runs on one thread, which is the single
 *  biggest thing between a usable run and an unusable one. A static host that
 *  cannot set COOP/COEP headers is stuck with one. */
export const threads = () => (globalThis.crossOriginIsolated
  ? Math.max(1, Math.min(16, navigator.hardwareConcurrency || 4)) : 1);

/** One llama.cpp in the tab. The load parameters are what separate a model that
 *  writes from a model that places, and everything else here is the same. */
function tabEngine({ url, params, onProgress, onTrouble, onSaid }) {
  let ready = null;
  let engine = null;
  let cancel = null;

  // llama.cpp says a great deal while it loads, and it is the only thing that
  // knows what actually happened. Two lines in it are worth more than anything
  // the page can work out for itself:
  //
  //   `ggml_webgpu: adapter_info: …` — the GPU was really taken up. Its absence
  //   is the whole of the difference between offloading and not, and nothing
  //   else reports it: `navigator.gpu.requestAdapter()` answering yes says the
  //   *browser* has an adapter, not that ggml got one.
  //
  //   anything at error level — `worker.onerror` is logged by wllama and does
  //   **not** become a rejected task, so a worker that dies takes every call
  //   waiting on it with it, silently and forever.
  //
  // So every line is passed out rather than left in the devtools console.
  const relay = (level) => (...args) => {
    const line = args.map((one) => one?.message ?? String(one)).join(' ').trim();
    if (line) onSaid?.({ level, line });
    if (level === 'error' && line) onTrouble?.(line);
    (console[level] || console.log)(...args);
  };

  const logger = {
    debug: relay('debug'), log: relay('log'), warn: relay('warn'), error: relay('error'),
  };

  return {
    stop() {
      cancel?.abort();
      engine?.exit?.().catch(() => {});
      engine = null;
      ready = null;
    },

    load: () => (ready ??= (async () => {
      if (!url) throw new Error('no GGUF URL');
      const { Wllama } = await import(/* @vite-ignore */ `${WLLAMA}/index.js`);
      cancel = new AbortController();
      engine = new Wllama({ default: `${WLLAMA}/wasm/wllama.wasm` }, { logger });
      try {
        await engine.loadModelFromUrl(url, {
          n_threads: threads(),
          ...params,
          progressCallback: ({ loaded, total }) => onProgress?.({ done: loaded, total }),
        });
        return engine;
      } catch (err) {
        ready = null;
        throw err;
      }
    })()),
  };
}

/** llama.cpp compiled to WebAssembly, running in this tab — **twice**.
 *
 *  A llama.cpp context loaded with a pooling type set produces no logits, so the
 *  model that writes cannot also be the model that places: `createEmbedding`
 *  refuses outright unless the model was loaded with `embeddings: true`, and
 *  turning that on is what takes generation away. Two contexts is not a
 *  workaround, it is the shape of the thing — and it is the same split the
 *  original study ran, one `llama-server` for generation and one for embeddings.
 *
 *  The second one is cheap enough that the first barely notices: each `Wllama`
 *  is its own wasm module with its own heap, so the embedder costs nothing out
 *  of Gemma's headroom, and 67 MB against 2620 is the whole of the extra
 *  download.
 *
 *  GGUF straight from a URL; a file over 2 GB has to be split with
 *  `llama-gguf-split` first, because emscripten's `ftell` cannot address past
 *  2^31 bytes — point this at the first shard and wllama finds the rest. */
/** What llama.cpp said about the device it got. The line is the only place the
 *  truth is written down, so reading it is how the page knows. */
const ADAPTER = /ggml_webgpu:\s*adapter_info:\s*(.*)/;

const readAdapter = (line) => {
  const found = line.match(ADAPTER);
  if (!found) return null;
  const fields = Object.fromEntries(found[1].split('|')
    .map((one) => one.split(':').map((part) => part.trim()))
    .filter((pair) => pair.length === 2));
  return [fields.vendor, fields.architecture, fields.name].filter(Boolean).join(' ') || 'a WebGPU device';
};

export function wasmProvider({ gpu = true, onProgress, onTrouble } = {}) {
  // Two downloads, one bar. Each part's own size stands in until wllama reports
  // its total, so the bar does not finish and then grow a second time.
  const at = new Map();
  const say = () => onProgress?.({
    done: [MODEL, EMBEDDER].reduce((n, one) => n + (at.get(one.url)?.done || 0), 0),
    total: [MODEL, EMBEDDER].reduce((n, one) => n + (at.get(one.url)?.total || one.bytes), 0),
  });
  const watch = (one) => (seen) => { at.set(one.url, seen); say(); };

  // Everything both engines said, newest last, and what it adds up to.
  const heard = [];
  let adapter = null;
  const listen = ({ level, line }) => {
    heard.push({ level, line });
    if (heard.length > 400) heard.shift();
    adapter ??= readAdapter(line);
  };

  const writer = tabEngine({
    url: MODEL.url,
    onProgress: watch(MODEL),
    onTrouble,
    onSaid: listen,
    params: {
      // 2700 MiB of weights against a 4.29 GB heap leaves about 1.4 GB, and
      // KV cache and compute buffers both scale with the context — 36 MiB of
      // cache at 2048, so 8192 is a few hundred megabytes of the spare and
      // leaves the thinking room it needs. Google's 3494 MiB build could not
      // even hold 4096, which is why the weights were changed and not this.
      // GPU and CPU are the same download; only where the layers end up
      // differs. wllama keys its cache on the URL, so switching is a reload.
      n_gpu_layers: gpu ? 99999 : 0,
      n_ctx: 8192,
      // One sequence; llama.cpp reserves four by default.
      n_parallel: 1,
      // The thinking is most of what makes this model worth using: without it
      // a `verdict` comes back `present: true` with a justification arguing
      // the opposite. `deepseek` keeps thought and answer apart, so `content`
      // stays schema-valid JSON.
      reasoning_format: 'deepseek',
    },
  });

  const placer = tabEngine({
    url: EMBEDDER.url,
    onProgress: watch(EMBEDDER),
    onTrouble,
    onSaid: listen,
    params: {
      n_gpu_layers: gpu ? 99999 : 0,
      // A theme label is a handful of tokens and this model reads 512 at most.
      n_ctx: 512,
      n_parallel: 1,
      embeddings: true,
      // No `pooling_type`: llama.cpp then takes the model's own, which is the
      // one it was trained with. Forcing `mean` here made llama.cpp say so —
      // `model default pooling_type is [2], but [1] was specified` — because BGE
      // pools on CLS. An embedder knows its own pooling; overriding it is how a
      // vector quietly stops meaning what the model meant.
    },
  });

  return {
    name: gpu ? 'gpu' : 'cpu',
    model: MODEL.url,

    /** Everything llama.cpp said, for a panel that wants to show it. */
    heard: () => heard,

    /** Where the work is actually being done, once something has loaded —
     *  `asked` is what the page requested, `got` is what llama.cpp reported.
     *  They disagree when the browser has an adapter and ggml could not take
     *  it, which is silent and is most of the difference in how long a run
     *  takes. */
    device: () => ({ asked: gpu ? 'webgpu' : 'cpu', got: adapter ? 'webgpu' : 'cpu', adapter }),
    // Kept apart from `model` so the reply cache keys a vector on what made it:
    // change the embedder and old vectors stop being answers to this question.
    embedModel: EMBEDDER.url,

    // The writer first: it is the big download and the first thing a run asks
    // for, so a run can start while nothing is left but the small one.
    load: async () => { await writer.load(); await placer.load(); },

    stop() {
      writer.stop();
      placer.stop();
      at.clear();
    },

    // `abortSignal` is what makes Stop able to interrupt a call that is already
    // in flight. wllama checks it between polls for the next chunk and cancels
    // the request; without one, Stop can only take effect between steps, which
    // on a model in the tab is minutes away and looks like nothing happening.
    async generate(instruction, content, options = {}) {
      const wllama = await writer.load();
      return said(await wllama.createChatCompletion({
        ...askFor(instruction, content, options),
        ...(options.signal ? { abortSignal: options.signal } : {}),
      }));
    },

    async embed(text, { signal } = {}) {
      const wllama = await placer.load();
      const out = await wllama.createEmbedding({
        input: text,
        ...(signal ? { abortSignal: signal } : {}),
      });
      return out?.data?.[0]?.embedding ?? out;
    },
  };
}
