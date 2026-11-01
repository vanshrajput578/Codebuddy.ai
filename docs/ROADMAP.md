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
- [x] Add PostgreSQL schema and setup script for users, sessions and conversation records.
- [x] Registration, login, current-session and logout endpoints.
- [x] Require authenticated sessions and CSRF validation for chat.
- [x] User-scoped conversation and message persistence.
- [x] Recent conversation history and bounded context for Gemini chat.
Acceptance: users can register and only access their own data.

## Phase 3 — AI providers and chat
- [x] Add a server-side provider adapter contract for Gemini, OpenAI, OpenRouter and Anthropic.
- [x] Implement Gemini, OpenRouter, OpenAI and Anthropic API adapters.
- [x] Add per-user AES-256-GCM encrypted provider credential storage.
- [ ] Model capability registry.
- [ ] Streaming chat and usage/error reporting.
- [x] Add authenticated provider connection test endpoint.
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
Account registration/login, PostgreSQL-backed sessions, CSRF checks and authenticated server-side Gemini chat are now implemented in the repository. Conversations and messages are saved per user; the UI can reopen recent conversations and Gemini receives the latest 12 messages as context. The backend now includes an encrypted per-user provider vault and server-side Gemini, OpenAI, OpenRouter and Anthropic adapters. Remaining work includes live PostgreSQL integration tests, per-user AI quotas, account recovery/email verification, agent runtime, Android client, isolated sandbox and a production security review. Security regression tests and JavaScript syntax checks run in GitHub Actions; the latest workflow result is pending.
