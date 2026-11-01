# NEXUS AI Architecture

## Design approach
Start as a modular monolith with a separately deployable worker. Web and Android clients share one authenticated API.

## Target topology
```
Web (Next.js) ─┐
               ├── API / Auth ── Core application
Android (Expo) ┘                 ├── Model Router
                                 ├── Agent Orchestrator
                                 ├── Memory Service
                                 ├── Tool Registry
                                 ├── Task Scheduler
                                 └── Realtime Events
                                        │
                 PostgreSQL ────────────┤
                 Object Storage ────────┤
                 Isolated Worker/Sandbox┘
```

## Planned packages
- apps/web: responsive browser application.
- apps/mobile: Expo Android application.
- apps/api: authentication, providers, conversations, tasks and realtime API.
- apps/worker: durable background execution.
- packages/ai-core: provider-neutral contracts.
- packages/model-router: adapters, capabilities, retries and usage.
- packages/agent-runtime: planning, approvals and cancellation.
- packages/tool-registry: schemas and permission policies.
- packages/memory: user-controlled memory.
- packages/database: Prisma schema and migrations.
- packages/shared: shared types and validation.

## Agent lifecycle
1. Authenticate and authorize the workspace.
2. Retrieve only the user's authorized context.
3. Ask the selected model for a plan using supported capabilities.
4. Validate each tool call against schema and permission policy.
5. Request approval for external or destructive side effects.
6. Execute tools only in the isolated runtime.
7. Persist step events, outputs and task state.
8. Continue, retry within bounded policy, or report completion.

Task states: queued, planning, awaiting_approval, running, paused, completed, failed, cancelled.

## Provider abstraction
Adapters declare streaming, tool calling, vision, structured output and context capabilities. Never assume provider feature parity. Credentials are encrypted server-side and never returned to clients.

## Sandbox boundary
Browser and terminal execution must not run in the API process. Use isolated containers or a trusted remote sandbox with CPU, memory, time, filesystem and network limits. Never mount host secrets into user task containers.

## Phase 6 browser worker

The browser runtime is a separate Playwright service, not an API route or part of the durable task worker. The initial browser capability is read-only page loading and text extraction; it does not click, submit forms, download files, execute shell commands or retain browser state.

The worker requires:
- A 32-byte-or-longer internal bearer token shared only with the agent worker.
- A dedicated egress proxy that denies loopback, private, link-local, reserved and cloud-metadata destinations after DNS resolution. Direct egress from the browser container must be blocked at the network layer.
- A non-root container with the Chromium sandbox enabled, CPU/memory/PID limits, read-only root filesystem, bounded writable temporary storage and no host or application-secret mounts.

The service rechecks each HTTP(S) request and redirect, permits GET/HEAD only, blocks WebSockets and downloads, uses a fresh browser context per job and applies per-user request quotas. The application DNS check is defense in depth; it does not replace the egress proxy's DNS-rebinding and destination-IP enforcement.

The browser worker is exposed through the allowlisted `browser.open` agent tool. The planner must request an evidence-driven continuation after browsing, and approval is derived from the server-side registry. The durable agent worker calls the browser service outside PostgreSQL row-lock transactions; before persisting the result it reacquires the task row and rechecks status, lease token, expiry, approval and execution cursor. Browser page content is untrusted evidence, never executable instructions.

## Free-tier mode
Support chat-only operation without workers or sandbox infrastructure. Free tiers can sleep, throttle or reject long-running workloads; do not promise permanent 24/7 execution.

## Security
- Server-side authorization on every resource.
- Password hashing using scrypt and opaque server-side sessions.
- HttpOnly, SameSite=Strict cookies with Secure in production.
- CSRF validation on authenticated state-changing endpoints.
- Require authentication before provider calls.
- CSRF protection where cookie sessions are used.
- Rate limits and request validation.
- SSRF protection for URL tools.
- Command and filesystem isolation.
- Secret redaction in logs.
- Audit events for tools and approvals.
- Explicit confirmation for purchases, publishing, messaging and destructive changes.


## Agent runtime safety boundary

The Phase 4 agent runner accepts provider-generated JSON plans with at most five steps. Server validation discards model-supplied approval flags and derives permissions from a fixed tool registry:
- `memory.search`: read-only query restricted to the authenticated user's memory rows.
- `memory.save`: writes only to the authenticated user's memory and is marked approval-required.
- `response.compose`: returns bounded text and has no external side effects.

All plans remain in `awaiting_approval` until the user approves. The runner persists each step result and event in PostgreSQL, checks task status between steps, and supports pause, resume, reject and cancel. On server restart, any task left in `running` is changed to `paused` and requires explicit resume. The only external computer capabilities currently exposed are approval-gated `browser.open` (read-only public page extraction) and `terminal.run` (commands in a disposable no-network container with an explicit bounded scratch-file transfer). Host filesystem access, arbitrary HTTP and device control remain unavailable.

## Phase 6 terminal sandbox

The terminal controller is a separate private service on a dedicated sandbox host/VM. It starts a fresh container for each approved `terminal.run` invocation. The task-scoped workspace persists in PostgreSQL with AES-256-GCM encryption and per-user/task/path associated data; a bounded file snapshot is loaded into the container tmpfs before each command and the returned snapshot is encrypted back into the same task workspace.

The fixed container configuration uses `--network none`, read-only root filesystem, UID/GID 10001, dropped capabilities, no-new-privileges, default seccomp, 256 MiB memory, 0.5 CPU, 64 PIDs, 64 MiB workspace tmpfs, 16 MiB temporary tmpfs and a 15-second command timeout. The controller accepts only a strict command/files schema, applies 10 jobs/minute per user and two concurrent jobs globally, and forcibly removes a named container on controller timeout. It never mounts host paths or passes application/database/provider secrets into the sandbox.

The Docker CLI/daemon used by the controller has host-administrator privilege. Run it on a dedicated sandbox VM or isolated daemon; do not expose that daemon to the API/database host or mount its socket into task containers. The planner derives `terminal.run` approval from the server-side registry and requires evidence-driven continuation. Network and host isolation still require deployment verification.
