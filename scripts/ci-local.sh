#!/usr/bin/env bash
# Local mirror of .github/workflows/ci.yml: same jobs, same order, same commands,
# run against the committed tree (git archive HEAD), which is what CI checks out.
# Every step runs (no stop at the first failure), then a pass/fail summary prints.
#
#   bun run ci        full mirror: Node matrix in containers, audits, both images, Trivy
#   bun run ci:fast   frozen install + test + lint on the host Node, then the audit
#
# Wired to .githooks/pre-push. Add a CI step -> add it here in the same commit.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

NODE_MATRIX=(22 24 26)          # ci.yml jobs.test.strategy.matrix.node-version
AUDIT_NODE=24                   # ci.yml jobs.audit / jobs.docker setup-node
TRIVY_VERSION=0.76.1            # ci.yml trivy-action `version`
IMAGE=discord-osint-assistant

LOGS="${CI_LOG_DIR:-$(mktemp -d -t ci-local-XXXXXX)}"
SRC="$LOGS/src"
mkdir -p "$SRC" && git archive HEAD | tar -x -C "$SRC"
BUN="$(command -v bun)"
RESULTS=()

step() {
    local name=$1; shift
    local log="$LOGS/$(echo "$name" | tr -c 'a-zA-Z0-9\n' '_').log"
    printf '▶ %-34s ' "$name"
    if "$@" >"$log" 2>&1; then echo "PASS"; RESULTS+=("PASS  $name")
    else echo "FAIL  $log"; RESULTS+=("FAIL  $name  ($log)"); fi
}

# Run a shell snippet in a throwaway copy of the archived tree, on a given Node.
in_node() {
    local version=$1; shift
    docker run --rm -v "$SRC:/src:ro" -v "$BUN:/usr/local/bin/bun:ro" -e CI=true \
        "node:${version}-slim" sh -ec "cp -r /src /w && cd /w && $*"
}

trivy() {
    docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v ci-local-trivy:/root/.cache \
        "aquasec/trivy:${TRIVY_VERSION}" image --quiet "$@"
}

if [ "${1:-}" = "--fast" ]; then
    step "test (host node $(node -v))" sh -ec 'bun install --frozen-lockfile && bun run test && bun run lint'
else
    for v in "${NODE_MATRIX[@]}"; do
        step "test (node $v)" in_node "$v" 'bun install --frozen-lockfile && bun run test && bun run lint'
    done
fi

step "audit" in_node "$AUDIT_NODE" 'npm install --package-lock-only && npm audit --audit-level=moderate'

if [ "${1:-}" != "--fast" ]; then
    step "docker: build slim" docker build -t "$IMAGE" "$SRC"
    step "docker: trivy slim" trivy --severity CRITICAL,HIGH --exit-code 1 --pkg-types library --ignore-unfixed "$IMAGE"
    step "docker: prod audit" in_node "$AUDIT_NODE" 'npm install --package-lock-only && npm audit --omit=dev --audit-level=high'
    step "docker-full: build" docker build --target full -t "$IMAGE:full" "$SRC"
    step "docker-full: every tool present" docker run --rm -e DISCORD_TOKEN=ci -e CLIENT_ID=0 --entrypoint bun "$IMAGE:full" scripts/check-tools.js
    step "docker-full: trivy (report)" trivy --severity CRITICAL,HIGH --exit-code 0 --pkg-types library --ignore-unfixed "$IMAGE:full"
fi

echo; echo "──── summary (logs: $LOGS)"
printf '%s\n' "${RESULTS[@]}"
! printf '%s\n' "${RESULTS[@]}" | grep -q '^FAIL'
