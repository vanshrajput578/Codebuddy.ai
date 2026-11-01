FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    BROWSER_WORKER_HOST=0.0.0.0 \
    BROWSER_WORKER_PORT=4002

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund \
    && npx playwright install --with-deps chromium \
    && groupadd --system nexus \
    && useradd --system --gid nexus --create-home nexus \
    && mkdir -p /tmp/nexus-browser \
    && chown nexus:nexus /tmp/nexus-browser

COPY --chown=nexus:nexus . .
USER nexus
EXPOSE 4002
CMD ["node", "computer/browser-worker.mjs"]
