# NEXUS AI Roadmap

A phase is complete only after its acceptance tests pass.

## Phase 0 — Repository foundation
- [x] Establish NEXUS AI identity.
- [x] Document architecture and security boundaries.
- [x] Create browser-openable web workspace prototype.
- [x] Add a Gitleaks secret-scanning workflow.\n- [ ] Add automated tests and build checks.
- [ ] Select repository license.

## Phase 1 — Web foundation
- [ ] Convert prototype into typed React/Next.js app.
- [ ] Add accessible responsive components.
- [ ] Implement authentication screens and API contracts.
- [x] Add a server-side Gemini chat API and health endpoint.\n- [x] Add origin checks, request limits, Helmet headers and per-IP rate limiting.\n- [ ] Add automated API security tests.
Acceptance: app builds, navigation works, auth uses a real API, tests pass.

## Phase 2 — Backend and accounts
- [ ] Fastify API and PostgreSQL.
- [ ] Prisma schema and migrations.
- [ ] Registration, login, refresh and logout.
- [ ] Workspace ownership and authorization tests.
- [ ] Conversation persistence.
Acceptance: users can register and only access their own data.

## Phase 3 — AI providers and chat
- [ ] Provider adapter contract (current Gemini-only endpoint is a first integration).
- [ ] Gemini and OpenRouter adapters first.
- [ ] Server-side encrypted credential storage.
- [ ] Model capability registry.
- [ ] Streaming chat and usage/error reporting.
- [ ] Provider connection test.
Acceptance: configured provider returns a real streamed response.

## Phase 4 — Agent runtime and memory
- [ ] Durable tasks and execution events.
- [ ] Planning and bounded execution loop.
- [ ] Tool schema validation and permission checks.
- [ ] Approval, pause, resume and cancellation.
- [ ] User-controlled persistent memory.
Acceptance: tasks survive restart and restricted tools require approval.

## Phase 5 — Android
- [ ] Expo app and shared API client.
- [ ] Secure authentication storage.
- [ ] Chat, task monitoring and notifications.
- [ ] File upload and voice capabilities.
- [ ] Android build and device tests.
Acceptance: Android and web share account and conversation history.

## Phase 6 — Computer tools
- [ ] Isolated browser worker.
- [ ] Isolated terminal and file workspace.
- [ ] Sandbox quotas and cleanup.
- [ ] SSRF, path traversal and command security tests.
Acceptance: tools execute in isolation with enforced limits.

## Phase 7 — Multi-agent and automations
- [ ] Specialized agent definitions.
- [ ] Delegation with scoped permissions.
- [ ] Scheduled workflows.
- [ ] Notifications and audit history.
Acceptance: delegated jobs are traceable and preserve permissions.

## Phase 8 — Production hardening
- [ ] Backups and restore tests.
- [ ] Monitoring and alerting.
- [ ] Rate limits and abuse controls.
- [ ] Security review.
- [ ] Deployment runbooks.

## Current truth
The web UI now calls a server-side Gemini chat API. The backend is a single-provider prototype with origin checks and IP rate limiting; it has no user authentication, database, persistent conversations, agent runtime, Android client or sandbox. It is not production-ready for public multi-user deployment. No build or runtime tests have been executed yet.
