export const escape = (text) => String(text).replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const short = (text, n = 220) => (String(text).length > n
  ? `${String(text).slice(0, n).trimEnd()}…` : String(text));
