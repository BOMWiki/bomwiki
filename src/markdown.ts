// Article rendering, ported from src/lib/content.ts: markdown via marked,
// sanitized via sanitize-html, with [[node-id]] and [[node-id|Label]]
// wiki-links resolved against the live graph before parsing. Links to
// missing nodes render red — an invitation to create the part, not an error.
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { getNode } from './nodes.ts';

marked.setOptions({ gfm: true, breaks: false });

const linkTransform: sanitizeHtml.IOptions['transformTags'] = {
  a: (_tagName, attribs) => {
    const href = attribs.href ?? '';
    const external = /^https?:\/\//i.test(href);
    return {
      tagName: 'a',
      attribs: {
        ...attribs,
        // External links in user content never pass link equity or referrer
        // trust: the anti-spam economics depend on it.
        ...(external ? { target: '_blank', rel: 'nofollow ugc noopener noreferrer' } : {}),
      },
    };
  },
};

const markdownOptions: sanitizeHtml.IOptions = {
  allowedTags: [
    ...sanitizeHtml.defaults.allowedTags,
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'img',
    'figure',
    'figcaption',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
  ],
  allowedAttributes: {
    a: ['href', 'name', 'target', 'rel', 'title', 'class'],
    abbr: ['title'],
    img: ['src', 'alt', 'width', 'height', 'loading'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  transformTags: linkTransform,
};

/** Resolve [[id]] / [[id|Label]] wiki-links to markdown links (or red links
 *  for nodes that don't exist yet), then render and sanitize. */
export function renderArticle(md: string): string {
  const resolved = md.replace(
    /\[\[([A-Za-z0-9._-]+)(?:\|([^\]]+))?\]\]/g,
    (_m, id: string, label?: string) => {
      const node = getNode(id);
      const text = label ?? node?.name ?? id;
      return node
        ? `[${text}](/item/${id}/)`
        : `<a href="/item/${id}/" class="redlink" title="This part does not exist yet">${text}</a>`;
    },
  );
  const html = marked.parse(resolved, { async: false }) as string;
  return sanitizeHtml(html, markdownOptions);
}

/** Rough word count of an article body (for "N-word article" labels). */
export function articleWordCount(md: string): number {
  return (md.match(/\b\w+\b/g) ?? []).length;
}
