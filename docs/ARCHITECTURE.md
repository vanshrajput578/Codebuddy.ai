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

## Free-tier mode
Support chat-only operation without workers or sandbox infrastructure. Free tiers can sleep, throttle or reject long-running workloads; do not promise permanent 24/7 execution.

## Security
- Server-side authorization on every resource.
- Password hashing using scrypt and opaque server-side sessions.\n- HttpOnly, SameSite=Strict cookies with Secure in production.\n- CSRF validation on authenticated state-changing endpoints.\n- Require authentication before provider calls.
- CSRF protection where cookie sessions are used.
- Rate limits and request validation.
- SSRF protection for URL tools.
- Command and filesystem isolation.
- Secret redaction in logs.
- Audit events for tools and approvals.
- Explicit confirmation for purchases, publishing, messaging and destructive changes.
