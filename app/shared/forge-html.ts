/** Filters HTML a forge rendered (an issue body, a comment) through an allowlist before it joins a page.
 * The Workbench never parses Markdown itself: it shows the forge's own rendering, minus anything that could run,
 * load, style or submit. Parsing happens in an inert <template>, so nothing in the input loads or runs on the way. */

/** Elements kept as they are, with only the attributes listed for them (and `title`). */
const allowed: Record<string, readonly string[]> = {
  a: ['href'], abbr: [], b: [], blockquote: [], br: [], code: [], dd: [], del: [], details: ['open'], div: [], dl: [], dt: [], em: [],
  h1: [], h2: [], h3: [], h4: [], h5: [], h6: [], hr: [], i: [], input: ['type', 'checked'], ins: [], kbd: [], li: [], mark: [],
  ol: ['start'], p: [], pre: [], q: [], s: [], samp: [], small: [], span: [], strong: [], sub: [], summary: [], sup: [],
  table: [], tbody: [], td: ['align', 'colspan', 'rowspan'], tfoot: [], th: ['align', 'colspan', 'rowspan'], thead: [], tr: [], ul: [], var: [],
};
/** Elements dropped with everything inside them. Any other element not allowed is unwrapped: its content stays. */
const dropped = new Set(['script', 'style', 'link', 'meta', 'base', 'title', 'head', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet',
  'template', 'noscript', 'svg', 'math', 'form', 'textarea', 'select', 'option', 'button', 'canvas', 'audio', 'track', 'portal']);
/** Media the page cannot load (its content security policy allows only its own images); each becomes a link to the file. */
const media = new Set(['img', 'video', 'source']);
const safeUrl = (url: string | null) => !!url && /^(https?:|mailto:)/i.test(url.trim());

/** The forge's HTML with every element and attribute outside the allowlist removed. Links keep only http(s) and mailto
 * targets and open outside the page; checkboxes are read-only; images and videos become links to their files. */
export function filterForgeHtml(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  filterChildren(template.content);
  return template.innerHTML;
}

function filterChildren(parent: ParentNode) {
  for (const node of [...parent.childNodes]) {
    if (node.nodeType === Node.TEXT_NODE) continue;
    if (node.nodeType !== Node.ELEMENT_NODE) { node.remove(); continue; }
    const element = node as Element;
    const name = element.localName;
    if (dropped.has(name)) { element.remove(); continue; }
    if (media.has(name)) { element.replaceWith(mediaLink(element)); continue; }
    filterChildren(element);
    if (!(name in allowed)) { element.replaceWith(...element.childNodes); continue; }
    for (const attribute of [...element.attributes]) {
      if (attribute.name !== 'title' && !allowed[name].includes(attribute.name)) element.removeAttribute(attribute.name);
    }
    if (name === 'a') {
      if (safeUrl(element.getAttribute('href'))) { element.setAttribute('target', '_blank'); element.setAttribute('rel', 'noreferrer'); }
      else element.removeAttribute('href');
    }
    if (name === 'input') {
      if (element.getAttribute('type') !== 'checkbox') { element.remove(); continue; }
      element.setAttribute('disabled', '');
    }
  }
}

/** A link to an image or video's file, named by its alt text; nothing when the file is not on the web. */
function mediaLink(element: Element): Node {
  const source = element.getAttribute('src');
  const name = element.getAttribute('alt')?.trim() || source?.split('/').pop() || '';
  if (!safeUrl(source)) return document.createTextNode(element.getAttribute('alt') ?? '');
  const link = document.createElement('a');
  link.setAttribute('href', source!);
  link.setAttribute('target', '_blank');
  link.setAttribute('rel', 'noreferrer');
  link.textContent = `${name} ↗`;
  return link;
}
