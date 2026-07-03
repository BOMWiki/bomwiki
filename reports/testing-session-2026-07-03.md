# Testing session findings (2026-07-03)

Worked the testing charter against the local dev engine (Postgres `bomwiki_dev`,
full 192k import) on port 4400, plus a close read of the write path, auth, and
render/escaping code. Baseline before starting: `tsc --noEmit` clean and all
three smoke suites green. Same after the changes below.

## Fixed in this session (small, committed)

### 1. Session cookie was missing the `Secure` attribute
`bw_sess` was set with `HttpOnly; SameSite=Lax` but no `Secure`, so on the live
HTTPS site the session cookie could ride along on any accidental plain-HTTP
request. Added `Secure` when `NODE_ENV === 'production'`; left off in local dev
so login keeps working over `http://localhost`. Single set point in
`server.ts` (`setSessionAndGo`); logout clear is unaffected.

### 2. A NUL byte in a text field returned an opaque 500
Postgres `text` and `jsonb` both reject U+0000. Reachable by a contributor
through `/api/changesets` (any snapshot field: name, summary, article, specs,
aliases, BOM notes) and through a discussion comment body. The insert failed
deep in the transaction, which rolled back cleanly (server survived, no
corruption) but surfaced as `500 internal error` instead of a validation
message. Now:
- `validateEdits` rejects it with `text fields may not contain null bytes`
  (422). The check walks the parsed snapshot's string leaves, because
  `JSON.stringify` re-escapes a real NUL back to the six characters `\u0000`,
  so a check on the serialized form would miss it.
- `addComment` rejects it with `comment may not contain null bytes` (422).
- Profile fields (settings) and the reviewer verify note have no error channel
  back to the user, so they strip the NUL instead (`stripNul`).

Helpers `hasNul` / `stripNul` live in `html.ts`. Verified: NUL in name and in
comment body now return 422; legitimate unicode (emoji, accented text) still
saves fine.

## Reported for a decision (not changed)

### 3. BOM quantity has no upper bound
`validateEdits` accepts any positive integer quantity. A proposed line with
`qty = 999999999999` validates and (for a trusted author) applies. It would
produce absurd "Ext. qty" and "Total parts" figures on the rendered page but no
crash. Left as-is because a cap is a content-policy call, not a bug. Suggest a
sane ceiling (for example `qty <= 1_000_000`) if you want one.

## Checked and holding (no change needed)

- **Permissions (server-side, not just UI hiding).** Contributor and
  signed-out clients hit every privileged route directly:
  `/review` (403 reviewers-only), `/review/:id/accept`, `/item/:id/verify`,
  `/admin` (303 to login), `/admin/redirect`, `/admin/domains`,
  `/admin/homepage`, `/admin/user/:h/block|mass-revert`, `/talk/:id/resolve`,
  `/api/changesets`. All blocked before any mutation; confirmed the target
  node's verification state was unchanged after the probes. Reviewer tier
  verified by code (reviewer passes `requireReviewer` routes, is still bounced
  from the admin-only `/admin*` and moderation routes).
- **XSS.** Articles go through `marked` + `sanitize-html` (scheme allowlist,
  external links get `nofollow ugc noopener noreferrer`). Every other
  user-controlled field is `esc()`-escaped at render. JSON-LD and the editor's
  embedded JSON both escape `<` to `\u003c`, so a node name can't break out of
  a `<script>`. Handles are regex-constrained (`^[a-z0-9][a-z0-9_-]{2,29}$`),
  so the account-chrome `innerHTML` in `base.ts` is safe.
- **Content invariants** (`/api/changesets`): self-cycle, two-node cycle,
  dangling component ref, qty 0 / negative / fractional, duplicate BOM line,
  create-colliding-id, invalid id, invalid kind, empty name, empty changeset —
  all rejected with clear 422 messages.
- **id-regex.** Route patterns constrain ids to `[A-Za-z0-9._-]`; the FFS
  Cypher interpolation in `graphdb.ts` re-checks the same pattern before
  building the query. `/api/pending?node=` rejects a bad id with 422. Path
  traversal on `/static/` and `/img/` returns 404.
- **Magic links.** One-time use confirmed (second visit → 403); 30-minute
  expiry and unknown-vs-blocked accounts return the identical "sent" response
  (no account enumeration).
- **Malformed / oversized input.** Bad JSON → 400; body over 2MB → 400 (via
  the read cap); server stays up throughout.
- **Caching.** Read pages carry `max-age=60, stale-while-revalidate=86400`;
  sitemap `max-age=3600`; versioned static assets `immutable`, unversioned
  `max-age=300`; `/random` is `no-store`. Session chrome and the pending-note
  are client-fetched, so cached HTML stays per-viewer-correct.
- **Degradation.** FFS sidecar was not running locally: item pages render
  fast and simply omit the "Appears in N products" line (null path), as
  designed.
- **Perf (local dev, single process, no sidecar), 20-request average:**
  home ~60ms, `/products` ~77ms, item pages ~60-83ms, `/search` ~19ms,
  `/changes` ~2ms.

## Notes / smaller observations

- **CSRF** rests entirely on `SameSite=Lax` (no tokens). Acceptable for modern
  browsers. The only state-changing GET is the magic-link consume
  (`/auth/:token`), which is login-CSRF at worst (low impact). Fine to leave;
  worth a line in the docs.
- A body over 2MB on `/api/changesets` is reported as `invalid JSON` rather
  than a size-specific message (the size error is caught by the same try that
  wraps `JSON.parse`). Cosmetic.

## Not covered (environment limits)

- The through-Cloudflare browser pass (charter #1/#2 "real browser, Cloudflare
  in the loop", signup email via Resend) was not run from this session. Local
  origin behavior is covered above; the Cloudflare edge and Resend delivery
  still need a real-browser pass.
