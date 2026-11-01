# NEXUS AI

**Your Personal Autonomous AI Workspace**

NEXUS AI currently provides a same-origin web client, Node.js/Express API, PostgreSQL-backed accounts and conversations, and server-side AI provider adapters.

## Verified and unverified status

- Implemented in code: registration/login, scrypt password hashing, opaque session cookies, CSRF checks, user-owned conversations, encrypted provider-key storage, provider selection and four provider adapters (Gemini, OpenAI, OpenRouter, Anthropic).
- Automated verification: syntax checks, isolated API security tests, PostgreSQL integration tests and Gitleaks secret scanning run in GitHub Actions.
- Implemented: PostgreSQL-backed task records and event history, provider-assisted planner (maximum eight steps), allowlisted tools, explicit plan approval, pause/resume/reject/cancel controls, persisted tool results, evidence-driven replanning (maximum two rounds), and fresh approval when a continuation introduces a write.
- Agent execution boundary: API requests only transition tasks into the durable running queue. A separate `npm run worker` process claims PostgreSQL tasks with `FOR UPDATE SKIP LOCKED`, a UUID fencing token, a renewable lease and a bounded three-claim crash-recovery limit. The API does not execute agent steps. External computer capabilities are limited to approval-gated `browser.open` (read-only public pages) and `terminal.run` (commands inside a disposable, no-network container with a bounded scratch workspace). No host filesystem access, arbitrary HTTP access or device control is exposed.
- Implemented on the Phase 5 branch: native Kotlin/Jetpack Compose Android client for authentication, encrypted session-cookie storage, chat/history, provider settings and agent task creation/plan approval/lifecycle controls. Latest Android CI on branch head `b351da1` passed and uploaded a debug APK artifact (10.4 MiB); no signed release APK or physical-device QA is verified.
- Not complete: production deployment and network-policy verification for computer tools, persistent workspaces, multi-agent delegation and scheduled automations.
- Not certified: production deployment, live third-party provider credentials, billing/quota enforcement or independent security review.

## Local setup

Requirements: Node.js 20+ and PostgreSQL 14+.

1. Create a PostgreSQL database and user.
2. Copy `.env.example` to `.env`; keep this file private and untracked.
3. Set `DATABASE_URL`, `APP_ORIGIN=http://localhost:4000`, and `CREDENTIAL_ENCRYPTION_KEY`. Generate a 32-byte key using `openssl rand -base64 32`.
4. For a new database, apply `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/schema.sql`. For an existing database, apply migrations `003_agent_runtime.sql`, `004_agent_step_limit.sql`, `005_agent_replanning.sql`, `006_agent_worker_leases.sql`, and `008_agent_task_files.sql` in order.
5. Install dependencies: `npm install`.
6. Run checks: `npm run check && npm test`.
7. Start the API: `npm run dev`.
8. In a separate process/container using the same `DATABASE_URL`, start the agent worker: `npm run worker`. The worker exposes `GET http://127.0.0.1:4001/health` by default; configure `WORKER_HEALTH_HOST` and `WORKER_HEALTH_PORT` only when your deployment health checker needs a different bind address/port. Keep the health port private behind a firewall or private network.
9. Run the API and worker under a process supervisor (systemd, Docker restart policy, or an equivalent host supervisor). The worker handles `SIGINT`/`SIGTERM`, stops claiming new work and drains its active task before exiting. A hard kill is recovered by lease expiry and a later worker claim.
10. Open `http://localhost:4000`, register, then open **AI Providers** to add a provider key.

The Express server serves the frontend and API on the same origin. Do not host the frontend separately unless a secure same-origin reverse proxy is deliberately configured.

## Provider credential security

Provider API keys are submitted over authenticated same-origin routes and encrypted at rest with AES-256-GCM. The 32-byte `CREDENTIAL_ENCRYPTION_KEY` is server-only. The original key is never returned by the API. Back up the master key securely: losing it makes existing saved credentials undecryptable. A key rotation requires a deliberate re-encryption migration.

Supported adapter IDs: `gemini`, `openai`, `openrouter`, `anthropic`. Users can supply model IDs in the settings screen. Arbitrary custom API base URLs are intentionally not supported.

## Security model

- Passwords are hashed using Node.js scrypt.
- Session tokens are random and only their SHA-256 hashes are stored in PostgreSQL.
- Cookies are HttpOnly and SameSite=Strict; production uses Secure and the `__Host-` prefix.
- Authenticated state-changing routes require CSRF tokens and exact-origin checks.
- Helmet security headers, a restrictive CSP, request-size limits and per-IP rate limits are enabled.
- Provider credentials are encrypted at rest and never returned to the browser.
- Browser and terminal tools must run in a separate isolated worker; they must never execute in the API process.

## Production requirements

This repository is not yet production-ready for public multi-user traffic. Before launch, add email verification and account recovery, per-user quotas and abuse controls, managed KMS/envelope encryption, database migrations/backups, observability, dependency/SAST scanning, isolated workers and an independent security review. Configure `NODE_ENV=production`, exact HTTPS `APP_ORIGIN`, database TLS as required, and secrets through the hosting platform.

## Isolated browser worker (Phase 6)

The browser worker is a separate containerized Playwright service. It is read-only: page navigation and text extraction only. It does not click buttons, submit forms, download files, run shell commands or retain cookies between jobs.

1. Generate a worker token with `openssl rand -hex 32`.
2. Configure `BROWSER_WORKER_TOKEN`, `BROWSER_EGRESS_PROXY` and `BROWSER_WORKER_URL` for the agent worker. The proxy must enforce destination-IP ACLs after DNS resolution and block loopback, private, link-local, reserved and cloud metadata ranges. The worker intentionally refuses to start without a proxy.
3. Build the image: `docker build -f computer/Dockerfile -t nexus-browser-worker .`.
4. Run it on a private Docker network only, with a read-only root filesystem, bounded tmpfs, memory/CPU/PID limits, no-new-privileges and no host mounts. Do not expose port 4002 publicly and do not pass database or provider secrets to this container.
5. Keep direct container egress blocked at the network layer; allow access only to the dedicated egress proxy. The proxy must protect against DNS rebinding by checking the resolved destination IP at connection time.

The internal service accepts `POST /execute` with a bearer token and `{userId,url}`; it permits HTTP(S), GET/HEAD only, blocks WebSockets/downloads, caps navigation at 12 seconds and 40 requests, extracts at most 12,000 characters, and allows six jobs per user per minute. It creates and closes a new browser context for every job. `GET /health` reports only idle/busy state.

```bash
docker run -d --name nexus-browser-worker \
  --network nexus-internal --init --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=256m --shm-size=512m \
  --memory=1g --cpus=1 --pids-limit=128 --cap-drop=ALL \
  --security-opt=no-new-privileges \
  -e BROWSER_WORKER_TOKEN="$BROWSER_WORKER_TOKEN" \
  -e BROWSER_EGRESS_PROXY="http://egress-proxy:3128" \
  nexus-browser-worker
```

The example assumes `nexus-internal` and an egress proxy already exist. Enforce an egress firewall so the browser container can connect only to that proxy; the proxy must deny unsafe destination IPs after DNS resolution. Do not use an unrestricted forward proxy. Set `BROWSER_WORKER_URL=http://nexus-browser-worker:4002` in the durable agent worker environment on the same private network.

The agent tool registry now exposes `browser.open`. The planner must mark it for evidence-driven replanning, and the server derives its approval requirement from the registry. The worker calls the browser service outside PostgreSQL transactions, then reacquires the task row and verifies the lease, status and cursor before saving page evidence. The Agent Tasks screen shows the approval-required step in the normal plan review flow. Configure `BROWSER_WORKER_URL` on the durable agent worker to reach the private browser service.

## Current API

- `GET /api/health`: API/database availability.
- Worker health: `GET /health` on the separate worker health listener (default `127.0.0.1:4001`), including worker state, active task, claim/heartbeat counters and last error.
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`.
- `GET /api/conversations`, `GET /api/conversations/:id/messages`, `DELETE /api/conversations/:id`.
- `GET /api/providers`, `PUT /api/providers/:provider`, `DELETE /api/providers/:provider`.
- `PUT /api/provider-selection`.
- `POST /api/providers/:provider/test`.
- `GET/POST /api/memory`, `PUT/DELETE /api/memory/:id`: user-scoped persistent memory CRUD.
- `GET/POST /api/agent/tasks`, `GET /api/agent/tasks/:id`: user-scoped task queue and event history.
- `POST /api/agent/tasks/:id/plan`: generate and validate a plan of at most eight allowlisted steps; evidence-driven continuation is capped at two replanning rounds and eight total steps.
- `POST /api/agent/tasks/:id/approve`, `/reject`, `/pause`, `/resume`, `/cancel`: explicit task lifecycle controls. Execution starts only after approval.
- `POST /api/chat`: calls the selected provider and persists the conversation.

See [Security Policy](SECURITY.md), [Security Implementation](docs/SECURITY-IMPLEMENTATION.md), [Architecture](docs/ARCHITECTURE.md) and [Roadmap](docs/ROADMAP.md).

## License

No open-source license has been selected. Normal copyright applies.

## Isolated terminal and file workspace (Phase 6)

The terminal controller is a separate private service. It launches one disposable sandbox container per command. The task's workspace is persistent and private in PostgreSQL; file contents are AES-256-GCM encrypted with per-user/task/path associated data. Each command receives the bounded current file snapshot in a tmpfs workspace, then the controller returns changed files which are encrypted back into the same task workspace.

1. Build the sandbox image: `docker build -f computer/terminal-sandbox.Dockerfile -t nexus-terminal-sandbox:latest .`.
2. Generate an internal token: `openssl rand -hex 32`. Configure `TERMINAL_WORKER_TOKEN`, `TERMINAL_WORKER_HOST` and `TERMINAL_WORKER_PORT` on the controller host.
3. Start `npm run terminal-worker` on a dedicated sandbox VM/host with Docker CLI and access to its isolated Docker daemon.
4. Configure `TERMINAL_WORKER_URL` and the same `TERMINAL_WORKER_TOKEN` in the durable agent worker environment, over a private authenticated network.
5. Keep the Docker daemon/CLI privilege on the dedicated sandbox host only. Access to a Docker daemon is effectively host-administrator access; do not grant the main API/DB host access to the sandbox daemon, and never mount the Docker socket into a task container.

Each terminal job runs as UID 10001 with `--network none`, a read-only root filesystem, all Linux capabilities dropped, no-new-privileges, 256 MiB memory, 0.5 CPU, 64 PIDs, a 64 MiB tmpfs workspace, a 16 MiB temporary directory and a maximum 15-second command timeout. Commands receive no application, database or provider secrets and no host path mounts. The controller limits each user to 10 jobs per minute and allows at most two concurrent sandbox jobs. Each request can carry at most 30 files, 256 KiB per file and 1 MiB total; stdout and stderr are each capped at 32 KiB.

`terminal.run` is approval-required and its plan must request evidence-driven replanning. The server calls the controller outside the PostgreSQL task transaction and revalidates task ownership state/lease before persisting results. A successful CI test of the controller contract does not replace building the Docker image and verifying the dedicated daemon/network isolation in deployment.
