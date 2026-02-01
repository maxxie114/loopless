# LoopLess Server Dockerfile
FROM node:20-slim

# Install pnpm
RUN npm install -g pnpm

# Set working directory
WORKDIR /app

# Copy package files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json ./apps/server/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/shared ./packages/shared
COPY apps/server ./apps/server

# Build shared package
RUN pnpm --filter shared build

# Expose the server port
EXPOSE 3001

# Set environment variables
ENV NODE_ENV=production
ENV SERVER_PORT=3001

# Start the server
CMD ["pnpm", "--filter", "server", "start"]
