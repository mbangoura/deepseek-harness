#!/bin/bash
# Rebase the fork's build branch onto upstream and push it.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Working tree has uncommitted changes; commit or stash them first." >&2
  exit 1
fi

git remote get-url upstream >/dev/null 2>&1 || \
  git remote add upstream https://github.com/deepseek-ai/deepseek-harness.git

git fetch upstream --tags
git checkout "$BRANCH"
git rebase upstream/master
git push --force-with-lease origin "$BRANCH"
