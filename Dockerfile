FROM node:18-slim

# Create app directory
WORKDIR /app

# Install only production dependencies
COPY package.json ./
RUN npm install --omit=dev

# Copy application code
COPY . .

# Create temp directory
RUN mkdir -p /app/temp

# Run as non-root user
RUN groupadd -r botuser && useradd -r -g botuser botuser
RUN chown -R botuser:botuser /app
USER botuser

# Health check using node
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD node -e "console.log('ok')" || exit 1

CMD ["node", "index.js"]
