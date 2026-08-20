# Analysis pipeline as BPMN

An analysis pipeline — documents in, findings out — drawn as a BPMN process
built from ten primitives. Everything else is arrangement: a multi-instance
marker is `map`, a fork and join runs independent branches, a loop marker
repeats until settled. `filter` and `fold` are not structure here but
primitives — Select and Combine.

[**Live demo**](https://teekuningas.github.io/bpmn-analysis-pipeline/)

```sh
python3 -m http.server 8000    # ES modules need http, not file://
```

```
workflows/pipeline.bpmn   the process, editable in any BPMN modeller
app/primitives.js         the vocabulary
app/engine.js             BPMN interpreter
app/ui.js                 diagram and playback
```

Primitives are signatures and durations, not implementations: the demo plays the
process rather than computing anything. The engine covers the elements this
diagram uses and nothing else — for real work use
[SpiffWorkflow](https://github.com/sartography/SpiffWorkflow),
[bpmn-engine](https://github.com/paed01/bpmn-engine), or Camunda.
