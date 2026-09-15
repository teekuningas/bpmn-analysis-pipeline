# Analysis pipelines as BPMN

An analysis — accounts in, findings out — drawn as a BPMN process built from six
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

## The two models you can run it with

| | download | what it is |
| --- | --- | --- |
| **Scripted stand-in** | none | keyword matching. Not a language model — but every step runs and the statistics at the end are computed, not staged. The baseline a real model has to beat. |
| **Gemma, in this tab** | ~1–3 GB | [Transformers.js](https://huggingface.co/docs/transformers.js) over WebGPU, falling back to WebAssembly where there is none. Press **Download** once; the browser keeps the weights, so nothing is committed here and later runs start straight away. |

Replies are remembered, so a second run of the same thing is free. **Delay** holds
on each step so a run can be watched rather than just waited out.

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
