/**
 * The allowlist every piece of platform-rendered HTML passes before it enters the page. The
 * Workbench never parses Markdown itself: it shows the platform's own rendering, keeping only
 * structure and text. Unknown elements leave their content; elements that run, embed or style
 * content leave nothing. No class, style or event attribute survives, links and images keep
 * only web addresses, and every link opens outside the page.
 */
const allowed: Record<string, string[]> = Object.fromEntries([
  ...['p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'del', 's', 'ins', 'sub', 'sup', 'code', 'pre', 'kbd',
    'blockquote', 'ul', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'details', 'summary', 'span', 'div', 'mark', 'small']
    .map(tag => [tag, []] as const),
  ['ol', ['start']], ['th', ['align', 'colspan', 'rowspan']], ['td', ['align', 'colspan', 'rowspan']],
  ['a', ['href', 'title']], ['img', ['src', 'alt', 'title', 'width', 'height']], ['input', ['type', 'checked', 'disabled']],
]);
const removed = new Set(['script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'template', 'svg', 'math', 'form', 'button',
  'textarea', 'select', 'option', 'link', 'meta', 'base', 'noscript', 'audio', 'video', 'source', 'track', 'canvas', 'head', 'title']);

const webAddress = (value: string) => /^https?:$/.test(URL.parse(value)?.protocol ?? '');

function clean(node: Node) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === Node.TEXT_NODE) continue;
    if (child.nodeType !== Node.ELEMENT_NODE) { child.remove(); continue; }
    const element = child as Element;
    const tag = element.localName;
    if (removed.has(tag)) { element.remove(); continue; }
    const attributes = allowed[tag];
    if (!attributes) { clean(element); element.replaceWith(...element.childNodes); continue; }
    for (const { name } of [...element.attributes]) if (!attributes.includes(name)) element.removeAttribute(name);
    if (tag === 'a') {
      const href = element.getAttribute('href');
      if (href !== null && !webAddress(href)) element.removeAttribute('href');
      if (element.hasAttribute('href')) { element.setAttribute('target', '_blank'); element.setAttribute('rel', 'noreferrer'); }
    }
    if (tag === 'img' && !webAddress(element.getAttribute('src') ?? '')) { element.remove(); continue; }
    if (tag === 'input') {
      if (element.getAttribute('type') !== 'checkbox') { element.remove(); continue; }
      element.setAttribute('disabled', '');
    }
    clean(element);
  }
}

/** The platform's HTML with only what the allowlist keeps. */
export function allowedHtml(html: string): string {
  // An inert document: nothing in it runs or loads while it is filtered.
  const inert = document.implementation.createHTMLDocument('');
  inert.body.innerHTML = html;
  clean(inert.body);
  return inert.body.innerHTML;
}
