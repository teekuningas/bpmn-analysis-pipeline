// Just enough XML DOM for tools/smoke.mjs to run the real engine outside a
// browser. Not shipped to the page, not general: it covers the handful of
// methods core/bpmn.js uses, and nothing else.

const NAME = '[A-Za-z_][\\w.-]*(?::[A-Za-z_][\\w.-]*)?';
const TOKEN = new RegExp(
  `<!--[\\s\\S]*?-->|<\\?[\\s\\S]*?\\?>|<(${NAME})((?:\\s+[^<>]*?)?)(/?)>|</(${NAME})\\s*>|([^<]+)`, 'g');
const ATTR = new RegExp(`(${NAME})\\s*=\\s*"([^"]*)"|(${NAME})\\s*=\\s*'([^']*)'`, 'g');

const unescape = (text) => text
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&amp;/g, '&');

class Node {
  constructor(name, attrs = {}) {
    const [prefix, local] = name.includes(':') ? name.split(':') : [null, name];
    this.nodeType = 1;
    this.nodeName = name;
    this.prefix = prefix;
    this.localName = local;
    this.attrs = attrs;
    this.childNodes = [];
    this.parentNode = null;
  }

  get namespaceURI() {
    for (let at = this; at; at = at.parentNode) {
      const declared = at.attrs[this.prefix ? `xmlns:${this.prefix}` : 'xmlns'];
      if (declared) return declared;
    }
    return null;
  }

  get textContent() {
    return this.childNodes
      .map((child) => (child.nodeType === 3 ? child.data : child.textContent)).join('');
  }

  getAttribute(name) {
    if (name in this.attrs) return this.attrs[name];
    const suffix = `:${name}`;
    const found = Object.keys(this.attrs).find((k) => k.endsWith(suffix));
    return found ? this.attrs[found] : '';
  }

  descendants(out = []) {
    for (const child of this.childNodes) {
      if (child.nodeType !== 1) continue;
      out.push(child);
      child.descendants(out);
    }
    return out;
  }

  getElementsByTagName(name) {
    return this.descendants().filter((n) => name === '*' || n.nodeName === name || n.localName === name);
  }

  getElementsByTagNameNS(ns, name) {
    const all = [this, ...this.descendants()].filter((n) => n.nodeType === 1);
    return all.filter((n) => n.namespaceURI === ns && (name === '*' || n.localName === name));
  }
}

class Text {
  constructor(data) { this.nodeType = 3; this.data = data; }
}

export class DOMParser {
  parseFromString(xml) {
    const root = new Node('#document');
    root.nodeType = 9;
    root.getElementsByTagNameNS = (ns, name) => root.childNodes
      .filter((n) => n.nodeType === 1)
      .flatMap((n) => n.getElementsByTagNameNS(ns, name));
    root.getElementsByTagName = (name) => root.childNodes
      .filter((n) => n.nodeType === 1).flatMap((n) => n.getElementsByTagName(name));
    root.querySelector = () => null;

    let at = root;
    for (const match of xml.matchAll(TOKEN)) {
      const [whole, open, attrText, selfClosing, close, text] = match;
      if (open) {
        const attrs = {};
        for (const a of (attrText || '').matchAll(ATTR)) {
          attrs[a[1] ?? a[3]] = unescape(a[2] ?? a[4]);
        }
        const node = new Node(open, attrs);
        node.parentNode = at;
        at.childNodes.push(node);
        if (!selfClosing) at = node;
      } else if (close) {
        at = at.parentNode || root;
      } else if (text && text.trim()) {
        at.childNodes.push(new Text(unescape(text)));
      } else if (text) {
        at.childNodes.push(new Text(text));
      } else if (!whole.startsWith('<!--') && !whole.startsWith('<?')) {
        throw new Error(`cannot read: ${whole.slice(0, 40)}`);
      }
    }
    return root;
  }
}
