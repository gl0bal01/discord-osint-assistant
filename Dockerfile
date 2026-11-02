# Two images from one file:
#   slim (default) — Bun + npm deps only; CLI-backed commands are hidden
#   full           — adds Sherlock, Maigret, GHunt, xeuledoc, Linkook, jwt_tool,
#                    Nuclei (+ templates) and ExifTool
# Pick one with BOT_TARGET=slim|full (docker-compose.yml) or `docker build --target full`.

# Stage 1: Install production dependencies
FROM oven/bun:1-slim AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

# Stage 2: App runtime shared by both images
FROM oven/bun:1-slim AS base
WORKDIR /app

# Non-root user (uid 999, matches the compose tmpfs mounts). Code stays root-owned
# (read-only to the bot); only the runtime dirs and $HOME are writable.
RUN groupadd -r botuser && useradd -r -m -g botuser botuser \
    && mkdir -p /app/temp /app/reports \
    && chown botuser:botuser /app/temp /app/reports

COPY --from=builder /app/node_modules ./node_modules
COPY package.json index.js deploy-commands.js clear-commands.js ./
COPY commands/ ./commands/
COPY utils/ ./utils/
COPY scripts/ ./scripts/
COPY addons/ ./addons/

USER botuser

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["bun", "run", "scripts/healthcheck.js"]

CMD ["bun", "run", "start"]

# Full image: every external OSINT tool the CLI-backed commands need
FROM base AS full
USER root
ARG NUCLEI_VERSION=3.11.1
ARG TARGETARCH
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 python3-venv libimage-exiftool-perl ca-certificates git curl unzip \
    # Python tools in one venv, exposed on PATH
    && python3 -m venv /opt/osint \
    && /opt/osint/bin/pip install --no-cache-dir sherlock-project maigret ghunt xeuledoc linkook \
    && for t in sherlock maigret ghunt xeuledoc linkook; do ln -s /opt/osint/bin/$t /usr/local/bin/$t; done \
    # jwt_tool at the default JWT_TOOL_PATH, with its own venv
    && git clone --depth 1 https://github.com/ticarpi/jwt_tool /opt/tools/jwt_tool \
    && python3 -m venv /opt/tools/jwt_tool/venv \
    && /opt/tools/jwt_tool/venv/bin/pip install --no-cache-dir -r /opt/tools/jwt_tool/requirements.txt \
    # Nuclei binary + templates at the default NUCLEI_TEMPLATE_PATH root
    && cd /tmp \
    && curl -fsSLO "https://github.com/projectdiscovery/nuclei/releases/download/v${NUCLEI_VERSION}/nuclei_${NUCLEI_VERSION}_linux_${TARGETARCH:-amd64}.zip" \
    && curl -fsSLO "https://github.com/projectdiscovery/nuclei/releases/download/v${NUCLEI_VERSION}/nuclei_${NUCLEI_VERSION}_checksums.txt" \
    && sha256sum -c --ignore-missing "nuclei_${NUCLEI_VERSION}_checksums.txt" \
    && unzip -q "nuclei_${NUCLEI_VERSION}_linux_${TARGETARCH:-amd64}.zip" nuclei -d /usr/local/bin \
    && rm -f /tmp/nuclei_* && cd / \
    && git clone --depth 1 https://github.com/projectdiscovery/nuclei-templates /opt/nuclei-templates \
    && rm -rf /opt/nuclei-templates/.git /opt/tools/jwt_tool/.git \
    && apt-get purge -y git curl unzip && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
USER botuser

# Default build target (last stage): the lean image
FROM base AS slim
