#!/usr/bin/env bash
# Local mirror of .github/workflows/ci.yml: same jobs, same order, same commands,
# run against the committed tree (git archive HEAD), which is what CI checks out.
# Every step runs (no stop at the first failure), then a pass/fail summary prints.
#
#   bun run ci        full mirror: Node matrix in containers, audits, both images, Trivy
#   bun run ci:fast   dev loop only: frozen install + test + lint of the WORKING TREE on
#                     the host Node (touches host node_modules), then the audit
#
# CI_LOG_DIR=<dir> keeps the step logs there (default: a fresh temp dir, printed at the end).
# Pre-push hook (opt-in): git config core.hooksPath .githooks
# Add a CI step -> add it here in the same commit.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

NODE_MATRIX=(22 24 26)          # ci.yml jobs.test.strategy.matrix.node-version
AUDIT_NODE=24                   # ci.yml jobs.audit setup-node (jobs.docker uses the runner's Node)
# ci.yml trivy-action `version` (0.76.1), pinned by digest: it never gets the Docker socket
TRIVY_IMAGE=aquasec/trivy:0.76.1@sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c
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
    docker run --rm --pull=always -v "$SRC:/src:ro" -v "$BUN:/usr/local/bin/bun:ro" -e CI=true \
        "node:${version}-slim" sh -ec "cp -r /src /w && cd /w && $*"
}

# Scan a saved image tarball: Trivy never sees the Docker socket. Last arg = image ref.
trivy() {
    local img=${!#} tar="$LOGS/scan.tar"
    [[ $img == *:* ]] || img="$img:latest"   # an untagged repo name would save every tag
    docker save "$img" -o "$tar" || return 1
    docker run --rm -v "$tar:/in/scan.tar:ro" -v ci-local-trivy:/root/.cache "$TRIVY_IMAGE" \
        image --quiet "${@:1:$#-1}" --input /in/scan.tar
    local rc=$?; rm -f "$tar"; return $rc
}

# The containers run the host bun: it must be the version ci.yml pins.
CI_BUN=$(sed -n 's/.*bun-version: *\([0-9.]*\).*/\1/p' .github/workflows/ci.yml | head -1)
step "bun $CI_BUN (ci.yml setup-bun)" test "$("$BUN" --version)" = "$CI_BUN"
# Versions pinned in two files must agree: Bun (ci.yml vs Dockerfile), Trivy (ci.yml vs here).
TRIVY_VER=${TRIVY_IMAGE#aquasec/trivy:}; TRIVY_VER=${TRIVY_VER%%@*}
step "pins agree (bun, trivy)" sh -ec "grep -q 'FROM oven/bun:${CI_BUN}-slim@' Dockerfile && \
    grep -q 'version: v${TRIVY_VER}' .github/workflows/ci.yml"

if [ "${1:-}" = "--fast" ]; then
    step "test (host node $(node -v))" sh -ec 'bun install --frozen-lockfile && bun run test && bun run lint && bun run knip'
else
    for v in "${NODE_MATRIX[@]}"; do
        step "test (node $v)" in_node "$v" 'bun install --frozen-lockfile && bun run test && bun run lint && bun run knip'
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
