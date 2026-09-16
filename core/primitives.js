// The whole vocabulary. Everything else is arrangement.

export const PRIMITIVES = {
  read: {
    label: 'Read', in: {}, out: 'collection[a]',
    note: 'a source',
  },
  select: {
    label: 'Select', in: { of: 'collection[a]' }, out: 'collection[a]',
    note: 'keeps the ones that match — filter',
  },
  generate: {
    label: 'Generate', in: { of: 'a' }, out: 'b', model: true,
    note: 'the prompt is the function',
  },
  embed: {
    label: 'Embed', in: { of: 'a' }, out: 'vector', model: true,
    note: 'a place in meaning-space — guidance, never the judgement',
  },
  combine: {
    label: 'Combine', in: { parts: 'collection[a]' }, optional: { with: 'b' }, out: 'c',
    note: 'fold — `how` says which one, `with` what the parts are folded about',
  },
  join: {
    label: 'Join', in: { left: 'collection[a]', right: 'collection[b]' }, out: 'collection[pair[a, b]]',
    note: 'matched on the key in `on`; can drop rows',
  },
  test: {
    label: 'Test', in: { of: 'collection[a]' }, out: 'collection[finding]',
    note: 'inference, corrected for many tests',
  },
};

// Type names the vocabulary owns, because a primitive makes them and nothing
// else can. Every other name belongs to the study that named it.
export const TYPES = {
  finding: 'one association, corrected for many tests — what Test gives',
  vector: 'where a thing sits in meaning-space — what Embed gives',
  collection: 'many of something, in order',
  pair: 'one of each, side by side',
};

// Parameters that are the modeller's choice, as opposed to wiring.
export const SETTINGS = ['source', 'prompt', 'where', 'how', 'on', 'by', 'test'];

export const getPrimitive = (name) => {
  const primitive = PRIMITIVES[name];
  if (!primitive) throw new Error(`no primitive named "${name}"`);
  return primitive;
};

export const generic = (primitive) => {
  const takes = Object.values(primitive.in)
    .concat(Object.values(primitive.optional || {}).map((type) => `[${type}]`));
  return `${takes.length ? takes.join(', ') : '—'} → ${primitive.out}`;
};
