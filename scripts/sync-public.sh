#!/bin/bash
# Mirror engine/ to the public repo, github.com/BOMWiki/bomwiki.
#
# The public repo is a mirror of this directory: LICENSE, README.md,
# CONTRIBUTING.md and SECURITY.md live in engine/ so the trees match
# exactly. CI runs this on every push to wiki/engine; each push becomes
# one public commit carrying the same subject line.
#
# Run from the repo root. Auth is either DEPLOY_KEY (an SSH private key
# with write access to the public repo — what CI uses) or, when unset,
# whatever git auth the caller already has (a manual run on a laptop).
set -euo pipefail

if [ ! -d engine/src ]; then
  echo "run from the repo root" >&2
  exit 1
fi

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

URL=https://github.com/BOMWiki/bomwiki.git
if [ -n "${DEPLOY_KEY:-}" ]; then
  printf '%s\n' "$DEPLOY_KEY" > "$WORK/key"
  chmod 600 "$WORK/key"
  export GIT_SSH_COMMAND="ssh -i $WORK/key -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
  URL=git@github.com:BOMWiki/bomwiki.git
fi

# Mirror the committed tree, never the working directory, so untracked
# files (node_modules, scratch reports) can't leak into the public repo.
mkdir "$WORK/tree"
git archive HEAD engine | tar -x --strip-components=1 -C "$WORK/tree"

git clone --quiet --depth 1 "$URL" "$WORK/public"
rsync -a --delete --exclude '.git' "$WORK/tree/" "$WORK/public/"

cd "$WORK/public"
git add -A
if git diff --cached --quiet; then
  echo "public repo already current"
  exit 0
fi

# Reuse the source commit's subject so public history reads like ours.
MSG=$(git -C "$OLDPWD" log -1 --format=%s)
git -c user.name=protosphinx \
    -c user.email='133899485+protosphinx@users.noreply.github.com' \
    commit --quiet -m "$MSG"
git push --quiet origin main
echo "synced: $MSG"
