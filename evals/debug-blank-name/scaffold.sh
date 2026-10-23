#!/usr/bin/env bash
set -euo pipefail
node "$(dirname "$0")/../scaffold.mjs"
node "$(dirname "$0")/setup.mjs"
