// The task registry.
//
// Every step the diagram can invoke is registered here under a dotted name
// ("corpus.read", "llm.embed", ...). The .bpmn file refers to these names and
// nothing else -- no file paths, no model names, no run ids.
//
// The diagram is the wiring. This registry is the vocabulary.

const OPS = new Map();

/**
 * @param {string} name    dotted op name, referenced from the BPMN file
 * @param {object} spec    { summary, params, callsLlm, run }
 *   run(params, ctx) -> value  (ctx = { store, log, getOp })
 */
export function defineOp(name, spec) {
  if (OPS.has(name)) throw new Error(`op already defined: ${name}`);
  OPS.set(name, { name, callsLlm: false, params: {}, ...spec });
}

export function getOp(name) {
  const op = OPS.get(name);
  if (!op) throw new Error(`no op named "${name}". Known ops: ${[...OPS.keys()].join(', ')}`);
  return op;
}

export function catalog() {
  return [...OPS.values()]
    .map(({ name, summary, params, callsLlm }) => ({ name, summary, params, callsLlm }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
