// A content-addressed artifact store.
//
// This is the part that replaces `INPUT_FILE = "output/koodit/487ef9e9/..."`
// pasted between scripts. Ops put values in and get back a small reference;
// the workflow data only ever carries references, never payloads. Two runs
// with the same inputs produce the same id, so you can see at a glance which
// steps actually changed.

function digest(value) {
  const s = JSON.stringify(value);
  // FNV-1a, twice with different offsets, to get 64 bits of id.
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
    this.items = new Map(); // id -> { id, kind, value }
  }

  /**
   * Store a value and return the reference that travels through the workflow.
   * Extra fields (n, items, ...) are small summaries the BPMN is allowed to
   * branch and loop on without ever touching the payload.
   */
  put(kind, value, summary = {}) {
    const id = digest([kind, value]);
    if (!this.items.has(id)) this.items.set(id, { id, kind, value });
    return { artifact: id, kind, ...summary };
  }

  /** Resolve a reference (or a bare id) back to its payload. */
  get(ref) {
    const id = typeof ref === 'string' ? ref : ref && ref.artifact;
    const item = this.items.get(id);
    if (!item) throw new Error(`unknown artifact: ${JSON.stringify(ref)}`);
    return item.value;
  }

  list() {
    return [...this.items.values()].map(({ id, kind, value }) => ({
      id,
      kind,
      size: JSON.stringify(value).length,
    }));
  }
}
