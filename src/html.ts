export function esc(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
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
