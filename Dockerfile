# Pin to specific version for reproducible builds
# Update periodically: docker pull node:18.20-slim
FROM node:18.20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Stage 2: Production runtime
FROM node:18.20-slim
RUN apt-get update && apt-get install -y --no-install-recommends procps && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Copy only what's needed
COPY --from=builder /app/node_modules ./node_modules
COPY package.json index.js deploy-commands.js clear-commands.js ./
COPY commands/ ./commands/
COPY utils/ ./utils/
COPY addons/ ./addons/

# Create temp directory
RUN mkdir -p /app/temp

# Run as non-root user
RUN groupadd -r botuser && useradd -r -g botuser botuser
RUN chown -R botuser:botuser /app
USER botuser

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD pgrep -f "node index.js" > /dev/null || exit 1

CMD ["node", "index.js"]
