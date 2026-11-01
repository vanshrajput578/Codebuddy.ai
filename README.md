# NEXUS AI

**Your Personal Autonomous AI Workspace**

NEXUS AI is an AI workspace foundation with a same-origin web client, a Node.js API, PostgreSQL-backed accounts and a server-side Gemini integration.

> **Current status:** Account registration/login, server-side sessions, CSRF validation and authenticated Gemini chat are implemented in the codebase. Per-user conversation persistence and bounded chat context are implemented. The encrypted per-user provider vault and Gemini/OpenAI/OpenRouter/Anthropic adapters are implemented in code. Autonomous tools, Android client and production deployment are not implemented. This project has not yet passed a live deployment/security review.

## Local setup
Requirements: Node.js 20+, PostgreSQL 14+ and a Gemini API key.

1. Create a PostgreSQL database and user.
2. Copy `.env.example` to `.env`; keep this file private and untracked.
3. Set `DATABASE_URL`, `APP_ORIGIN=http://localhost:4000` and `CREDENTIAL_ENCRYPTION_KEY` in `.env`. Generate the latter with `openssl rand -base64 32`. AI provider keys are entered in Settings and encrypted server-side.
4. Apply the database schema: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/schema.sql`.
5. Install dependencies: `npm install`.
6. Run syntax checks and security tests: `npm run check && npm test`.
7. Start the app: `npm run dev`.
8. Open `http://localhost:4000`.

The Express server serves the frontend and API on the same origin. Do not host the frontend separately unless you deliberately configure a secure same-origin reverse proxy.

## Security model
- Provider credentials are read only by the server from environment variables.
- Passwords are hashed with Node.js scrypt; plaintext passwords are never stored.
- Session tokens are random, stored as SHA-256 hashes in PostgreSQL and sent only in HttpOnly, SameSite=Strict cookies.
- Production cookies use the Secure flag and the `__Host-` prefix.
- State-changing authenticated requests require a CSRF token.
- Auth and chat endpoints have rate limits; requests have size and input limits.
- Helmet security headers and a restrictive Content Security Policy are enabled.
- Gitleaks scans repository history in GitHub Actions.

## Production deployment notes
Set `NODE_ENV=production`, a strong private database credential, `APP_ORIGIN` to the exact HTTPS origin, `DATABASE_SSL=true` when required by your database host, and `GEMINI_API_KEY` using the host's secret manager. Set `TRUST_PROXY=true` only when exactly one trusted reverse proxy sits in front of the app. Never commit a real `.env` file.

This is not yet production-ready for public multi-user traffic. Add per-user AI quotas, conversation persistence, account recovery/email verification, credential vault/KMS, dependency scanning, operational monitoring, backups and a third-party security review before launch.

## Current API
- `GET /api/health`: database availability only; no secret values.
- `POST /api/auth/register`: create an account.
- `POST /api/auth/login`: create an authenticated session.
- `GET /api/auth/me`: inspect current session and rotate CSRF token.
- `POST /api/auth/logout`: revoke current session.
- `GET /api/conversations`: list the signed-in user's recent conversations.\n- `GET /api/conversations/:id/messages`: read messages for a conversation owned by the signed-in user.\n- `DELETE /api/conversations/:id`: delete a conversation owned by the signed-in user.\n- `GET /api/providers`: returns configured provider metadata without secrets.\n- `PUT /api/providers/:provider`: encrypts and stores the signed-in user's provider key.\n- `DELETE /api/providers/:provider`: removes a saved provider key.\n- `PUT /api/provider-selection`: chooses an already-configured provider.\n- `POST /api/providers/:provider/test`: tests the saved key without returning it.\n- `POST /api/chat`: authenticated request through the selected provider with CSRF validation and conversation persistence.

See [Security Policy](SECURITY.md), [Security Implementation](docs/SECURITY-IMPLEMENTATION.md), [Architecture](docs/ARCHITECTURE.md) and [Roadmap](docs/ROADMAP.md).

## License
No open-source license has been selected yet. Normal copyright applies.
