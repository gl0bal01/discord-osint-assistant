# Two images from one file:
#   slim (default) — Bun + npm deps only; CLI-backed commands are hidden
#   full           — adds Sherlock, Maigret, GHunt, xeuledoc, Linkook, jwt_tool,
#                    Nuclei (+ templates) and ExifTool
# Pick one with BOT_TARGET=slim|full (docker-compose.yml) or `docker build --target full`.
# The tools layer is independent of the app code, so code changes rebuild in
# seconds. Tools are pinned: bump the pins (requirements.txt, ARGs below, base digest)
# to upgrade; `--no-cache` only refreshes apt packages and unpinned transitive deps.

# Production dependencies + app code
FROM oven/bun:1.4.4-slim@sha256:1846adf22496bd711036aae8be147e57bdebbaea2e5264e3e0b5af1db187d9a4 AS app
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile
COPY index.js deploy-commands.js clear-commands.js ./
COPY commands/ ./commands/
COPY utils/ ./utils/
COPY scripts/ ./scripts/
COPY addons/ ./addons/

# Runtime shared by both images
FROM oven/bun:1.4.4-slim@sha256:1846adf22496bd711036aae8be147e57bdebbaea2e5264e3e0b5af1db187d9a4 AS runtime
WORKDIR /app

# Non-root user (uid 999, matches the compose tmpfs mounts). The app code copied
# in later stays root-owned (read-only to the bot); only these dirs and $HOME are writable.
RUN groupadd -r botuser && useradd -r -m -g botuser botuser \
    && mkdir -p /app/temp /app/reports \
    && chown botuser:botuser /app/temp /app/reports

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["bun", "run", "scripts/healthcheck.js"]

CMD ["bun", "run", "start"]

# Every external OSINT tool the CLI-backed commands need, pinned. Python tools:
# docker/osint/requirements.txt (Dependabot). The ARGs below are bumped by hand:
# git refs by commit, the nuclei zip by its published SHA256.
FROM runtime AS tools
ARG NUCLEI_VERSION=3.11.1
ARG NUCLEI_SHA256_AMD64=ea63d4ae232808cd7c6bc00d0142428e231fab59dae01042246097d195835ab6
ARG NUCLEI_SHA256_ARM64=8044e3d9768ba0a744b2872c1a87e813006f013da97ca9f50f7661a4203bec07
# nuclei-templates v10.5.1
ARG NUCLEI_TEMPLATES_COMMIT=79fb682760ab3d5b0e22afbb44709353cbebf023
ARG JWT_TOOL_COMMIT=3bc7407cf2222d6a821dcc19c776e5a1b1cb9a9b
ARG TARGETARCH
COPY docker/osint/requirements.txt /opt/osint-requirements.txt
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 python3-venv libimage-exiftool-perl ca-certificates git curl unzip \
    # Python tools in one venv, exposed on PATH
    && python3 -m venv /opt/osint \
    && /opt/osint/bin/pip install --no-cache-dir -r /opt/osint-requirements.txt \
    && for t in sherlock maigret ghunt xeuledoc linkook; do ln -s /opt/osint/bin/$t /usr/local/bin/$t; done \
    # jwt_tool at the default JWT_TOOL_PATH, with its own venv
    && git init -q /opt/tools/jwt_tool \
    && git -C /opt/tools/jwt_tool fetch -q --depth 1 https://github.com/ticarpi/jwt_tool "${JWT_TOOL_COMMIT}" \
    && git -C /opt/tools/jwt_tool checkout -q FETCH_HEAD \
    && python3 -m venv /opt/tools/jwt_tool/venv \
    && /opt/tools/jwt_tool/venv/bin/pip install --no-cache-dir -r /opt/tools/jwt_tool/requirements.txt \
    # Nuclei binary + templates at the default NUCLEI_TEMPLATE_PATH root
    && cd /tmp \
    && curl -fsSLO "https://github.com/projectdiscovery/nuclei/releases/download/v${NUCLEI_VERSION}/nuclei_${NUCLEI_VERSION}_linux_${TARGETARCH:-amd64}.zip" \
    && arch="${TARGETARCH:-amd64}" && sum=$([ "$arch" = arm64 ] && echo "$NUCLEI_SHA256_ARM64" || echo "$NUCLEI_SHA256_AMD64") \
    && echo "${sum}  nuclei_${NUCLEI_VERSION}_linux_${arch}.zip" | sha256sum -c - \
    && unzip -q "nuclei_${NUCLEI_VERSION}_linux_${TARGETARCH:-amd64}.zip" nuclei -d /usr/local/bin \
    && rm -f /tmp/nuclei_* && cd / \
    && git init -q /opt/nuclei-templates \
    && git -C /opt/nuclei-templates fetch -q --depth 1 https://github.com/projectdiscovery/nuclei-templates "${NUCLEI_TEMPLATES_COMMIT}" \
    && git -C /opt/nuclei-templates checkout -q FETCH_HEAD \
    && rm -rf /opt/nuclei-templates/.git /opt/tools/jwt_tool/.git \
    && apt-get purge -y git curl unzip && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

FROM tools AS full
COPY --from=app /app ./
USER botuser

# Default build target (last stage): the lean image
FROM runtime AS slim
COPY --from=app /app ./
USER botuser
