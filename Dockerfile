FROM node:18-slim

# Create app directory
WORKDIR /app

# Install only production dependencies (reproducible via lockfile)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy application code
COPY . .

# Create temp directory
RUN mkdir -p /app/temp

# Run as non-root user
RUN groupadd -r botuser && useradd -r -g botuser botuser
RUN chown -R botuser:botuser /app
USER botuser

# Health check: verify the main node process is running
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD pgrep -f "node index.js" > /dev/null || exit 1

CMD ["node", "index.js"]
