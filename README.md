# NEXUS AI

**Your Personal Autonomous AI Workspace**

NEXUS AI currently provides a same-origin web client, Node.js/Express API, PostgreSQL-backed accounts and conversations, and server-side AI provider adapters.

## Verified and unverified status

- Implemented in code: registration/login, scrypt password hashing, opaque session cookies, CSRF checks, user-owned conversations, encrypted provider-key storage, provider selection and four provider adapters (Gemini, OpenAI, OpenRouter, Anthropic).
- Automated verification: syntax checks, isolated API security tests, PostgreSQL integration tests and Gitleaks secret scanning run in GitHub Actions.
- Implemented: PostgreSQL-backed task records and event history, provider-assisted planner (maximum eight steps), allowlisted tools, explicit plan approval, pause/resume/reject/cancel controls, persisted tool results, evidence-driven replanning (maximum two rounds), and fresh approval when a continuation introduces a write.
- Agent execution boundary: API requests only transition tasks into the durable running queue. A separate `npm run worker` process claims PostgreSQL tasks with `FOR UPDATE SKIP LOCKED`, a UUID fencing token, a renewable lease and a bounded three-claim crash-recovery limit. The API does not execute agent steps. No shell, browser, arbitrary HTTP, filesystem or device-control tools are exposed.
- Implemented on the Phase 5 branch: native Kotlin/Jetpack Compose Android client for authentication, encrypted session-cookie storage, chat/history, provider settings and agent task creation/plan approval/lifecycle controls. Latest Android CI on branch head `b351da1` passed and uploaded a debug APK artifact (10.4 MiB); no signed release APK or physical-device QA is verified.
- Not implemented: computer-use sandbox, multi-agent delegation and scheduled automations.
- Not certified: production deployment, live third-party provider credentials, billing/quota enforcement or independent security review.

## Local setup

Requirements: Node.js 20+ and PostgreSQL 14+.

1. Create a PostgreSQL database and user.
2. Copy `.env.example` to `.env`; keep this file private and untracked.
3. Set `DATABASE_URL`, `APP_ORIGIN=http://localhost:4000`, and `CREDENTIAL_ENCRYPTION_KEY`. Generate a 32-byte key using `openssl rand -base64 32`.
4. For a new database, apply `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/schema.sql`. For an existing database, apply migrations `003_agent_runtime.sql`, `004_agent_step_limit.sql`, `005_agent_replanning.sql`, `006_agent_worker_leases.sql`, and `007_provider_usage.sql` in order.
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
- `POST /api/chat`: non-streaming compatibility endpoint; calls the selected provider and persists the conversation.
- `POST /api/chat/stream`: authenticated same-origin SSE endpoint; streams deltas and persists completed conversations plus usage/error telemetry.
- `GET /api/providers/usage`: authenticated last-30-day per-provider/model request, outcome, character-count and latency aggregates.

See [Security Policy](SECURITY.md), [Security Implementation](docs/SECURITY-IMPLEMENTATION.md), [Architecture](docs/ARCHITECTURE.md) and [Roadmap](docs/ROADMAP.md).

## License

No open-source license has been selected. Normal copyright applies.

### Provider streaming and usage (Phase 3)

- Apply `db/migrations/007_provider_usage.sql` to existing databases (fresh schema users should also apply this migration after the base schema).
- Chat uses authenticated same-origin Server-Sent Events at `POST /api/chat/stream`; the web client renders deltas as they arrive.
- Gemini, OpenAI, OpenRouter and Anthropic have provider-specific SSE adapters. Transient HTTP 408/429/5xx responses receive one bounded retry before any output is streamed; requests have a 60-second timeout and support client cancellation.
- `GET /api/providers/usage` returns the authenticated user's last-30-day request counts, success/error counts, input/output character counts and average latency. Character counts are estimates, not billable token counts; provider-specific token accounting is not claimed.
- Model capability metadata is exposed with `GET /api/providers` under `supported`. Model availability and limits can change at provider discretion; live third-party credentials are not part of CI.


## Phase 3 verification status

The Phase 3 implementation is in draft PR [#4](https://github.com/vanshrajput578/Codebuddy.ai/pull/4). The latest backend checks (including PostgreSQL integration and provider adapter tests) and secret scan pass on commit `3da4582`. CI uses mocked provider responses. Real streaming with valid credentials for Gemini, OpenAI, OpenRouter and Anthropic remains an explicit acceptance requirement and has not been claimed as verified.
