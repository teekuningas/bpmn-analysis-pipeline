# Analysis pipelines as BPMN

An analysis — accounts in, findings out — drawn as a BPMN process built from seven
primitives, and then actually run, in the browser, with a real model if you want
one. Everything else is arrangement: a multi-instance marker is `map`, a
sequential one is also `fold`, a fork and join runs independent branches.
`filter` and `fold` are not structure here but primitives — Select and Combine.

Each primitive carries a shape — `Select` is `collection[a] → collection[a]` —
and each box in a process fills it in: `collection[account] →
collection[account]`. Hover a box to see what it takes and gives, click it to
see what it actually made. The wiring is type-checked before it runs.

[**Live demo**](https://teekuningas.github.io/bpmn-analysis-pipeline/)

```sh
python3 -m http.server 8000    # ES modules need http, not file://
```

## What is here

```
core/       the language and the interpreter — no dependencies
runtime/    what the primitives do, and where the model comes from
studies/    the analyses: a process, its data, its settings
app/        the page
tools/      the checks
```

Strictly downward: `app → runtime → core`, and nothing in `core` knows there is
a browser.

## Running it

Open it, look at the accounts in the panel, press **Run**. The first Run fetches
the model; after that the browser keeps it. There is nothing to configure.

The model is Gemma 4 E2B — Google's quantisation-aware weights, requantised per
layer by Unsloth — running on [llama.cpp compiled to
WebAssembly](https://github.com/ngxson/wllama). No server, no API key. It uses
the GPU where the browser has WebGPU and the CPU where it does not, and it
reasons before it answers: the thinking is shown in the **Log** panel, which in a
qualitative analysis is the interesting part. Every box's declared type is
enforced on the reply as a JSON schema, so a reply cannot come back misshapen.

**Setup** (a tab in the panel) holds everything a first visit should not have to
see: which backend it got, the download's state, a scripted stand-in that needs no
download, how many accounts to read, how many pairs to compare per round, and the
per-step delay.

### Hosting it

Copy the files anywhere static. The model comes from the Hugging Face CDN, so
there is nothing else to host.

The one thing that matters: serve the page with
`Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`. Without them there is no
`SharedArrayBuffer` and llama.cpp gets **one** CPU thread. GitHub and GitLab Pages
cannot set headers per project; any host you control can. A browser with WebGPU
cares much less, since the threads are only for the CPU path.

On a CPU expect a few tokens a second, so a first run takes a while; the model
thinks before it answers and a single judgement runs to a few hundred tokens. A
browser with WebGPU is much faster and needs nothing from this page — Chromium on
Linux wants `--enable-unsafe-webgpu`; most other platforms have it already.

## Adding an analysis

A study is a folder under `studies/` and a line in `studies/index.json`:

```
studies/your-study/
  study.json      title, question, sources, settings, how to show it
  process.bpmn    the method — the only file a modeller touches
  *.json          the sources the process reads by name
```

## Checking a change

```sh
python3 tools/check.py studies/<id>/process.bpmn   # structure and geometry
node tools/smoke.mjs                               # every study, end to end
```

The type check runs in the page on load; a process that does not check does not
run.

The engine covers the elements these processes use and nothing else, and refuses
a file that reaches outside it. For real work use
[SpiffWorkflow](https://github.com/sartography/SpiffWorkflow),
[bpmn-engine](https://github.com/paed01/bpmn-engine), or Camunda — the
`spiff:` extension elements are there so the same file can go to one.
