# Part modeling

Inspect the project tree and capability manifest before choosing operations. Work with stable body, feature, datum, sketch, face, edge, and vertex references returned by the protocol.

## Persistent feature workflow

1. Inspect the target body and its dependencies at the current revision.
2. Build one atomic typed transaction from advertised operation schemas.
3. Preview it at `expectedRevision`.
4. Verify the semantic change set, exact body results, topology-reference status, and unchanged assertions.
5. Commit the exact preview ID at the same revision.
6. Wait for document, kernel, render, and history settlement.
7. Re-inspect the feature and affected bodies.

Prefer editable feature operations over baked geometry. State result policies and target body IDs explicitly. Use construction geometry and persistent topology references where advertised. Do not infer faces or edges from viewport position.
