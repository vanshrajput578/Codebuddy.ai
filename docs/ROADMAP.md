# NEXUS AI Roadmap

A phase is complete only after its acceptance tests pass.

## Phase 0 — Repository foundation
- [x] Establish NEXUS AI identity.
- [x] Document architecture and security boundaries.
- [x] Create browser-openable web workspace prototype.
- [x] Add a Gitleaks secret-scanning workflow.
- [ ] Select repository license.

## Phase 1 — Web foundation
- [ ] Convert prototype into typed React/Next.js app.
- [ ] Add accessible responsive components.
- [x] Implement account sign-in and registration UI.
- [x] Add a server-side Gemini chat API and health endpoint.
- [x] Add origin checks, request limits, Helmet headers and per-IP rate limiting.
- [x] Add automated API security tests.
Acceptance: app builds, navigation works, auth uses a real API, tests pass.

## Phase 2 — Backend and accounts
- [x] Add email/password registration and login endpoints.
- [x] Add scrypt password hashing and hashed opaque sessions.
- [x] Add PostgreSQL schema for users, sessions and conversation records.
- [x] Add PostgreSQL schema script for core account and conversation tables.
- [x] Registration, login, current-session and logout endpoints.
- [x] Require authenticated sessions and CSRF validation for chat.
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
Account registration/login, PostgreSQL-backed sessions, CSRF checks and authenticated server-side Gemini chat are now implemented in the repository. The conversation and message tables exist, but chat history is not yet saved. The backend still needs live PostgreSQL integration tests, per-user AI quotas, account recovery/email verification, provider vault, multiple providers, agent runtime, Android client, isolated sandbox and a production security review. Tests are committed but have not been executed in this environment.
