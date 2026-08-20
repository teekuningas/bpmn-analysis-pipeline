// The type language, and the check that the wiring makes sense.
//
// A type is a name, optionally applied to other types: `theme`,
// `collection[theme]`, `pair[row, site]`. Single-letter names are variables and
// appear only in the primitives' generic signatures.
//
// Two things are written into the model and the rest is derived. A box declares
// what it gives. A loop declares what it counts over. From those:
//
//   - a loop that collects gives a collection of whatever its body left behind;
//   - inside a loop counting over a collection, that collection's name means
//     one element of it — which is what `map` is;
//   - a name written both inside a repeating scope and outside it is what that
//     loop carries round, so its type is the loop's own signature.
//
// Runs before the process does; a model that does not check does not run.

import { getPrimitive, generic } from './primitives.js';

const OVER = /^count\(([A-Za-z_]\w*)\)$/;
const unquote = (value) => String(value).replace(/^'|'$/g, '');

// ---------------------------------------------------------------- expressions

function parse(source) {
  const tokens = source.match(/[A-Za-z_]\w*|[[\],]/g) || [];
  let at = 0;

  const type = () => {
    const name = tokens[at++];
    if (!name || !/^[A-Za-z_]/.test(name)) throw new Error(`"${source}" is not a type`);
    const node = { name, args: [] };
    if (tokens[at] === '[') {
      at += 1;
      node.args.push(type());
      while (tokens[at] === ',') { at += 1; node.args.push(type()); }
      if (tokens[at++] !== ']') throw new Error(`"${source}" is missing a "]"`);
    }
    return node;
  };

  const node = type();
  if (at !== tokens.length) throw new Error(`"${source}" has more after the type`);
  return node;
}

const show = (type) => (type.args.length
  ? `${type.name}[${type.args.map(show).join(', ')}]`
  : type.name);

const isVariable = (type) => type.name.length === 1 && !type.args.length;
const collectionOf = (type) => ({ name: 'collection', args: [type] });

/** Fills the variables in a generic signature from a concrete type. */
function match(pattern, actual, bindings) {
  if (isVariable(pattern)) {
    const bound = bindings.get(pattern.name);
    if (bound) return show(bound) === show(actual);
    bindings.set(pattern.name, actual);
    return true;
  }
  if (pattern.name !== actual.name || pattern.args.length !== actual.args.length) return false;
  return pattern.args.every((arg, i) => match(arg, actual.args[i], bindings));
}

const names = (type, found = new Set()) => {
  found.add(type.name);
  type.args.forEach((arg) => names(arg, found));
  return found;
};

// -------------------------------------------------------------------- walking

function walk(scope, path = [], found = []) {
  for (const el of scope.elements.values()) {
    const here = [...path, el];
    found.push({ el, path: here });
    if (el.scope) walk(el.scope, here, found);
  }
  return found;
}

const under = (el) => (el.scope ? walk(el.scope).map((each) => each.el.id) : []);

// ------------------------------------------------------------------- the pass

export function analyse(processes) {
  const all = [...processes.values()].flatMap((scope) => walk(scope));
  const problems = [];
  const types = new Map();
  const writers = new Map();

  const declare = (name, type, where) => {
    const already = types.get(name);
    if (already && show(already) !== show(type)) {
      problems.push(`${where}: "${name}" is ${show(type)} here, ${show(already)} elsewhere`);
      return;
    }
    types.set(name, type);
    writers.set(name, [...(writers.get(name) || []), where]);
  };

  // What each box says it gives.
  for (const { el } of all) {
    if (!el.op) continue;
    const declared = el.op.params.gives;
    if (declared === undefined) {
      problems.push(`${el.id}: does not say what it gives`);
      continue;
    }
    let type;
    try {
      type = parse(unquote(declared));
    } catch (failure) {
      problems.push(`${el.id}: ${failure.message}`);
      continue;
    }
    if ([...names(type)].some((name) => name.length === 1)) {
      problems.push(`${el.id}: gives ${show(type)}, which is still a shape, not a type`);
    }
    if (!el.op.resultVariable) problems.push(`${el.id}: gives ${show(type)} but does not name it`);
    else declare(el.op.resultVariable, type, el.id);
  }

  // What each collecting loop gives: a collection of whatever its body left.
  const settled = new Set();
  for (let pass = 0; pass <= all.length; pass += 1) {
    let moved = false;
    for (const { el } of all) {
      const { outputRef, outputItem } = el.loop || {};
      if (!outputRef || !outputItem || settled.has(el.id)) continue;
      const item = types.get(outputItem);
      if (!item) continue;
      settled.add(el.id);
      declare(outputRef, collectionOf(item), el.id);
      moved = true;
    }
    if (!moved) break;
  }
  for (const { el } of all) {
    if (el.loop?.outputRef && !types.has(el.loop.outputRef)) {
      problems.push(`${el.id}: nothing gives "${el.loop.outputItem}", so "${el.loop.outputRef}" has no type`);
    }
  }

  // Inside a loop counting over a collection, that name means one element.
  const oneAtATime = (path) => {
    const bound = new Map();
    for (const el of path) {
      const over = el.loop?.cardinality?.match(OVER);
      const type = over && types.get(over[1]);
      if (type?.name === 'collection') bound.set(over[1], type.args[0]);
    }
    return bound;
  };

  const read = (expression, bound) => {
    const list = expression.trim().match(/^\[(.*)\]$/);
    if (list) {
      const parts = list[1].split(',').map((part) => part.trim());
      if (parts.length !== 2) return { error: `"${expression}" is not one value or a pair` };
      const each = parts.map((part) => read(part, bound));
      return each.find((one) => one.error)
        || { type: { name: 'pair', args: each.map((one) => one.type) } };
    }
    const name = expression.trim();
    if (!/^[A-Za-z_]\w*$/.test(name)) return { error: `"${expression}" is not a value` };
    const type = bound.get(name) || types.get(name);
    return type ? { type } : { error: `nothing gives "${name}"` };
  };

  // Every box, against the primitive it claims to be.
  const info = new Map();
  for (const { el, path } of all) {
    if (!el.op) continue;
    const primitive = getPrimitive(el.op.name);
    const bound = oneAtATime(path);
    const bindings = new Map();
    const gives = types.get(el.op.resultVariable);
    if (!gives) continue;

    if (!match(parse(primitive.out), gives, bindings)) {
      problems.push(`${el.id}: ${primitive.label} gives ${primitive.out}, this one says ${show(gives)}`);
    }

    const takes = [];
    for (const [param, pattern] of Object.entries(primitive.in)) {
      const expression = el.op.params[param];
      if (expression === undefined) {
        problems.push(`${el.id}: ${primitive.label} needs "${param}" wired`);
        continue;
      }
      const actual = read(expression, bound);
      if (actual.error) {
        problems.push(`${el.id}: ${param} ${actual.error}`);
        continue;
      }
      takes.push(actual.type);
      if (!match(parse(pattern), actual.type, bindings)) {
        problems.push(`${el.id}: ${param} wants ${pattern}, but "${expression}" is ${show(actual.type)}`);
      }
    }

    info.set(el.id, {
      label: primitive.label,
      generic: generic(primitive),
      signature: `${takes.length ? takes.map(show).join(', ') : '—'} → ${show(gives)}`,
      gives: { name: el.op.resultVariable, type: show(gives) },
      mentions: takes.concat(gives).flatMap((type) => [...names(type)]),
    });
  }

  // What the marker on a box does to its type.
  for (const { el } of all) {
    if (!el.loop) continue;
    const { cardinality, outputRef } = el.loop;
    const over = cardinality.match(OVER);
    const collected = outputRef && types.get(outputRef);
    let loop = null;
    let carried = null;

    if (over) {
      const from = show(types.get(over[1]));
      loop = collected ? `map over ${from} → ${show(collected)}` : `map over ${from}`;
    } else if (collected) {
      loop = `repeat ${cardinality} × → ${show(collected)}`;
    } else {
      const inside = new Set(under(el));
      const round = [...writers].filter(([, where]) => where.some((id) => inside.has(id))
        && where.some((id) => !inside.has(id)));
      if (round.length === 1) {
        const [name] = round[0];
        const type = show(types.get(name));
        loop = `iterate ${cardinality} × · ${type} → ${type}`;
        carried = { name, type };
      } else {
        problems.push(`${el.id}: repeats ${cardinality} × but carries nothing round`);
        loop = `iterate ${cardinality} ×`;
      }
    }

    const existing = info.get(el.id) || { label: el.name, mentions: [] };
    const named = over
      ? [types.get(over[1]), collected]
      : [collected, carried && types.get(carried.name)];
    info.set(el.id, {
      ...existing,
      loop,
      gives: (collected && { name: outputRef, type: show(collected) }) || carried || existing.gives,
      mentions: existing.mentions.concat(named.filter(Boolean).flatMap((type) => [...names(type)])),
    });
  }

  const mentions = new Map();
  for (const [id, one] of info) {
    for (const name of one.mentions || []) {
      mentions.set(name, (mentions.get(name) || new Set()).add(id));
    }
  }

  return { problems, info, mentions };
}
