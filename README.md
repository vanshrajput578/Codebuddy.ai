# NEXUS AI

**Your Personal Autonomous AI Workspace**

NEXUS AI currently provides a same-origin web client, Node.js/Express API, PostgreSQL-backed accounts and conversations, and server-side AI provider adapters.

## Verified and unverified status

- Implemented in code: registration/login, scrypt password hashing, opaque session cookies, CSRF checks, user-owned conversations, encrypted provider-key storage, provider selection and four provider adapters (Gemini, OpenAI, OpenRouter, Anthropic).
- Automated verification: syntax checks, isolated API security tests, PostgreSQL integration tests and Gitleaks secret scanning run in GitHub Actions.
- Implemented: durable task queue, provider-assisted bounded planner, allowlisted memory/search/response tools, explicit approval gate, background execution, task history UI, pause/resume/reject/cancel controls and user-scoped memory CRUD.
- Agent limitation: no shell, browser, arbitrary HTTP, filesystem or device-control tools; no advanced model replanning or distributed worker service.
- Not implemented: Android client, computer-use sandbox, multi-agent delegation and scheduled automations.
- Not certified: production deployment, live third-party provider credentials, billing/quota enforcement or independent security review.

## Local setup

Requirements: Node.js 20+ and PostgreSQL 14+.

1. Create a PostgreSQL database and user.
2. Copy `.env.example` to `.env`; keep this file private and untracked.
3. Set `DATABASE_URL`, `APP_ORIGIN=http://localhost:4000`, and `CREDENTIAL_ENCRYPTION_KEY`. Generate a 32-byte key using `openssl rand -base64 32`.
4. For a new database, apply `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/schema.sql`. For an existing database with the earlier task queue schema, apply `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/003_agent_runtime.sql`.
5. Install dependencies: `npm install`.
6. Run checks: `npm run check && npm test`.
7. Start the app: `npm run dev`.
8. Open `http://localhost:4000`, register, then open **AI Providers** to add a provider key.

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

- `GET /api/health`: database availability.
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`.
- `GET /api/conversations`, `GET /api/conversations/:id/messages`, `DELETE /api/conversations/:id`.
- `GET /api/providers`, `PUT /api/providers/:provider`, `DELETE /api/providers/:provider`.
- `PUT /api/provider-selection`.
- `POST /api/providers/:provider/test`.
- `GET/POST /api/memory`, `PUT/DELETE /api/memory/:id`: user-scoped persistent memory CRUD.
- `GET/POST /api/agent/tasks`, `GET /api/agent/tasks/:id`: user-scoped task queue and event history.
- `POST /api/agent/tasks/:id/plan`: generate and validate a plan of at most five allowlisted steps.
- `POST /api/agent/tasks/:id/approve`, `/reject`, `/pause`, `/resume`, `/cancel`: explicit task lifecycle controls. Execution starts only after approval.
- `POST /api/chat`: calls the selected provider and persists the conversation.

See [Security Policy](SECURITY.md), [Security Implementation](docs/SECURITY-IMPLEMENTATION.md), [Architecture](docs/ARCHITECTURE.md) and [Roadmap](docs/ROADMAP.md).

## License

No open-source license has been selected. Normal copyright applies.
