# Assemblies and mates

Inspect assembly definitions, occurrences, transforms, mate references, solve state, and degrees of freedom before editing.

## Components and transforms

- Distinguish reusable definitions from occurrences.
- Target the stable occurrence ID and preserve definition linkage unless independence is requested and advertised.
- Preview transforms and verify the returned world transform and affected solve state.
- When the live UI manifest advertises `assembly.component-transform`, open the normal command panel, bind the `occurrence` field, set the rigid `transform` matrix, and use `command.preview`. Confirm `directVisibleHashParity` and exact evidence before committing the returned preview ID.

## Mates

1. Resolve each mate reference from semantic topology, datum, or advertised reference geometry.
2. Preview the mate transaction.
3. Require exact or explicitly classified solve evidence.
4. Treat conflicts, redundant constraints, and remaining degrees of freedom as results to report, not states to hide.
5. Commit only the revision-bound preview.

For visible work, reveal and select occurrences through `cad_ui`. Do not target components by tree position, screen position, or display name alone.
