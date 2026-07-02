# Security

If you find a vulnerability in this engine or on bomwiki.com, please report
it privately rather than opening a public issue.

- Email: admin@bomwiki.com
- Include steps to reproduce and, if you can, an assessment of impact.
- We aim to acknowledge within 72 hours. Please allow a reasonable window
  for a fix before public disclosure.

Sensitive areas worth extra scrutiny: the magic-link sign-in flow, session
handling, the changeset accept path (merge and revalidation), moderation
endpoints, and anything that renders user-supplied content (articles,
comments, specs).
