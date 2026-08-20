// Checks that whatever a task is wired to is something it can accept.
// Runs before the process does; a model that does not check does not run.

import { getPrimitive } from './primitives.js';

const COLLECTIONS = new Set(['collection', 'table', 'groups', 'findings']);

function accepts(expected, actual, mapped) {
  if (expected === 'any' || expected === actual) return true;
  if (mapped && COLLECTIONS.has(actual)) return true; // inside a loop, one item at a time
  if (expected === 'collection') return COLLECTIONS.has(actual);
  if (expected === 'table') return actual === 'collection';
  return false;
}

function elements(scope, mapped = false, found = []) {
  for (const el of scope.elements.values()) {
    const inLoop = mapped || Boolean(el.loop);
    found.push({ el, mapped: inLoop });
    if (el.scope) elements(el.scope, inLoop, found);
  }
  return found;
}

const names = (expression) => expression.match(/[A-Za-z_$][\w$]*/g) || [];

export function check(processes) {
  const all = [...processes.values()].flatMap((scope) => elements(scope));

  const produced = new Map();
  for (const { el } of all) {
    if (el.op?.resultVariable) produced.set(el.op.resultVariable, getPrimitive(el.op.name).out);
    if (el.loop?.outputRef) produced.set(el.loop.outputRef, 'collection');
  }

  const problems = [];
  for (const { el, mapped } of all) {
    if (!el.op) continue;
    for (const [param, expected] of Object.entries(getPrimitive(el.op.name).in)) {
      const expression = el.op.params[param];
      if (expression === undefined) continue;
      for (const name of names(expression)) {
        if (name === 'count' || name === 'length') continue;
        const actual = produced.get(name);
        if (!actual) problems.push(`${el.id}: ${param} reads "${name}", which nothing produces`);
        else if (!accepts(expected, actual, mapped)) {
          problems.push(`${el.id}: ${param} wants ${expected}, but "${name}" is ${actual}`);
        }
      }
    }
  }
  return problems;
}
