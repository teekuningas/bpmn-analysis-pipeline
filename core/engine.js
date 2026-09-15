// The toy interpreter, and the port a real one would implement.
//
// It knows nothing about the browser, the vocabulary, or what a task computes.
// All of that arrives in `services`:
//
//   call(name, params, element)   do the work of one task
//   wait(ms)                      a timer catch
//   onEvent(event)                enter / exit / progress / fail
//   cancelled()                   true to stop at the next step
//
// Two rules here carry meaning rather than mechanism, and core/types.js says
// the same two about the same markers:
//
//   A multi-instance loop over a collection binds one element of it to that
//   collection's own name. That is what makes the marker mean `map`.
//
//   A sequential one also lets the body see what earlier instances collected,
//   under the name it collects into. That is what makes a map usable as a fold.

const OVER = /^count\(([A-Za-z_]\w*)\)$/;

export class Cancelled extends Error {
  constructor() {
    super('stopped');
    this.name = 'Cancelled';
  }
}

const HELPERS = {
  count: (value) => (Array.isArray(value) ? value.length : value?.count ?? 1),
};

export function evaluate(expression, data) {
  const scope = { ...data, ...HELPERS };
  const keys = Object.keys(scope).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k));
  try {
    return new Function(...keys, `"use strict"; return (${expression});`)(...keys.map((k) => scope[k]));
  } catch (cause) {
    throw new Error(`cannot evaluate "${expression}": ${cause.message}`);
  }
}

export class Engine {
  constructor(processes, services) {
    this.processes = processes;
    this.services = services;
  }

  async run(processId, data = {}) {
    const scope = this.processes.get(processId);
    if (!scope) throw new Error(`no process named "${processId}"`);
    await this.runScope(scope, data);
    return data;
  }

  checkpoint() {
    if (this.services.cancelled?.()) throw new Cancelled();
  }

  async runScope(scope, data) {
    const arrivals = new Map();
    const attempts = new Map();
    const queue = [...scope.startIds];

    while (queue.length) {
      this.checkpoint();
      const el = scope.elements.get(queue.shift());

      if (el.type === 'parallelGateway' && el.incoming.length > 1) {
        const seen = (arrivals.get(el.id) || 0) + 1;
        arrivals.set(el.id, seen);
        if (seen < el.incoming.length) continue;
      }

      try {
        await this.execute(el, data);
      } catch (err) {
        if (err instanceof Cancelled) throw err;
        const handler = scope.boundaries.get(el.id);
        const tried = (attempts.get(el.id) || 0) + 1;
        attempts.set(el.id, tried);
        // Give up rather than back off forever. Routing the give-up somewhere
        // would want a gateway; this is the floor under a broken provider.
        if (!handler || tried > handler.retries) throw err;
        await this.services.onEvent({ type: 'fail', element: el, error: err, attempt: tried });
        await this.execute(handler, data);
        queue.push(...handler.outgoing.map((f) => f.target));
        continue;
      }

      queue.push(...this.successors(el, data).map((f) => f.target));
    }
  }

  successors(el, data) {
    if (el.type !== 'exclusiveGateway' || el.outgoing.length < 2) return el.outgoing;
    const taken = el.outgoing.find((f) => f.condition && evaluate(f.condition, data));
    return [taken || el.outgoing.find((f) => !f.condition)].filter(Boolean);
  }

  async execute(el, data) {
    await this.services.onEvent({ type: 'enter', element: el });
    if (el.loop) await this.runLoop(el, data);
    else await this.executeBody(el, data);
    await this.services.onEvent({ type: 'exit', element: el, data });
  }

  async runLoop(el, data) {
    const { cardinality, outputRef, outputItem, sequential, standard } = el.loop;
    const over = cardinality.match(OVER);
    const source = over ? data[over[1]] : null;
    const total = Number(evaluate(cardinality, data));
    const collected = [];
    if (outputRef) data[outputRef] = collected;

    for (let index = 0; index < total; index += 1) {
      this.checkpoint();
      const scoped = standard ? data : { ...data, index };
      if (over && Array.isArray(source)) scoped[over[1]] = source[index];
      if (outputRef && sequential) scoped[outputRef] = collected;

      const result = await this.executeBody(el, scoped);
      if (outputRef) collected.push(outputItem ? scoped[outputItem] : result);
      await this.services.onEvent({ type: 'progress', element: el, index: index + 1, total });
    }
  }

  async executeBody(el, data) {
    if (el.timer) return this.services.wait(el.timer);
    if (el.scope) return this.runScope(el.scope, data);
    if (!el.op) return undefined;

    const params = Object.fromEntries(
      Object.entries(el.op.params).map(([k, expr]) => [k, evaluate(expr, data)]),
    );
    const result = await this.services.call(el.op.name, params, el);
    if (el.op.resultVariable) data[el.op.resultVariable] = result;
    return result;
  }
}
