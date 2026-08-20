// The whole vocabulary. Everything else is arrangement.
// `in` is what must be wired to a primitive and `out` is what it hands on;
// the model is checked against those. `model` marks the two that call one.

export const PRIMITIVES = {
  read: {
    label: 'Read', signature: '— → collection', in: {}, out: 'collection', ms: 175,
  },
  select: {
    label: 'Select', signature: 'collection → collection', in: { of: 'collection' }, out: 'collection', ms: 110,
  },
  generate: {
    label: 'Generate', signature: 'text → text', in: { of: 'text', against: 'collection' }, out: 'text', ms: 160, model: true,
  },
  embed: {
    label: 'Embed', signature: 'text → vector', in: { of: 'text' }, out: 'vector', ms: 55, model: true,
  },
  compare: {
    label: 'Compare', signature: 'collection → matrix', in: { of: 'collection' }, out: 'matrix', ms: 190,
  },
  test: {
    label: 'Test', signature: 'table → findings', in: { of: 'table' }, out: 'findings', ms: 320,
  },
  group: {
    label: 'Group', signature: 'matrix, number → groups', in: { of: 'matrix', threshold: 'number' }, out: 'groups', ms: 160,
  },
  combine: {
    label: 'Combine', signature: 'collection[] → collection', in: { parts: 'collection' }, out: 'collection', ms: 130,
  },
  join: {
    label: 'Join', signature: 'collection[], key → table', in: { parts: 'collection' }, out: 'table', ms: 160,
  },
  decide: {
    label: 'Decide', signature: 'matrix → number', in: { of: 'matrix' }, out: 'number', ms: 600,
  },
};

export function getPrimitive(name) {
  const primitive = PRIMITIVES[name];
  if (!primitive) throw new Error(`no primitive named "${name}"`);
  return primitive;
}
