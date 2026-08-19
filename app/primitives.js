// The whole vocabulary. Everything else is arrangement.

// `model` marks the primitives that call a language model.
export const PRIMITIVES = {
  read: { label: 'Read', signature: '— → collection', ms: 350 },
  select: { label: 'Select', signature: 'collection → collection', ms: 200 },
  generate: { label: 'Generate', signature: 'prompt → response', ms: 420, model: true },
  embed: { label: 'Embed', signature: 'text → vector', ms: 100, model: true },
  compare: { label: 'Compare', signature: 'collection → matrix', ms: 350 },
  test: { label: 'Test', signature: 'table → findings', ms: 600 },
  group: { label: 'Group', signature: 'matrix, number → groups', ms: 300 },
  combine: { label: 'Combine', signature: 'collection[] → collection', ms: 250 },
  join: { label: 'Join', signature: 'tables, key → table', ms: 300 },
  decide: { label: 'Decide', signature: 'matrix → number', ms: 1100 },
};

export function getPrimitive(name) {
  const primitive = PRIMITIVES[name];
  if (!primitive) throw new Error(`no primitive named "${name}"`);
  return primitive;
}
