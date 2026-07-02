# Contributing

Two ways to contribute, and they are different things:

**Content** (fixing what a product is made of) happens on
[bomwiki.com](https://bomwiki.com), not here. Open an account, click Edit on
any page. See the [contribution policies](https://bomwiki.com/policies).

**Code** (this repository) welcomes pull requests. Ground rules:

- The stack is intentionally minimal: `node:http`, TypeScript template
  functions, plain CSS, Postgres. PRs that add frameworks, build steps, or
  dependencies need a strong reason. There are currently three runtime
  dependencies; treat that number as a budget.
- `npm run typecheck` must pass, and the smoke suites
  (`scripts/*-smoke.ts`, run against a local server) must stay green. New
  behavior needs new checks in those suites.
- User-facing copy follows the house style: plain sentences, no em-dashes,
  estimates and machine actions labeled as such.
- Schema changes are append-only migration files in `schema/`.
- By contributing you license your work under AGPL-3.0.

For anything larger than a bugfix, open an issue first describing the
change and why it belongs in the engine rather than in a fork.
