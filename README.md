# BOMwiki engine

The community wiki behind bomwiki.com: nodes (products, assemblies, parts)
live in Postgres, every edit is a full-snapshot revision grouped into
changesets, and the site is rendered server-side with no framework —
`node:http`, TypeScript template functions, plain CSS, one runtime
dependency (`pg`).

## Run it locally

```bash
createdb bomwiki_dev
npm install
npm run migrate        # applies schema/*.sql in order
npm run export-graph   # dumps the static site's graph (one-time)
npm run import         # loads it as revision 1 of every node
npm run serve          # http://localhost:4400
```

Sign in at `/login` with the admin token (`ADMIN_TOKEN`, default
`dev-admin`), or create an account via email magic link — in development
the link is shown on the page instead of mailed.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | `postgres:///bomwiki_dev` | Postgres connection |
| `PORT` | `4400` | HTTP port |
| `ADMIN_TOKEN` | `dev-admin` | operator sign-in token |
| `ADMIN_HANDLE` | `sd` | handle for the token account |
| `AUTOCONFIRM_EDITS` | `4` | accepted changesets before edits publish instantly |
| `AUTOCONFIRM_DAYS` | `0` | account age also required for autoconfirm (production: 3+) |
| `INTEL_URL` | `http://127.0.0.1:8799` | bomwiki-intelligence sidecar |
| `INTEL_TIMEOUT_MS` | `4000` | sidecar timeout per analysis |

## How editing works

Propose → validate (references, quantities, cycles) → pending changeset →
review (`/review`) → accept applies each edit as a new revision. Trusted
users (reviewers, admins, and contributors past the autoconfirm threshold)
publish directly. Concurrent edits merge field-by-field and BOM-line-by-line;
only overlapping changes are conflicts. Every node has History (view any
revision, revert) and Discussion tabs; site-wide surfaces are `/changes`,
`/user/:handle`, `/watchlist`.

## The machine patroller

If the [bomwiki-intelligence](https://github.com/erphq/bomwiki-intelligence)
sidecar is running (`cargo run --release -- serve --addr 127.0.0.1:8799`),
every proposed changeset gets machine findings attached in the review queue.
Without it, everything works; there are just no findings.

## Tests

```bash
npm run typecheck
node --experimental-strip-types scripts/edit-smoke.ts       # 23 checks, needs a running server
node --experimental-strip-types scripts/community-smoke.ts  # 29 checks
node --experimental-strip-types scripts/parity.ts <ids…>    # vs the Astro site on :4321
node --experimental-strip-types scripts/catalog-audit.ts    # sidecar audit -> reports/
```
