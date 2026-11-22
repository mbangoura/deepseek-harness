#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
exec node --test tests/*.test.mjs
