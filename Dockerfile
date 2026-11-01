# =========================================================================
# EventHub – Digital Event Attendance Management System
# Cloud Application Development (CAD) - Production Dockerfile
# =========================================================================

# Stage 1: Base Runtime Environment
FROM node:20-alpine AS base

# Install curl for container health check
RUN apk add --no-cache curl

# Set cloud environment variables
ENV NODE_ENV=production \
    PORT=5000

WORKDIR /app

# Stage 2: Install dependencies
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Stage 3: Copy Application Source Code
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Create data directory and set permissions for non-root user
RUN mkdir -p /app/backend/data && chown -R node:node /app

# Switch to non-root user for security best practices in Cloud/Kubernetes
USER node

# Expose HTTP port
EXPOSE 5000

# Cloud Container Health Check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:${PORT}/api/health || exit 1

# Start EventHub Server
CMD ["node", "backend/server.js"]
