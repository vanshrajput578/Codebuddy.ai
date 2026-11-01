# Security implementation notes

## Implemented in the repository

- Node.js/Express API with same-origin static frontend.
- PostgreSQL schema for users, sessions, conversations, messages and provider credentials.
- Email/password registration and login; passwords are hashed using scrypt.
- Random opaque session cookies; only token hashes are stored in PostgreSQL.
- HttpOnly and SameSite=Strict cookies; Secure and `__Host-` prefix in production.
- CSRF token validation and exact-origin checks for state-changing routes.
- Helmet/CSP, request limits and IP rate limits.
- Per-user provider credential encryption using AES-256-GCM, with user/provider binding through authenticated additional data.
- Server-side adapters for Gemini, OpenAI, OpenRouter and Anthropic.
- Provider metadata APIs do not return original credentials.
- Provider calls have a 45-second timeout.
- Security and PostgreSQL integration tests run in GitHub Actions.

## Local setup

1. Install Node.js 20+ and PostgreSQL 14+.
2. Create a database and database user.
3. Copy `.env.example` to `.env`.
4. Set `DATABASE_URL`, `APP_ORIGIN=http://localhost:4000`, and `CREDENTIAL_ENCRYPTION_KEY` (generate with `openssl rand -base64 32`).
5. Apply schema: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/schema.sql`.
6. Run `npm install`, then `npm run check && npm test`.
7. Run `npm run dev` and open `http://localhost:4000`.

## Phase 6 isolated browser worker

The first computer-tools increment adds a dedicated Playwright worker in `computer/`:
- Internal `POST /execute` requires a constant-time compared bearer token (32+ bytes); `GET /health` reports only idle/busy state.
- The request accepts only a UUID user ID and an HTTP(S) URL. Credentials in URLs, non-standard ports, local names and private/reserved IP literals are rejected.
- Hostnames are resolved and all returned addresses are checked; every browser HTTP request and redirect is checked again.
- Chromium is launched with a required egress proxy. The proxy and container network must block direct egress and deny private, loopback, link-local, reserved and cloud-metadata IP ranges after DNS resolution. The application DNS check alone cannot prevent DNS rebinding at the final network connection.
- Only GET/HEAD requests are allowed. WebSockets and downloads are blocked; service workers are disabled; contexts are ephemeral and closed after each task.
- Navigation is capped at 12 seconds, 40 browser requests and 12,000 characters of extracted text. Each user is limited to six jobs per minute, and the worker runs one job at a time.
- `computer/Dockerfile` runs as an unprivileged user. Deploy with a read-only root filesystem, bounded tmpfs, memory/CPU/PID limits, no-new-privileges, no host mounts and no application/provider secrets in the container.

Build with `docker build -f computer/Dockerfile -t nexus-browser-worker .`. Start it only on a private container network and set `BROWSER_WORKER_TOKEN` and `BROWSER_EGRESS_PROXY`. Do not publish port 4002 to the public internet. The allowlisted `browser.open` tool is approval-required. The plan validator requires `replanAfter=true` so extracted page evidence is passed to a continuation planner that treats all tool output as untrusted data. The durable task runner releases its PostgreSQL transaction before contacting the browser service, then reacquires the task row and verifies the lease token, lease expiry, approval state, task status and cursor before persisting the result.

## Remaining production requirements

Email verification, password reset, account deletion, per-user AI quotas, managed KMS/envelope encryption, key rotation, database backups/restore tests, monitoring and independent security review are not complete. Browser/terminal code is present, but a production egress proxy, dedicated Docker sandbox daemon/VM and independent network-isolation review have not been verified.

The credential vault uses one server master key. Back it up securely; losing it makes saved credentials unrecoverable. Rotate it only with a deliberate re-encryption migration.

## API contract

- `GET /api/health`: database availability only.
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`.
- `GET /api/conversations`: lists only the signed-in user's conversations.
- `GET /api/conversations/:id/messages`: returns messages only when the conversation belongs to the signed-in user.
- `DELETE /api/conversations/:id`: deletes only an owned conversation and requires CSRF.
- `GET /api/providers`: returns provider names, model IDs and masked configured status.
- `PUT /api/providers/:provider`: encrypts a submitted key before storage.
- `DELETE /api/providers/:provider`: deletes that user's provider key.
- `PUT /api/provider-selection`: selects an already-configured provider.
- `POST /api/providers/:provider/test`: tests a saved key without returning it.
- `POST /api/chat`: calls the selected provider and persists user/assistant messages.


## Phase 4 agent runtime

- Provider-generated plans are parsed as strict JSON and limited to five steps.
- Server-side tool allowlist contains only `memory.search`, `memory.save` and `response.compose`; unknown tools are rejected.
- Tool inputs are revalidated server-side; model-supplied approval flags are ignored.
- All plans require explicit user approval. The memory-write tool is visibly marked approval-required.
- The executor persists each completed step and event in PostgreSQL and checks task state between steps.
- Pause, resume, reject and cancel endpoints are authenticated, CSRF-protected and user-scoped.
- Resume requires an existing approval timestamp; execution refuses tasks without one.
- Tasks left running during a server restart are transactionally moved to paused and require explicit resume.
- The only external computer capabilities currently exposed are approval-gated `browser.open` and `terminal.run`; terminal commands execute in a disposable no-network container with a bounded scratch workspace. Host filesystem access, arbitrary HTTP and device control remain unavailable.

## Phase 6 terminal sandbox

The dedicated terminal controller runs on a sandbox VM/host and needs access to a Docker daemon. Docker daemon access is effectively host-admin privilege. Do not run the controller with access to the main API/database host's Docker socket; use a dedicated daemon/VM and keep its control endpoint private.

The controller starts one disposable container per job with:
- `--network none`, no port publishing and no host mounts.
- Read-only root filesystem, unprivileged UID/GID 10001, all capabilities dropped and no-new-privileges.
- 256 MiB memory, 0.5 CPU, 64 PIDs, 64 MiB workspace tmpfs and 16 MiB temporary tmpfs.
- A hard command timeout of 15 seconds; process-group cleanup; a named Docker container removed on controller timeout.
- 10 jobs/minute per user, two global concurrent jobs, up to 30 input files, 256 KiB per file and 1 MiB total workspace transfer.
- No database or provider credentials, host directory mounts, or network connectivity inside the sandbox.

Each container invocation is disposable, but task files persist between commands as AES-256-GCM encrypted PostgreSQL records bound by associated data to the authenticated user, task and path. The API exposes only owner-scoped file metadata/download routes. This workspace is not a backup and must follow the repository's database retention/deletion policy. The terminal controller uses a private bearer token; the planner marks every `terminal.run` action approval-required and validates `replanAfter=true`. The server performs the network call outside the PostgreSQL task transaction and verifies the task lease/state before persisting its result.

CI can test request validation, path traversal policy and controller contracts. It cannot prove the deployed Docker daemon, kernel, firewall, storage quotas or host isolation are correctly configured; those require deployment-time security verification.
