FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    HOME=/tmp \
    TMPDIR=/tmp

RUN apt-get update \
    && apt-get install -y --no-install-recommends bash coreutils findutils grep sed gawk \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 nexus-sandbox \
    && useradd --system --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin nexus-sandbox

WORKDIR /app
COPY --chown=root:root computer/terminal-sandbox-runner.mjs ./computer/terminal-sandbox-runner.mjs
RUN chmod 0555 /app/computer/terminal-sandbox-runner.mjs
USER 10001:10001
ENTRYPOINT ["node", "/app/computer/terminal-sandbox-runner.mjs"]
