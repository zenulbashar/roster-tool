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

# Same command as `npm run worker` locally — behavior is unchanged.
CMD ["npm", "run", "worker"]
