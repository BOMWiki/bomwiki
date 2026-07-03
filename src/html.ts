export function esc(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Postgres text and jsonb both reject the NUL byte (U+0000). User input that
 *  carries one should be turned away with a clean validation error rather than
 *  failing deep in an INSERT as an opaque 500. */
export function hasNul(s: string): boolean {
  return s.includes('\u0000');
}

/** Drop NUL bytes from a free-text field that has no error channel to the user
 *  (profile fields, reviewer notes). Everything else about the value stands. */
export function stripNul(s: string): string {
  return s.replaceAll('\u0000', '');
}

/** Render a newline-separated change summary as escaped <li> items. Shared by
 *  the review queue, history, recent changes, and the watchlist so they can't
 *  drift apart. */
export function summaryLines(summary: string): string {
  return summary
    .split('\n')
    .map((line) => `<li>${esc(line)}</li>`)
    .join('');
}

/** Compact "YYYY-MM-DD HH:MM" from an ISO timestamp, escaped. */
export function fmtWhen(iso: string): string {
  return esc(iso.slice(0, 16).replace('T', ' '));
}
