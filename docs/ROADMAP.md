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
- [x] Model capability registry for Gemini, OpenAI, OpenRouter and Anthropic (streaming, tools, vision, JSON mode, defaults and known model limits).
- [x] Authenticated SSE streaming chat for Gemini, OpenAI, OpenRouter and Anthropic, including bounded transient retries, timeout/cancellation handling, persisted usage/error telemetry and a streaming web composer.
- [x] Add authenticated provider connection test endpoint.
Acceptance: configured provider returns a real streamed response. Current: credential storage, selection and adapters are implemented; actual live provider calls and streaming remain unverified/not implemented.

## Phase 4 — Agent runtime and memory
- [x] Add PostgreSQL-backed durable task records, execution cursor and event history.
- [x] Provider-assisted planning with strict JSON validation and a eight-step execution bound and central tool registry.
- [x] Central allowlisted tool registry with memory search/save, safe arithmetic and timezone-aware clock tools, plus server-side input validation.
- [x] Explicit plan approval/rejection, pause/resume/cancel transitions and restart recovery.
- [x] Add user-scoped persistent memory CRUD API.
Acceptance: tasks survive restart and restricted tools require approval. Current: bounded planner/executor, central tool registry, safe math/time tools, memory-write approval gate, task UI, lifecycle controls, restart-to-paused recovery, persisted-result composition and evidence-driven continuation planning are implemented. Continuations are capped at two rounds and eight total steps; newly proposed writes clear the prior approval and pause until the updated plan is approved.

## Phase 5 — Android
- [x] Native Kotlin/Jetpack Compose app and shared API client.
- [x] Encrypted session-cookie storage.
- [x] Chat, conversation history, provider settings and agent task monitoring/approval/lifecycle controls.
- [ ] Push notifications, file upload and voice capabilities.
- [x] Android debug build in CI; [ ] physical-device/emulator interaction tests and signed release build.
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
| 4 — Agent runtime and memory | Bounded provider-assisted planner, allowlisted tools, approval gate, evidence-driven replanning (maximum two rounds/eight total steps), fresh approval for newly introduced writes, task UI and lifecycle controls. No external shell/browser tools. | PostgreSQL CI verifies initial planning, execution, persisted tool evidence, continuation replacement, approval reset, no write before renewed approval, reapproval, completion, tenant isolation, rejection, pause/resume and restart recovery. |
| 5 — Android | Native Kotlin/Jetpack Compose client implemented: sign-in/register, encrypted session-cookie storage, chat/history, provider settings, agent task creation/plan review/approval and lifecycle controls. Push notifications, file/voice features, biometric auth, offline mode, Play signing and device QA remain. | Android Gradle CI passed on current branch head `b351da1` and uploaded a 10.4 MiB debug APK artifact. No device/emulator interaction test or signed release APK has been verified. |
| 6 — Computer tools | Not implemented. | No isolated browser/terminal worker or sandbox tests exist. |
| 7 — Multi-agent and automations | Not implemented. | No delegation, scheduler or notification tests exist. |
| 8 — Production hardening | Partial security baseline only. | CI and secret scanning pass; deployment, backups, monitoring, quotas and independent security review are not verified. |

A passing CI run is evidence for the tests it executes, not proof that unimplemented phases work. Phase completion requires each phase's stated acceptance criteria to pass.

## Current truth

The repository has a same-origin web client, account/session APIs, PostgreSQL-backed conversations, per-user encrypted provider credentials, server-side Gemini/OpenAI/OpenRouter/Anthropic adapters, user-scoped memory CRUD, and a bounded approval-gated agent task runner. The task UI supports plan review, approve/reject, pause/resume/cancel, event history and result inspection.

The agent planner accepts provider-generated JSON plans with a maximum of eight steps and validates each step through a central tool registry. Server-side validation allows only:
- `memory.search`: read-only access to the authenticated user's saved memories.
- `memory.save`: writes to the authenticated user's memory and is marked approval-required.
- `math.calculate`: bounded arithmetic parser (no eval or code execution).
- `time.now`: current time for a validated IANA timezone.
- `response.compose`: bounded response output.

Every plan requires explicit user approval before execution. Each tool result and task event is persisted. The executor checks state between steps. Tasks interrupted by a server restart are moved to paused and require explicit resume. Arbitrary shell, browser, HTTP, filesystem and device-control tools are not implemented.

GitHub Actions provisions PostgreSQL 16 and runs:
- JavaScript syntax checks for server, frontend and test files.
- PostgreSQL integration coverage for registration/login, CSRF, per-user credential isolation, encryption/tamper detection, provider selection, mocked OpenAI connection/chat and bounded history context.
- Agent tests for strict plan validation, no tool execution before approval, approved memory search/save/response execution, per-user access, rejection, pause/resume, restart recovery and invalid-tool rejection.
- Security regression tests for origin enforcement, fail-closed behaviour and frontend delivery.
- Gitleaks secret scanning.

Latest verified branch head: `b351da1ec84e03455a1b5bcca900e1a7a9d912d8`. Backend checks, Android Gradle debug build and Gitleaks secret scan all completed successfully on this commit. The Android workflow uploaded a debug APK artifact. Real third-party provider credentials/endpoints, browser/device visual QA and production deployment have not been tested. Phase 3 streaming/capability registry remains incomplete. Phase 5 Android is partially implemented; Phases 6–7 are not implemented. Phase 8 remains a partial security baseline; deployment, backups, monitoring, quotas and independent security review are outstanding.


## Core Agent increment (2026-11-01)

- [x] Centralize tool definitions, input validation and approval metadata in `agent/tool-registry.mjs`.
- [x] Add a bounded arithmetic calculator that does not use `eval` or execute code.
- [x] Add a timezone-aware current-time tool (defaults to Asia/Kolkata).
- [x] Increase the maximum validated plan length from five to eight steps with an additive database migration.
- [x] Add unit tests for tool allowlisting, validation, approval metadata, arithmetic safety and time output.
- [ ] Move execution into a separately supervised durable worker with claims/leases, heartbeat, bounded retries and restart-safe recovery (separate next reliability increment; not part of the Core Agent acceptance scope).
- [x] Add evidence-driven dynamic replanning with bounded continuation plans and renewed approval for newly proposed writes.


## Phase 2 — Background Worker + Durable Task Recovery (project execution roadmap)

**Implementation status: complete; acceptance checks passed in PostgreSQL-backed GitHub Actions CI.**

- [x] Add PostgreSQL lease fields, worker-attempt bounds and a partial claim index.
- [x] Add atomic task claiming with `FOR UPDATE SKIP LOCKED`.
- [x] Add UUID lease fencing tokens and renewable worker heartbeats.
- [x] Move approval/resume execution out of the API process; expose a separate `npm run worker` process.
- [x] Add bounded crash-reclaim attempts and terminal handling when leases repeatedly expire.
- [x] Make the worker resume from the persisted task cursor and keep tool execution inside the existing task transaction.
- [x] Verify atomic concurrent claims, stale-token fencing, expired-lease reclaim and task-cursor recovery in PostgreSQL integration CI.
- [x] Verify heartbeat renewal under long-running work and forced worker-process termination with a real child worker process.
- [x] Add a private-by-default worker health endpoint with state/counters/last-error visibility and document process supervision plus graceful shutdown.
Acceptance: API and worker run separately; multiple workers cannot claim the same live lease; expired leases are safely reclaimed; interrupted work resumes from persisted progress without duplicate committed tool steps.

## Core Agent Phase 1 — closure record (2026-11-01)

**Status: 100% of the agreed Core Agent Phase 1 scope implemented and CI-verified.** This is the project execution roadmap milestone, not the repository's separately numbered Phase 1 — Web foundation.

Acceptance evidence on branch commit `fe3bbab72695764cee7e4d7ae7ad6834c175ad4b`:
- Backend workflow: syntax checks and complete Node.js/PostgreSQL integration suite passed.
- Android workflow: Gradle debug APK build and artifact upload passed.
- Secret scan: passed.
- The Android workflow produced the `nexus-ai-debug-apk` artifact (approximately 10.4 MiB).

Core Agent scope closed: bounded provider-assisted planning, central allowlisted tool registry, safe calculator and timezone tool, persisted task/step/event state, approval-gated memory writes, pause/resume/reject/cancel lifecycle, persisted tool evidence, bounded evidence-driven replanning, renewed approval for newly proposed writes, and automated tests.

Explicitly outside this milestone: separately supervised durable worker with leases/heartbeats, browser/terminal sandbox, multi-agent delegation, scheduled automations, live third-party provider verification, signed release APK, physical-device QA and production deployment. These remain future work; their absence does not reduce the completion percentage of the agreed Core Agent Phase 1 scope.


## Background Worker Phase 2 — closure record (2026-11-01)

**Status: 100% of the agreed Background Worker + Durable Task Recovery scope implemented and CI-verified.**

Acceptance evidence on branch commit `9abcf25601b59921990264048157a9e23f4f6906`:
- Backend checks: passed, including PostgreSQL 16 integration suite (17 tests total).
- Secret scan: passed.
- Integration suite verifies long-running lease heartbeat renewal and hard-killing a separate worker subprocess, waiting for lease expiry, then reclaiming the task with a replacement worker.
- Worker health endpoint exposes worker state, active task, claim/heartbeat counters and last error; it binds to loopback by default.
- README documents API/worker separation, health-check configuration, graceful shutdown and process supervision.

Phase 2 scope closed: PostgreSQL atomic claims, lease fencing, renewable heartbeat scheduling without overlapping calls, bounded crash retries, persisted-cursor recovery, stale-worker protection, long-running heartbeat verification, hard process-termination recovery, health metrics and process-supervision guidance.

This closes the agreed project execution Phase 2 milestone. It does not mean the separate repository roadmap Phase 8 production-hardening work is complete, and it does not claim deployment or merge.
