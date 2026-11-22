const allowed: Record<string, readonly string[]> = {
  a: ['href'],
  abbr: [],
  b: [],
  blockquote: [],
  br: [],
  code: [],
  dd: [],
  del: [],
  details: ['open'],
  div: [],
  dl: [],
  dt: [],
  em: [],
  h1: [],
  h2: [],
  h3: [],
  h4: [],
  h5: [],
  h6: [],
  hr: [],
  i: [],
  input: ['type', 'checked'],
  ins: [],
  kbd: [],
  li: [],
  mark: [],
  ol: ['start'],
  p: [],
  pre: [],
  q: [],
  s: [],
  samp: [],
  small: [],
  span: [],
  strong: [],
  sub: [],
  summary: [],
  sup: [],
  table: [],
  tbody: [],
  td: ['align', 'colspan', 'rowspan'],
  tfoot: [],
  th: ['align', 'colspan', 'rowspan'],
  thead: [],
  tr: [],
  ul: [],
  var: [],
};
const dropped = new Set([
  'script',
  'style',
  'link',
  'meta',
  'base',
  'title',
  'head',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'template',
  'noscript',
  'svg',
  'math',
  'form',
  'textarea',
  'select',
  'option',
  'button',
  'canvas',
  'audio',
  'track',
  'portal',
]);
const media = new Set(['img', 'video', 'source']);
const safeUrl = (url: string | null): url is string => !!url && /^(https?:|mailto:)/i.test(url.trim());

export function filterForgeHtml(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  filterChildren(template.content);
  return template.innerHTML;
}

function filterChildren(parent: ParentNode) {
  for (const node of [...parent.childNodes]) {
    if (node.nodeType === Node.TEXT_NODE) continue;
    if (!(node instanceof Element)) {
      node.remove();
      continue;
    }
    const element = node;
    const name = element.localName;
    if (dropped.has(name)) {
      element.remove();
      continue;
    }
    if (media.has(name)) {
      element.replaceWith(mediaLink(element));
      continue;
    }
    filterChildren(element);
    if (!(name in allowed)) {
      element.replaceWith(...element.childNodes);
      continue;
    }
    for (const attribute of [...element.attributes]) {
      if (attribute.name !== 'title' && !allowed[name].includes(attribute.name))
        element.removeAttribute(attribute.name);
    }
    if (name === 'a') {
      if (safeUrl(element.getAttribute('href'))) {
        element.setAttribute('target', '_blank');
        element.setAttribute('rel', 'noreferrer');
      } else element.removeAttribute('href');
    }
    if (name === 'input') {
      if (element.getAttribute('type') !== 'checkbox') {
        element.remove();
        continue;
      }
      element.setAttribute('disabled', '');
    }
  }
}

function mediaLink(element: Element): Node {
  const source = element.getAttribute('src');
  const name = element.getAttribute('alt')?.trim() || source?.split('/').pop() || '';
  if (!safeUrl(source)) return document.createTextNode(element.getAttribute('alt') ?? '');
  if (element.parentElement?.closest('a')) return document.createTextNode(`${name} ↗`);
  const link = document.createElement('a');
  link.setAttribute('href', source);
  link.setAttribute('target', '_blank');
  link.setAttribute('rel', 'noreferrer');
  link.textContent = `${name} ↗`;
  return link;
}
