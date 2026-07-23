# BOMwiki engine

The software behind [bomwiki.com](https://bomwiki.com): an openly editable,
versioned encyclopedia of bills of materials. Products, assemblies, and parts
are nodes in one shared graph. Every edit is a full-snapshot revision grouped
into a changeset, reviewed before it goes live (or published directly once a
contributor has earned trust), and reversible forever.

Built deliberately small: Node.js with no web framework, plain TypeScript
template functions, plain CSS, Postgres, and three runtime dependencies
(`pg`, `marked`, `sanitize-html`). Anyone who knows the web platform can
patch it.

## Features

- Node-level wiki: every part, assembly, and product is a page with history,
  diff, revert, and a discussion tab
- Edit-in-place: the page you are reading becomes the editor, with a part
  picker that cannot produce dangling references
- Changesets with plain-language summaries ("Battery Module quantity 8 to
  10") shown identically in the change bar, review queue, and history
- Trust ladder: new accounts' edits wait for review; contributors earn
  direct publishing with accepted edits and account age
- Three-way merge for concurrent edits, field by field and BOM line by line
- Structural guarantees on every edit: no cycles, no dangling references,
  no duplicate lines, integer quantities
- Verification statuses (unverified, machine-checked, human-verified) with
  search-engine indexability earned through human verification
- Articles in markdown with `[[wiki-links]]`, infobox specs, aliases
- Moderation: blocks, mass-revert per account, rate limits, nofollow on
  contributed external links
- Optional analysis sidecar over a small HTTP contract (see below)
- Magic-link email sign-in (Resend-compatible HTTP API), sessions in Postgres

## Quickstart

Requires Node 22+ and Postgres 15+.

```bash
createdb bomwiki_dev
npm install
npm run migrate                 # applies schema/*.sql in order
node --experimental-strip-types scripts/import.ts graph.json   # optional seed
npm run serve                   # http://localhost:4400
```

Sign in at `/login` with the admin token (`ADMIN_TOKEN`, default
`dev-admin`), or create an account with the email flow. In development the
magic link is shown on screen; in production it is emailed.

### Seeding a catalog

`scripts/import.ts` loads a JSON array of nodes as revision 1 of each page:

```json
{
  "id": "coffee-table",
  "name": "Coffee Table",
  "kind": "product",
  "domain": "furniture",
  "summary": "A low living-room table.",
  "bom": [{ "id": "coffee-table-top", "qty": 1, "note": "Tabletop assembly" }],
  "article": "## Overview\n\nMarkdown with [[coffee-table-top]] links.",
  "specs": [["Material", "Oak"]],
  "aliases": ["cocktail table"]
}
```

`kind` is `product`, `assembly`, or `part`. The importer refuses dangling
BOM references and non-empty databases. Starting with an empty database and
creating pages through the editor also works.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | `postgres:///bomwiki_dev` | Postgres connection |
| `PORT` | `4400` | HTTP port |
| `READ_PRESSURE_LIMIT` | `8` | concurrent deep history, talk, revision, and model-upload reads |
| `ADMIN_TOKEN` | `dev-admin` | operator sign-in token |
| `ADMIN_HANDLE` | `sd` | handle for the token account |
| `AUTOCONFIRM_EDITS` | `4` | accepted changesets before edits publish instantly |
| `AUTOCONFIRM_DAYS` | `0` | account age also required (production: 3+) |
| `DEV_SHOW_MAGIC_LINK` | on outside production | shows sign-in links on screen; must be off in production |
| `MAIL_API_KEY` | empty | Resend-compatible key; empty disables email sign-in |
| `MAIL_FROM` | `BOMwiki <signin@bomwiki.com>` | sender for magic links |
| `SITE_ORIGIN` | `https://bomwiki.com` | absolute origin used in emails |
| `PUBLIC_DIR` | `../public` | static assets (photos, favicons) |
| `IMAGES_JSON`, `GALLERIES_JSON` | see `src/images.ts` | photo mappings |
| `INTEL_URL` | `http://127.0.0.1:8799` | analysis sidecar (optional) |

`deploy/` contains a systemd unit, a production env template, and a runbook.

## The analysis sidecar

The engine optionally sends every proposed changeset to an analyzer:
`POST {INTEL_URL}/api/analyze?product=<root-id>` with a JSON body of
`items` (`{id, name, description, item_type}`), `products`
(`{id, name, root_item_id}`), and `bom_lines`
(`{parent_id, child_id, quantity}`). The response's `bom_review` object is
turned into findings shown in the review queue. Without a sidecar the
engine runs normally and shows no findings.

bomwiki.com runs a closed-source analyzer behind this contract
([what it does](https://bomwiki.com/intelligence)). Implement the contract
with your own analyzer and the review queue picks it up.

## Tests

```bash
npm run typecheck
node --experimental-strip-types scripts/edit-smoke.ts       # needs a running server
node --experimental-strip-types scripts/community-smoke.ts
node --experimental-strip-types scripts/multiuser-smoke.ts
```

## License

AGPL-3.0. If you run a modified version of this engine as a public service,
you must publish your modifications under the same terms. Content on
bomwiki.com is licensed separately; see
[bomwiki.com/about/governance](https://bomwiki.com/about/governance).
