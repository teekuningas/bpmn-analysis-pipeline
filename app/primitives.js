// The whole vocabulary. Everything else is arrangement.
//
// Each primitive carries a generic signature: `in` is what must be wired to it,
// `out` is what it hands on. Single letters are type variables — a primitive
// says what shape it preserves, not what it is used for. Every box in the model
// fills them in by declaring what it gives, and app/types.js checks that the
// filling-in is consistent. `model` marks the two that call one.

export const PRIMITIVES = {
  read: {
    label: 'Read', in: {}, out: 'collection[a]', ms: 175,
    note: 'a source',
  },
  select: {
    label: 'Select', in: { of: 'collection[a]' }, out: 'collection[a]', ms: 110,
    note: 'keeps the ones that match — filter',
  },
  generate: {
    label: 'Generate', in: { of: 'a' }, out: 'b', ms: 160, model: true,
    note: 'the prompt is the function',
  },
  embed: {
    label: 'Embed', in: { of: 'a' }, out: 'pair[a, vector]', ms: 55, model: true,
    note: 'attaches a vector, keeping what it came from',
  },
  compare: {
    label: 'Compare', in: { of: 'collection[pair[a, vector]]' }, out: 'matrix[a]', ms: 190,
    note: 'every one against every one, by their vectors',
  },
  decide: {
    label: 'Decide', in: { of: 'matrix[a]' }, out: 'number', ms: 600,
    note: 'a person looks and picks a number',
  },
  group: {
    label: 'Group', in: { of: 'matrix[a]', threshold: 'number' }, out: 'collection[collection[a]]', ms: 160,
    note: 'partitions by the threshold',
  },
  combine: {
    label: 'Combine', in: { parts: 'collection[a]' }, out: 'b', ms: 130,
    note: 'fold — `how` says which one',
  },
  join: {
    label: 'Join', in: { left: 'collection[a]', right: 'collection[b]' }, out: 'collection[pair[a, b]]', ms: 160,
    note: 'matched on the key in `on`; can drop rows',
  },
  test: {
    label: 'Test', in: { of: 'collection[a]' }, out: 'collection[finding]', ms: 320,
    note: 'inference, corrected for many tests',
  },
};

/**
 * What the names in a type mean. Six of them are the modeller's, named in the
 * model and meaning nothing to the vocabulary. Three are the vocabulary's,
 * because a primitive manufactures them: `vector` from Embed, `number` from
 * Decide, `finding` from Test. Last, the three constructors.
 */
export const TYPES = {
  account: 'one interview account, as it was spoken',
  draft: 'one free-form reading of one account',
  theme: 'one short theme label',
  verdict: 'whether one theme appears in one account',
  row: 'one account, judged against every theme',
  site: 'the land cover where an account was recorded',

  vector: 'a point in semantic space — what Embed attaches',
  number: 'a plain number — what a person hands back',
  finding: 'one association, corrected for many tests — what Test gives',

  collection: 'many of something, in order',
  matrix: 'every one against every one, a number in each cell',
  pair: 'one of each, side by side',
};

export function getPrimitive(name) {
  const primitive = PRIMITIVES[name];
  if (!primitive) throw new Error(`no primitive named "${name}"`);
  return primitive;
}

/** `collection[a] → collection[a]` — the shape, before a box fills it in. */
export function generic(primitive) {
  const takes = Object.values(primitive.in);
  return `${takes.length ? takes.join(', ') : '—'} → ${primitive.out}`;
}
