// PROTOTYPE — throwaway, part of prototype-github-sidebar.tsx. Never import or adapt into production (AGENTS.md「Prototype scope」).
// GitHub-flavoured Markdown through react-markdown (no raw HTML). `#123` and links to this repo's issues / PRs open inside the
// detail pane instead of the browser.
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Repo, Selected } from './prototype-github-sidebar-model';

/** Turn bare `#123` references into internal links, leaving fenced code and inline code alone. */
function linkReferences(source: string) {
  let fenced = false;
  return source.split('\n').map(line => {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return line; }
    if (fenced) return line;
    return line.split(/(`[^`]*`)/).map(part => part.startsWith('`') ? part
      : part.replace(/(^|[\s(（，、：:])#(\d+)\b/g, (_m, lead, n) => `${lead}[#${n}](vb-ref:${n})`)).join('');
  }).join('\n');
}

export function Markdown({ repo, source, onOpen }: { repo: Repo; source: string; onOpen(s: Selected): void }) {
  if (!source.trim()) return <p className="gh-md-empty">没有描述。</p>;
  const own = new RegExp(`^https://github\\.com/${repo.snapshot.repo.replace('/', '\\/')}/(issues|pull)/(\\d+)(?:#.*)?$`);
  const open = (n: number) => onOpen(repo.pulls.has(n) ? { kind: 'pull', number: n } : { kind: 'issue', number: n });
  return <div className="gh-md">
    <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={url => url}
      components={{
        a: ({ href = '', children }) => {
          const ref = href.startsWith('vb-ref:') ? Number(href.slice(7)) : Number(own.exec(href)?.[2] ?? NaN);
          if (Number.isFinite(ref) && (repo.issues.has(ref) || repo.pulls.has(ref))) {
            const target = repo.issues.get(ref) ?? repo.pulls.get(ref)!;
            return <a href="#" className="gh-md-ref" title={target.title} onClick={e => { e.preventDefault(); open(ref); }}>{children}</a>;
          }
          if (href.startsWith('vb-ref:')) return <span>{children}</span>;
          return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
        },
        input: ({ checked }) => <input type="checkbox" checked={!!checked} readOnly disabled />,
      }}>{linkReferences(source)}</ReactMarkdown>
  </div>;
}
