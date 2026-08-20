# Working notes

Why this model looks the way it does, and what we decided not to do. Written so
the next round of refinement does not re-litigate settled ground.

## What it is

A qualitative-analysis pipeline — accounts in, findings out — as one BPMN
process built from ten primitives, playable in the browser. The point is not
the demo. The point is that a researcher with a modeller and this vocabulary
could assemble a real pipeline, and a colleague reading the diagram could
think *I understand all of this, I could have built it myself*.

## Principles

**The vocabulary is small; the arrangement carries the analysis.** Ten
primitives, sixteen tasks. `Generate` appears four times and means something
different each time because of where it sits, what prompt it was given, and
what types it was told to take and give. `Read`, `Select` and `Combine` appear
twice each. The other six appear once — not because they are suspect, but
because this pipeline runs one context table and one cohort; the study it is
drawn from repeats `Join` and `Test` four times over. Still, if a primitive is
only ever used once and could not obviously be used twice, suspect it.

**A primitive carries a shape; a box carries a type.** `Select` is
`collection[a] → collection[a]`, which says only that whatever goes in comes
back thinned. The box in the model says `collection[account] →
collection[account]`. That split is the whole idea: the modeller drops in a
general box, names the types it takes and gives, and the check is that the
naming holds along the wiring. Ten shapes, nine names, one process.

**BPMN supplies the control combinators, the vocabulary supplies the data
ones.** A multi-instance marker is `map` — it runs the body once per item and
collects one result per instance. A standard loop is `iterate`. A fork and join
runs independent branches. A boundary event is `catch`. But `filter` and `fold`
are *primitives* here — Select and Combine — not structure. An exclusive
gateway is `if`, not `filter`; we do not currently use one.

**Only model what carries method.** Running the same flow four times over four
metadata sets is scheduling, not method — it belongs to the runner. Two cohorts
compared against each other was the history of the study, not its logic. Both
were removed. Structure that looks like meaning is worse than no structure.

**Never hand the model an unbounded list and ask for a list back.** One
account at a time, one group at a time, one `pair[account, theme]` at a time.
The scoring step is a loop inside a loop for this reason, which is also what the
original does: one call per (account, theme).

**Primitives must be independent.** Two were split out after they turned out to
be doing someone else's job: `Test` (statistical inference) was hiding inside
`Compare` (pairwise measurement), and `Join` (keyed, can drop rows) was hiding
inside `Combine` (concatenation, keeps everything). That second one matters: a
join is where the sample size quietly changes.

**Every box has wiring, settings, and a type.** Wiring (`of`, `parts`, `left`,
`right`, `threshold`) says what flows in. Settings (`prompt`, `question`,
`metric`, `where`, `how`, `on`, `by`, `source`, `test`, `model`) are what the
modeller fills in. `gives` is the type of what comes out — the one part of a
signature that cannot be derived. All three live in `spiff:parameter`, told
apart by key name; a real tool would separate them in its schema.

**Signatures are enforced, not decorative.** `app/types.js` parses every type,
fills the primitive's variables from what each box declares, and checks every
wired read against them before the process runs; a model that does not check
does not run. Writing the first version of that check found four boxes reading
from thin air. Writing this one found two boxes that were not doing anything.

**The control flow must not assert dependencies the data does not have.** The
fork used to sit after the first read, which said the site records waited for
the accounts. They do not — they are a second source. The fork moved ahead of
both reads.

**Do not draw data flow the control flow already implies.** Every wired read is
reachable from its producer by following arrows, so drawing all seventeen as
data associations would double the marks to restate reachability. Four of them
reach a long way — `accounts` into `Draft` and into `Select`, `themes` into
`Score`, `context` into `Join` — and those are the only ones worth drawing if we
ever draw any. Hovering an arrow names the value on it meanwhile, and the type
check enforces all of them.

**Minimal text.** The README stays tiny. Annotations are few and in plain
language, never naming a script or a variable. The primitive and type reference
lives in the app, not the README. Hover carries the detail so the canvas does
not.

## What of BPMN is used

Start and end events, a parallel fork and join, expanded sub-processes,
sequential multi-instance markers, a standard loop marker, an error boundary
event with a timer catch, a user task where a person acts, text annotations,
and properties for the data. That is most of what BPMN offers for drawing a
computation, and each one is carrying a meaning rather than decorating.

Considered and not used:

- **Lanes.** A lane each for the person, the model and the machine would say
  who acts, which is what lanes are for. But lanes force a banded left-to-right
  layout, and this process folds back on itself three times; banding it would
  cost more legibility than it buys. The person is shown by a user task, the
  model calls by a tint and a dot in the legend.
- **A call activity** for `Refine the vocabulary`, which is the one part a real
  modeller would want to reuse. Left inline so the whole method is on one page.
- **Names on the two retry events.** bpmn-js wraps a boundary event's label to
  the width of the event itself, so even `fails` breaks across two lines. The
  icons and the arrow back into the task have to carry it.
- **An exclusive gateway.** We have no branch to draw. See the known gaps.

## The type language

A type is a name, optionally applied to other types. Three constructors:

| | |
| --- | --- |
| `collection[t]` | many `t`, in order |
| `matrix[t]` | every `t` against every `t`, a number in each cell |
| `pair[t, u]` | one of each, side by side |

Nine names. Six are the modeller's and mean nothing to the vocabulary:
`account`, `draft`, `theme`, `verdict`, `row`, `site`. Three belong to the
vocabulary, because a primitive manufactures them and nothing else can:
`vector` from `Embed`, `number` from `Decide`, `finding` from `Test`. That split
is the rule for where a name belongs — if no primitive makes it, it is the
modeller's.

Names are nominal. `account` and `draft` are both text underneath and keeping
them apart is exactly the point. Single letters are variables and appear only in
the primitives.

Every name earns its place: each one is given by at least one box and read by at
least one other. Nothing is written and never read, and nothing is read that
nothing writes — the check enforces the second and the first is worth
re-testing whenever the vocabulary changes.

Two things are written into the model and the rest is derived. A box declares
what it `gives`. A loop declares what it counts over, as `count(themes)`. From
those:

- a loop that collects gives `collection[` whatever its body left behind `]`;
- inside a loop counting over a collection, that collection's name means **one
  element** of it — which is what `map` is, and is why `Draft` reads `accounts`
  and is handed one `account`;
- a name written both inside a repeating scope and outside it is the value that
  loop carries round, so its type is the loop's own signature. `Refine` is
  `collection[theme] → collection[theme]` because `themes` is written by `Pool`
  outside it and by the naming `Generate` inside it.

Nesting is left visible rather than hidden behind aliases. `all_readings` is
`collection[collection[collection[theme]]]` — accounts, then readings, then the
themes named in one reading — and `Pool` collapsing it to `collection[theme]`
is then self-evident rather than something you have to look up.

Deliberately **not** tracked: keys. A collection made by mapping over accounts
stays in step with them, and `Join` matches on the key named in `on`. Making
that visible would put `pair[account, …]` on every type in the lower half and
buy nothing the annotations do not already say. The one consequence a reader
must not miss — that the join can drop accounts — is said out loud in an
annotation instead, because the types no longer can.

## The vocabulary

| primitive | shape | notes |
| --- | --- | --- |
| Read | `— → collection[a]` | a source |
| Select | `collection[a] → collection[a]` | `filter` |
| Generate | `a → b` | calls a model; the prompt is the function |
| Embed | `a → pair[a, vector]` | calls a model; keeps its subject |
| Compare | `collection[pair[a, vector]] → matrix[a]` | pairwise, by the vectors |
| Decide | `matrix[a] → number` | a person |
| Group | `matrix[a], number → collection[collection[a]]` | partition |
| Combine | `collection[a] → b` | `fold`; `how` says which |
| Join | `collection[a], collection[b] → collection[pair[a, b]]` | keyed; can drop rows |
| Test | `collection[a] → collection[finding]` | inference, with correction |

`Embed` keeps its subject instead of returning a bare vector, and `Compare`
takes embedded things instead of vectors. That pairing is what lets `Group`
partition *themes* rather than partition coordinates and lose the labels —
which is what the original is doing when it zips cluster ids back onto codes.

## What writing the types down changed

Two boxes did not survive it.

- **`Matrix` ("stack the rows") was the identity.** Once `RowUp` gives a `row`,
  `rows` is already `collection[row]` and the table is already built. Dropped;
  the rows feed `Join` directly.
- **`Refine` was not an endofunction.** It repeated `collection[pair[theme,
  vector]] → collection[collection[theme]]` twice over unchanged input, so the
  second round recomputed an identical partition. `Embed` and the naming
  `Generate` moved inside it, and the loop is now `collection[theme] →
  collection[theme]`: fewer, sharper themes each round. This is also what
  `nb_code_consolidation.py` does — it re-embeds every merged name inside the
  loop — so the model got closer to the original by being made to type-check.

A standard loop that carries nothing round is now itself a type error, which is
what would have caught the second one.

## How it relates to the original study

Same in essence: several readings of each account, pooled and consolidated into
a shared vocabulary, then applied one judgement at a time, joined with site
context, tested and filtered.

Deliberately simplified, and why:

- **Consolidation.** The original ranks pairs by similarity and asks the model,
  pair by pair, whether two themes are the same concept, merging and re-embedding
  until a round merges nothing. Ours keeps the loop and the re-embedding but
  replaces the pairwise interrogation with the simpler mechanism from the
  codebook script: embed, compare, a person sets a threshold, group, name. This
  is the largest departure.
- **Two cohorts (452 / 710).** Removed. The study grew that way; the method
  does not need it. We assume independent samples instead — one account per
  participant, said out loud in an annotation.
- **Four predictor tables.** Removed. One kind of context, land cover at the
  site. The others are the same flow with different metadata.
- **Translation.** Removed. In the original it is a stored table of agreed
  names applied as a lookup, not a model call; a single language is assumption
  enough here.
- Also absent: artefact stripping, singleton-code filtering, the prevalence
  filter, the mixed-effects alternative, and everything downstream of the
  results table.

## Known gaps

- **`Derive` is missing** — computing a value per row (a prevalence, a bin, a
  recode). We have `map` at the process level but no arithmetic leaf to put
  inside it, so ordinary numeric work is inexpressible. This is the one
  primitive that would make the vocabulary general rather than domain-shaped.
  Do not add it until a modelled pipeline actually needs it.
- **No convergence condition.** `Refine` is a genuine `collection[theme] →
  collection[theme]` but repeats a fixed twice; the original stops when a round
  merges nothing. That wants a gateway looping back on a condition.
- **No give-up path.** The retry backs off and tries again forever in
  principle. A real model counts and routes to failure.
- **The retry is operational, not methodological.** It is honest — it mirrors
  the retry loop in the original — but if the diagram should be purely about
  method, it is the first thing to cut.
- **Type names live half in the model.** Which types exist is declared by use in
  the BPMN, so a modeller can introduce one without touching code; the one-line
  description of each lives in `TYPES` in `app/primitives.js`. A real tool would
  keep both in the model.
- `Decide` is `matrix[a] → number`, which describes this pipeline's human step
  rather than the primitive. Widen it if a second human step appears.

## Checking a change

- Structure: `python3 tools/check.py`. One start and one end per scope, every
  flow endpoint resolves, declared `incoming`/`outgoing` match the flows, an
  edge or shape for everything and nothing spare, no orphans, no shape
  overlapping or escaping its parent, every operator naming and typing what it
  gives. Run it after editing the BPMN by hand or in a modeller.
- Parser: import the file with bpmn-js and read `warnings` — it should be
  empty. It has caught a `loopMaximum` written as an element rather than an
  attribute, and loop outputs referencing names that were never declared as
  data.
- Types: `analyse()` in `app/types.js` runs in the page on load; failures print
  in the caption and disable Run.
- Hover: every box should read as `label`, concrete signature, generic shape,
  the loop's effect, then the setting. Every arrow should name the value on it
  and its type. An arrow out of a gateway names nothing, correctly.
- Playback: a full run is around thirteen seconds. The retry is stochastic
  (15% per draft), so element counts differ slightly between runs.
