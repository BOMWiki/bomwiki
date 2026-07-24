# Sessions and permissions

## Choose a session

- Use a headless session for document work that does not need the visible browser kernel or Studio UI.
- Use a live Studio session for visible operation, exact browser-kernel evidence, UI state, presentation, or recording.
- Connect to the project the user placed in scope. Confirm `projectId` after approval.

## Connection flow

1. Request the minimum grants with `cad_session`.
2. For Studio-first use, tell the user to choose **Connect agent** in Studio. Studio finds the fixed local bridge directly.
3. For agent-first use, request `session.launch-visible` and open the returned `launchUrl` only when the user authorized opening Studio. Without that grant, use Studio-first discovery. The short-lived nonce remains in the browser fragment and is not a project credential.
4. Let Studio show the client label, skill version, mode, scopes, expiry, and budgets. Wait for one visible user approval. Never copy or paste a pairing URL.
5. Poll `cad_session status` only for connection state; after connection use `cad_events`.
6. Read document and UI snapshots before acting.

Opening Studio is not approval to edit. A read-only connection cannot preview, commit, control UI, or export without the relevant grant.

## Scope guide

- `project.read`: inspect semantic document state.
- `project.edit`: preview and commit document transactions.
- `project.replace`: replace the visible project through an approved project/STEP import while preserving the scoped session.
- `ui.read`: read visible Studio capability and interaction state.
- `ui.select`: change semantic selection and open the matching inspector.
- `ui.navigate`: activate workspaces, reveal tree entities, and change the semantic camera/view.
- `ui.command-draft`: populate a visible non-persistent command draft when the command is advertised.
- `ui.present-preview`: show or dismiss an already-authorized normal preview.
- `ui.present-demo`: change semantic presentation mode and direct visible choreography.
- `ui.present-narration`: show structured action narration.
- `ui.wait-events`: wait for advertised structured settlement and lifecycle events.
- `session.launch-visible`: receive the agent-first Studio launch URL and recovery launch URL.
- `artifact.export-project`, `artifact.export-step`, `artifact.export-stl`, `artifact.export-narration`, `artifact.render`: request the named artifact.
- `project.save-new` or `project.save-in-place`: persist to an approved path.

Close or revoke the session when work is complete. A structured project import updates the connected session to the returned project ID; reconnect only after an explicit revocation or page reload.

## Pause, expiry, and recovery

- Treat `session.paused` as an immediate stop. Cancellable pending requests are cancelled; do not submit new work until `session.resumed`.
- Treat `PERMISSION_EXPIRED` and `SESSION_REVOKED` as terminal. Request a new scoped session rather than reusing old authority.
- When status becomes `recovering` after a Studio reload, call `cad_session` with `action: "reconnect"` before the advertised recovery deadline, open the returned launch URL, and wait for recovery approval.
- After recovery, reload capabilities, project summary, UI snapshot, and the current event cursor. Never reuse a stale preview as committable work.
