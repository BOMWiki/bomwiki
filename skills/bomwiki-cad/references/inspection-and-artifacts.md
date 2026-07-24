# Inspection and artifacts

Use `cad_query` and `cad_inspect` for semantic and exact evidence. Distinguish exact kernel results from descriptive document metadata.

## Verification

- Check B-rep validity and solid counts for modeling operations.
- Check mate solve state and remaining degrees of freedom for assemblies.
- Use `assembly.clearance`, `assembly.interference`, and `geometry.health` only when advertised for the current exact live session.
- Bind results to document and render revisions.
- Record unchanged assertions when the task requires preserving geometry or metadata.

## Artifacts

Request only an approved format and scope. Use stable `entities` for selected-body or selected-component STEP/STL/PNG artifacts, or the explicit `selection` or `visible-model` scope. Verify returned bytes, media type, checksum, manifest, resolved body IDs, camera/render revisions where applicable, and document hash.

To open a host file in the connected visible Studio, call `cad_artifact` with `action: "import"`, an approved `path`, and `format: "project"` or `format: "step"`. Request `project.replace` explicitly. The MCP host reads only from an approved input root, transfers bounded integrity-checked chunks, and returns the new project ID, revision, document hash, source checksum, and STEP manifest when applicable. Refresh project and UI state after the import; the approved session remains connected to the new project.

PNG is a model-only renderer artifact and must report `browserChromeIncluded: false`; it is not proof of command, permission, or commit state. WebVTT/SRT exports contain completed visible narration cues only.

Headless sessions must fail rather than fabricate STEP, STL, or render evidence when no exact kernel adapter exists. Live browser sessions may still have transfer-size or format limits; report them exactly.
