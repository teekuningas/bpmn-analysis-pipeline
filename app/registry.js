// Named tasks the BPMN file is allowed to call.

const OPS = new Map();

export function defineOp(name, spec) {
  if (OPS.has(name)) throw new Error(`op already defined: ${name}`);
  OPS.set(name, { name, callsLlm: false, params: {}, ...spec });
}

export function getOp(name) {
  const op = OPS.get(name);
  if (!op) throw new Error(`no op named "${name}"`);
  return op;
}

export function catalog() {
  return [...OPS.values()]
    .map(({ name, summary, params, callsLlm }) => ({ name, summary, params, callsLlm }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
