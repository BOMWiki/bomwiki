# BOMwiki CAD MCP

`@bomwiki/cad-mcp` is the local, host-neutral MCP integration for BOMwiki CAD
Studio V6. It lets a compatible agent inspect and operate the real visible
Studio through typed CAD and semantic UI tools. It does not expose Computer
Use, DOM selectors, pointer coordinates, keyboard synthesis, browser storage,
arbitrary JavaScript, or private geometry shortcuts.

This package includes:

- the `bomwiki-cad-mcp` stdio server;
- the fixed loopback bridge used by a user-approved Studio tab;
- the exact document command runtime used for headless project sessions;
- the canonical `bomwiki-cad` skill and its progressive references;
- the same skill content as MCP resources under `bomwiki-cad://skills/*`.

## Requirements

- Node.js 22.6 or newer;
- a local desktop agent host with stdio MCP support;
- BOMwiki CAD Studio at `https://bomwiki.com/cad/studio` for visible UI work.

## Install

Pin the version used by the host:

```bash
npm install --global @bomwiki/cad-mcp@6.0.0-alpha.1
```

Prerelease builds publish only under the `next` dist-tag. They never replace
the stable `latest` package.

The package embeds the exact Git source commit, protocol/profile IDs, and
canonical skill version in `package.json.bomwiki`. Maintainers build a
no-write publication plan first:

```bash
npm run studio:v6:package:publish -- \
  --expected-sha <40-character-reviewed-sha> \
  --expected-version 6.0.0-alpha.1
```

External publication additionally requires a clean worktree, authenticated
npm identity, and the exact confirmation string printed by the plan. The
publisher refuses a source/version mismatch or stable tag and never overwrites
an existing version. It is pinned to the public npm registry. After publishing,
it downloads the registry tarball, checks byte-for-byte SHA-256 parity, and
verifies that only `next` points to the alpha. A retry after an interrupted
publish verifies the immutable existing version instead of attempting to
overwrite it.

The server writes MCP JSON-RPC to stdout. Diagnostics stay on stderr.

## Add to Codex

Codex desktop, CLI, and the IDE extension share their configured MCP servers.
Add the local server with the minimum permission ceiling appropriate for the
work:

```bash
codex mcp add bomwiki-cad -- \
  bomwiki-cad-mcp \
  --bridge-port 49784 \
  --studio-origin https://bomwiki.com \
  --studio-url https://bomwiki.com/cad/studio \
  --permissions project.read,project.edit,ui.read,ui.select,ui.navigate,ui.command-draft,ui.present-preview,ui.present-narration,ui.wait-events,session.launch-visible
```

Restart the Codex client after changing MCP configuration. For visible work,
open Studio, ask the agent to connect, and approve the named request inside
Studio. The command-line permission list is only the server-side ceiling:
Studio still displays and approves the requested session scopes before any
project data is shared.

The server initialization instructions tell Codex to load the canonical core
skill resource and call `cad_capabilities` before planning. Hosts with native
Agent Skills support may also install the bundled directory at
`skills/bomwiki-cad`; the MCP resources remain authoritative when the installed
skill version differs from the advertised version.

## Other MCP hosts

Configure a stdio MCP server with:

- command: `bomwiki-cad-mcp`;
- arguments: the same bounded flags shown above;
- protocol version: `2025-11-25`.

Read `bomwiki-cad://skills/core` after initialization, call
`cad_capabilities`, and follow the advertised schemas and revisions. Codex has
no private tool path; another conforming MCP client receives the same tools,
resources, permissions, and diagnostics.

## Filesystem boundaries

No host file is readable or writable unless its root is declared when starting
the server:

```bash
bomwiki-cad-mcp \
  --allow-read /absolute/path/to/approved-inputs \
  --allow-write /absolute/path/to/approved-outputs
```

Use `project.replace` to import a project or STEP file from an approved input
root. Use the specific artifact and save permissions for output. Imports are
bounded to 32 MiB and verified by byte count plus SHA-256 before Studio parses
or activates them.

## Operating contract

- Discover capabilities before acting.
- Keep discovery bounded: start with the compact summaries, then request schemas
  only for the operation, query, command, action, or control IDs needed for the
  current task. The catalog/full forms are for unknown-control discovery and
  audits, not routine context.
- Use stable entity and topology references.
- Use `cad_ui` for visible, non-persistent Studio interaction.
- Use `cad_preview` before every persistent `cad_commit`.
- Wait for structured events instead of sleeping.
- Treat human edits as revision conflicts and re-preview.
- Claim geometry, solve, render, save, or export success only from returned
  structured evidence.

The user controls pairing, granted scopes, preview approval, pause, resume,
revocation, and final release decisions.

## License

AGPL-3.0-only. See the bundled `LICENSE`.
