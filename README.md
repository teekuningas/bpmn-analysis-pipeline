# Analysis pipeline as BPMN

An analysis pipeline — accounts in, findings out — drawn as a BPMN process
built from ten primitives. Everything else is arrangement: a multi-instance
marker is `map`, a fork and join runs independent branches, a standard loop is
`iterate`. `filter` and `fold` are not structure here but primitives — Select
and Combine.

Each primitive carries a shape — `Select` is `collection[a] → collection[a]` —
and each box in the model fills it in: `collection[account] →
collection[account]`. Hover a box to see what it takes and gives, or an arrow to
see the value travelling along it. The wiring is type-checked before it runs.

[**Live demo**](https://teekuningas.github.io/bpmn-analysis-pipeline/)

```sh
python3 -m http.server 8000    # ES modules need http, not file://
```

```
workflows/pipeline.bpmn   the process, editable in any BPMN modeller
app/primitives.js         the vocabulary
app/types.js              the type language, and the check
app/engine.js             BPMN interpreter
app/ui.js                 diagram and playback
tools/check.py            structural and geometric checks on the model
```

Primitives are signatures and durations, not implementations: the demo plays the
process rather than computing anything. The engine covers the elements this
diagram uses and nothing else — for real work use
[SpiffWorkflow](https://github.com/sartography/SpiffWorkflow),
[bpmn-engine](https://github.com/paed01/bpmn-engine), or Camunda.
