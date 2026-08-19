# Analysis pipeline as BPMN

A qualitative-analysis pipeline — narratives in, statistics out — modelled as a
BPMN diagram you can run, instead of a stack of scripts wired together by pasting
output paths between them.

[**Live demo**](https://teekuningas.github.io/bpmn-analysis-pipeline/) — runs in
the browser. No server, no build step, no API key.

![the pipeline](docs/diagram.png)

## What the diagram says

- Each box is a **service task** naming an op from the registry in `app/ops.js`.
  The BPMN file references names, never paths or model ids.
- **Nested multi-instance loops**: for each narrative, for each iteration, ask the
  model for a codebook. Then one embedding call per pooled code. The loops are
  BPMN, not hidden inside a function.
- A **parallel fork**: narratives → themes on one branch, site context on the
  other, joined before the statistics.
- A **user task**: where to cut the dendrogram is a person's decision, so the
  process stops and asks.
- An **exclusive gateway**: chi-square or Fisher exact, chosen by input rather
  than by editing code.

Tasks pass artifact references (`{artifact: "3f9c…", kind: "codes", n: 140}`),
never payloads.

## Running it

```sh
python3 -m http.server 8000    # ES modules need http, not file://
```

## Layout

```
workflows/pipeline.bpmn   the process
app/ops.js                the ops
app/mockllm.js            deterministic stand-in for the model
app/engine.js             BPMN interpreter
app/registry.js           op names
app/artifacts.js          artifact store
app/ui.js                 page
demo/data/                12 synthetic narratives, six rural and six urban
```

## Limits

The LLM is fake: `app/mockllm.js` is a keyword lexicon and a hashed-trigram
embedding, so runs are deterministic and offline. Ops that would call a model are
tagged `llm`.

The engine is a toy: it covers the elements this diagram uses and nothing else —
no timers, messages, compensation, persistence, or real parallelism. For real
work use [SpiffWorkflow](https://github.com/sartography/SpiffWorkflow),
[bpmn-engine](https://github.com/paed01/bpmn-engine), or Camunda. The service
tasks follow SpiffWorkflow's `spiff:serviceTaskOperator` convention; the only
dialect difference is that parameter expressions here are JavaScript.

The data is invented for this demo. No real interview data is in this repository.
