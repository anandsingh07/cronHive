# ---- Build stage ----
# Full toolchain here; none of it ships to the runtime image.
FROM node:22-slim AS build
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json .
COPY src ./src
RUN npm run build

# Drop dev dependencies for the runtime copy.
RUN npm prune --omit=dev

# ---- Runtime stage ----
# Slim image, production deps only, runs as the non-root `node` user.
FROM node:22-slim AS runtime
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package*.json ./

USER node

EXPOSE 4000
# Default entrypoint is the API; compose overrides `command` for scheduler/worker.
CMD ["node", "dist/server.js"]
