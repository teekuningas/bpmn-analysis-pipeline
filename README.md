# Analysis pipeline as BPMN

A toy that asks one question: **what if a qualitative-analysis pipeline were a
diagram you can run, instead of a stack of scripts wired together by pasting
output paths between them?**

[**Open the live demo →**](https://teekuningas.github.io/bpmn-analysis-pipeline/)

Everything runs in the browser. No server, no build step, no API key, no
dependencies beyond a vendored copy of [bpmn-js](https://bpmn.io) for drawing.

---

## The idea

A real analysis pipeline — interviews in, statistics out — usually ends up as a
handful of scripts plus a Makefile, glued together by constants like:

```python
INPUT_FILE = "output/koodit/487ef9e9/koodit_raw.txt"      # in script B
THEMES     = "output/analyysi_koodit/7176421e/themes.csv" # in script C's Makefile
```

Nothing checks that those agree. The order of the steps lives in a human's head,
the branch structure lives in a Makefile, and the fact that a person eyeballs a
dendrogram halfway through is written down nowhere at all.

Here the same shape of pipeline is modelled as **one BPMN process**:

- Every box is a **service task** naming an op from a **registry**
  (`corpus.read`, `llm.embed`, `stats.chi_square`, …). The diagram references
  names — never paths, model ids or run hashes.
- The loops of LLM calls are **real BPMN multi-instance activities**, not hidden
  inside a mega-function. You can watch `12/12` narratives and `70/70` code
  embeddings tick past on the diagram as they run.
- The pipeline **forks**: narratives → themes on one branch, site context on the
  other, joined before the statistics. A real DAG, not a straight line.
- The judgement call — *where do I cut the dendrogram?* — is a **user task**.
  The process stops and asks. That step exists in every real pipeline and is
  usually invisible.
- Values passed between tasks are **artifact references**
  (`{artifact: "3f9c…", kind: "codes", n: 70}`), never payloads. Same inputs,
  same id.

## What it actually computes

Twelve short synthetic Finnish nature narratives (six rural, six urban) go in.
The pipeline induces a codebook from them, embeds and clusters the codes,
consolidates each cluster into a theme, scores every narrative against every
theme, and tests theme presence against site type with chi-square + FDR.

It recovers what was planted: *Maaseutuympäristö* with rural sites,
*Liikenteen melu* and *Kaupungin viheralueet* with urban ones.

## Running it

```sh
git clone https://github.com/teekuningas/bpmn-analysis-pipeline
cd bpmn-analysis-pipeline
python3 -m http.server 8000     # any static server; ES modules need http, not file://
```

Then open <http://localhost:8000>.

## Layout

```
workflows/pipeline.bpmn   the process. open it in any BPMN modeller and edit it
app/registry.js           op registration + catalogue
app/ops.js                the 14 ops. each is 5-30 lines
app/mockllm.js            deterministic stand-in for the LLM
app/engine.js             ~200-line BPMN interpreter (the toy part)
app/artifacts.js          content-addressed store
app/ui.js                 diagram, token highlighting, inputs, inspector
demo/data/                12 synthetic narratives + their site metadata
```

## Honest limits

**The LLM is fake.** `app/mockllm.js` is a keyword lexicon plus a hashed-trigram
embedding, so the demo is deterministic, offline and free. Every op that would
call a model is tagged `llm` in the registry; pointing those at a real endpoint
is a change to that one file. The *workflow* is what is being demonstrated, not
the model.

**The engine is a toy.** `app/engine.js` covers start/end events, service tasks,
user tasks, parallel and exclusive gateways, expanded sub-processes and
multi-instance loops — enough for this pipeline and nothing else. No timers, no
messages, no compensation, no persistence, no real parallelism (multi-instance
activities run one after another; only the two top-level branches interleave).
For anything real use [SpiffWorkflow](https://github.com/sartography/SpiffWorkflow)
(Python), [bpmn-engine](https://github.com/paed01/bpmn-engine) (Node), or
Camunda/Flowable.

The service-task XML deliberately follows SpiffWorkflow's
`spiff:serviceTaskOperator` convention, so the same `.bpmn` can be handed to a
real engine — the only dialect difference is that parameter expressions here are
JavaScript (`inputs.seed`) rather than Python (`inputs['seed']`).

**The statistics are minimal.** A 2×2 chi-square with Cramér's V and
Benjamini-Hochberg correction. No mixed-effects models, no clustering by
participant — with twelve narratives there is nothing yet to be careful about.
