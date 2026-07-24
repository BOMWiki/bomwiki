# Conflicts and recovery

## Document revision conflict

1. Stop. Do not retry the stale commit.
2. Inspect history changes since the expected revision.
3. Re-inspect affected entities and persistent references.
4. Rebuild the transaction against the current document.
5. Preview again and verify new evidence before commit.

## UI revision conflict

Refresh `cad_ui` snapshot. Confirm the active document, selection, command state, and user changes before creating a new action batch.

## Kernel or reference failure

Keep the last valid geometry visible. Read diagnostics and repair options. Rebind only through stable semantic candidates. Never substitute approximate evidence for an exact request.

## Reload or disconnect

Reconnect through the approved handshake, refresh capabilities, document summary, UI snapshot, and event cursor, then confirm the intended project, canonical document hash, exact geometry hash/evidence, and recovered revision. A replaced project invalidates old project-bound authority. Never commit a preview created before reload; recovery must report it as expired or non-current.

Human intervention takes priority. If Studio reports pause, rejection, revocation, or attention required, stop mutating work and hand control back clearly.
