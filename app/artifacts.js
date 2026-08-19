// Values live here; the workflow passes references to them.

function digest(value) {
  const s = JSON.stringify(value);
  let h1 = 2166136261;
  let h2 = 2166136261 ^ 0x9e3779b9;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619);
    h2 = Math.imul(h2 ^ s.charCodeAt(s.length - 1 - i), 16777619);
  }
  const hex = (h) => (h >>> 0).toString(16).padStart(8, '0');
  return hex(h1) + hex(h2);
}

export class ArtifactStore {
  constructor() {
    this.items = new Map();
  }

  put(kind, value, summary = {}) {
    const id = digest([kind, value]);
    if (!this.items.has(id)) this.items.set(id, { id, kind, value });
    return { artifact: id, kind, ...summary };
  }

  get(ref) {
    const id = typeof ref === 'string' ? ref : ref && ref.artifact;
    const item = this.items.get(id);
    if (!item) throw new Error(`unknown artifact: ${JSON.stringify(ref)}`);
    return item.value;
  }
}
