# Stage 1: Install production dependencies
FROM oven/bun:1-slim AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

# Stage 2: Production runtime
FROM oven/bun:1-slim
WORKDIR /app

# Copy only what's needed
COPY --from=builder /app/node_modules ./node_modules
COPY package.json index.js deploy-commands.js clear-commands.js ./
COPY commands/ ./commands/
COPY utils/ ./utils/
COPY scripts/ ./scripts/
COPY addons/ ./addons/

# Create temp directory
RUN mkdir -p /app/temp

# Run as non-root user
RUN groupadd -r botuser && useradd -r -g botuser botuser
RUN chown -R botuser:botuser /app
USER botuser

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["bun", "run", "scripts/healthcheck.js"]

CMD ["bun", "run", "start"]
