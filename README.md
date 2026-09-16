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

## The two analyses

**Five texts, five summaries** is the one to open first, and it is what the page
loads with. Read five short notes, keep as many as the knob allows, hand each one
to a model: three primitives, one model call per text, and the summaries in the
**Output** panel. It is the whole idea at a size that fits on one screen.

**Themes and place** is the real one — fifty accounts of experiences in nature,
read twice each, consolidated into a shared vocabulary, judged one theme at a
time, joined with where each was recorded, and tested. It is the analysis the
research notebooks do, in a diagram.

## Running it

Open it, look at the texts in the panel, press **Run**. On the scripted stand-in
that is the whole of it. Picking a model in **Setup** is what opts into the
download; the first Run then fetches it, and after that the browser keeps it.

The model is Gemma 4 E2B — Google's quantisation-aware weights, requantised per
layer by Unsloth — running on [llama.cpp compiled to
WebAssembly](https://github.com/ngxson/wllama). No server, no API key. It uses
the GPU where the browser has WebGPU and the CPU where it does not, and it
reasons before it answers: the thinking is shown in the **Log** panel, which in a
qualitative analysis is the interesting part. Every box's declared type is
enforced on the reply as a JSON schema, so a reply cannot come back misshapen.

**`Embed` is a second model**, BGE small at 67 MB, in a second llama.cpp instance
beside the first. Not a choice: a llama.cpp context loaded to produce embeddings
produces no logits, so the model that writes cannot be the model that places —
which is the same split the original study ran, one server each. It ranks which
pairs of themes are worth asking about; it never decides anything.

The **Log** is every call to a model and nothing else — `Generate` and `Embed`.
The boxes that read, filter, fold, join and test compute rather than ask, so they
go past without appearing there; the diagram is where those are watched. A call
shows up when it is *sent*, so on a real model you can read the question while
the answer is still being written.

**Setup** (a tab in the panel) holds everything a first visit should not have to
see: which backend it got, the download's state, a scripted stand-in that needs no
download, and the knobs for how much to run.

**The knobs start where the pair of choices puts them** — this study, and this way
of answering. A model in the tab is minutes a call, so it starts at as little as
the study allows; the stand-in costs nothing, so it starts at the whole of it and
shows the entire analysis. A study writes `by` in a setting only when it disagrees
with that rule. Switching the model puts them back; moving one is what overrides
it.

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
  study.json      title, question, sources, settings, types, how to show it
  process.bpmn    the method — the only file a modeller touches
  *.json          the sources the process reads by name
```

A study names its own types in `study.json`. A sentence describes one; `is` says
what shape a value of it has, and the only shape a study can declare so far is
`text` — writing, with no schema over it:

```json
"types": {
  "note":    { "about": "one short text, as it was written" },
  "summary": { "about": "one short summary of one text", "is": "text" }
}
```

**No `is` means no model makes it.** `note` comes from a source, `row` from
`Combine`, `finding` from `Test`. A type with `is: "text"` is one a `Generate` can
be told to give: the runtime reads the reply as writing, the stand-in writes a
keyword sentence for it, and the panel draws it as prose — with nothing in
`runtime/` or `app/` edited. Every other type still needs a reader, a shape and a
rendering, which is the open direction in `PLAN.md`.

## Checking a change

```sh
python3 tools/check.py studies/<id>/process.bpmn   # structure, geometry, routing
node tools/smoke.mjs                               # every study, end to end
```

The type check runs in the page on load; a process that does not check does not
run. `check.py` also refuses a diagram where a line runs through a box it has
nothing to do with, which is the rule a hand-placed waypoint breaks most often
and the eye notices least.

To read what a real model actually says, without waiting out a run in the tab,
point `tools/probe.mjs` at any OpenAI-shaped llama.cpp endpoint. It runs the same
study through the same engine, and the request it sends is built by the same
`askFor()` the page uses, so it cannot drift from what the browser does:

```sh
LLM_URL=http://host:8080/v1 LLM_KEY=… LLM_MODEL=… \
  node tools/probe.mjs nature-and-place --sample 4 --pairs 6
```

Every call prints what it was given, what the model thought, and what it replied.
Unlike the page, the probe *does* cache — to a file, so re-running it while a prompt
is being worked on only pays for the calls that changed. `LLM_CACHE` says where.

The engine covers the elements these processes use and nothing else, and refuses
a file that reaches outside it. For real work use
[SpiffWorkflow](https://github.com/sartography/SpiffWorkflow),
[bpmn-engine](https://github.com/paed01/bpmn-engine), or Camunda — the
`spiff:` extension elements are there so the same file can go to one.
