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
- [x] Add a server-side provider-routed chat API and health endpoint.
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
- [x] Recent conversation history and bounded context for selected-provider chat.
Acceptance: users can register and only access their own data.

## Phase 3 — AI providers and chat
- [x] Add a server-side provider adapter contract for Gemini, OpenAI, OpenRouter and Anthropic.
- [x] Implement Gemini, OpenRouter, OpenAI and Anthropic API adapters.
- [x] Add per-user AES-256-GCM encrypted provider credential storage.
- [x] Add provider settings UI, per-user provider selection and credential deletion.
- [x] Add provider request timeouts and PostgreSQL-backed integration coverage.
- [ ] Model capability registry.
- [ ] Streaming chat and usage/error reporting.
- [x] Add authenticated provider connection test endpoint.
Acceptance: configured provider returns a real streamed response. Current: credential storage, selection and adapters are implemented; actual live provider calls and streaming remain unverified/not implemented.

## Phase 4 — Agent runtime and memory
- [x] Add PostgreSQL-backed durable task records, execution cursor and event history.
- [x] Provider-assisted planning with strict JSON validation and a five-step execution bound.
- [x] Allowlisted memory search/save and response composition tools with server-side input validation.
- [x] Explicit plan approval/rejection, pause/resume/cancel transitions and restart recovery.
- [x] Add user-scoped persistent memory CRUD API.
Acceptance: tasks survive restart and restricted tools require approval. Current: bounded planner/executor, tool allowlist, memory-write approval gate, task UI, lifecycle controls and restart-to-paused recovery are implemented; external tools and advanced replanning remain out of scope.

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

## Phase verification audit (2026-11-01)

| Phase | Implementation status | Verification result |
|---|---|---|
| 0 — Repository foundation | Mostly implemented; license selection remains open. | Repository tree, documentation and CI workflows inspected; secret scan passes. |
| 1 — Web foundation | Partial. Same-origin responsive HTML/CSS/JS UI and API are present; React/Next.js conversion and accessibility audit are not done. | Node syntax and static frontend/security tests pass. No browser/device visual QA was run. |
| 2 — Backend and accounts | Core account/session/conversation APIs implemented. Email verification, password recovery, quotas and account deletion remain absent. | PostgreSQL CI integration covers registration/login, CSRF, provider ownership, conversation ownership, logout and persistence. |
| 3 — AI providers and chat | Provider vault, selection and Gemini/OpenAI/OpenRouter/Anthropic adapters implemented. Model registry, streaming, usage reporting and provider retries remain incomplete. | CI uses a mocked OpenAI endpoint to verify key decryption, tenant-bound ciphertext, provider routing, chat persistence and bounded context. Real third-party API calls are not verified. |
| 4 — Agent runtime and memory | Bounded provider-assisted planner, allowlisted memory/response tools, approval gate, background executor, task UI, pause/resume/cancel/reject and restart recovery. No external shell/browser tools or multi-step model replanning. | PostgreSQL CI exercises plan validation, no execution before approval, approved execution, memory writes, cross-user isolation, rejection, pause/resume and invalid-tool rejection. |
| 5 — Android | Not implemented. | No Android project, APK or device test exists. |
| 6 — Computer tools | Not implemented. | No isolated browser/terminal worker or sandbox tests exist. |
| 7 — Multi-agent and automations | Not implemented. | No delegation, scheduler or notification tests exist. |
| 8 — Production hardening | Partial security baseline only. | CI and secret scanning pass; deployment, backups, monitoring, quotas and independent security review are not verified. |

A passing CI run is evidence for the tests it executes, not proof that unimplemented phases work. Phase completion requires each phase's stated acceptance criteria to pass.

## Current truth

The repository has a same-origin web client, account/session APIs, PostgreSQL-backed conversations, per-user encrypted provider credentials, server-side Gemini/OpenAI/OpenRouter/Anthropic adapters, user-scoped memory CRUD, and a bounded approval-gated agent task runner. The task UI supports plan review, approve/reject, pause/resume/cancel, event history and result inspection.

The agent planner accepts provider-generated JSON plans with a maximum of five steps. Server-side validation allows only:
- `memory.search`: read-only access to the authenticated user's saved memories.
- `memory.save`: writes to the authenticated user's memory and is marked approval-required.
- `response.compose`: bounded response output.

Every plan requires explicit user approval before execution. Each tool result and task event is persisted. The executor checks state between steps. Tasks interrupted by a server restart are moved to paused and require explicit resume. Arbitrary shell, browser, HTTP, filesystem and device-control tools are not implemented.

GitHub Actions provisions PostgreSQL 16 and runs:
- JavaScript syntax checks for server, frontend and test files.
- PostgreSQL integration coverage for registration/login, CSRF, per-user credential isolation, encryption/tamper detection, provider selection, mocked OpenAI connection/chat and bounded history context.
- Agent tests for strict plan validation, no tool execution before approval, approved memory search/save/response execution, per-user access, rejection, pause/resume, restart recovery and invalid-tool rejection.
- Security regression tests for origin enforcement, fail-closed behaviour and frontend delivery.
- Gitleaks secret scanning.

Latest backend-verified code commit: `fe56c99f82efb09420f5d7f2e00a1b87beb50245`. Its GitHub Actions backend workflow passed 8 top-level tests with 0 failures and 0 skipped; the PostgreSQL integration suite exercised the Phase 4 agent flows. The secret scan passed. Later commits updated documentation only. Real third-party provider credentials/endpoints, browser/device visual QA and production deployment have not been tested. Phase 3 streaming/capability registry remains incomplete. Phases 5–7 are not implemented. Phase 8 remains a partial security baseline; deployment, backups, monitoring, quotas and independent security review are outstanding.
