# Worker-only image for Railway. Runs scripts/worker.ts (pg-boss consumer) as a
# long-running process. This image does NOT run the Next.js web app.
FROM node:22-slim

WORKDIR /app

# Install dependencies first for better layer caching. devDependencies are
# included because the worker runs via tsx (a devDependency).
COPY package.json package-lock.json ./
RUN npm ci

# App source (worker entrypoint + the libs it imports).
COPY . .

# Run in production mode (JSON logs; skips the dev-only pretty logger).
ENV NODE_ENV=production
# Sizes the DB pool + statement timeout for a long-lived job process
# (src/lib/db/index.ts). The `worker` npm script sets it too; this covers
# anyone running the entrypoint directly.
ENV ROSTER_ROLE=worker

# Never run the worker as root (SEC-14). The image only reads /app; the
# heartbeat file lives in /tmp, which `node` can write.
RUN chown -R node:node /app
USER node

# Liveness (OPS-01): the worker touches a heartbeat file every minute; a stale
# file means the process is wedged or dead and the platform should restart it.
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "scripts/worker-healthcheck.mjs"]

# Same command as `npm run worker` locally — behavior is unchanged.
CMD ["npm", "run", "worker"]
