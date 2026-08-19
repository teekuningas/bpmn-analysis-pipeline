// The whole vocabulary. Everything else is arrangement.

export const PRIMITIVES = {
  read: { label: 'Read', signature: '— → collection', ms: 350 },
  select: { label: 'Select', signature: 'collection → collection', ms: 200 },
  generate: { label: 'Generate', signature: 'text → text', ms: 420 },
  embed: { label: 'Embed', signature: 'text → vector', ms: 100 },
  compare: { label: 'Compare', signature: 'collection → matrix', ms: 350 },
  group: { label: 'Group', signature: 'matrix, number → groups', ms: 300 },
  combine: { label: 'Combine', signature: 'collection[] → collection', ms: 250 },
  decide: { label: 'Decide', signature: 'matrix → number', ms: 1100 },
};

export function getPrimitive(name) {
  const primitive = PRIMITIVES[name];
  if (!primitive) throw new Error(`no primitive named "${name}"`);
  return primitive;
}
