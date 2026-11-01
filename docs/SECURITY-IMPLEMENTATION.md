# Security implementation notes

## Implemented in the repository

- Node.js/Express API with same-origin static frontend.
- PostgreSQL schema for users, sessions, conversations, messages and provider credentials.
- Email/password registration and login; passwords are hashed using scrypt.
- Random opaque session cookies; only token hashes are stored in PostgreSQL.
- HttpOnly and SameSite=Strict cookies; Secure and `__Host-` prefix in production.
- CSRF token validation and exact-origin checks for state-changing routes.
- Helmet/CSP, request limits and IP rate limits.
- Per-user provider credential encryption using AES-256-GCM.
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

## Remaining production requirements

Email verification, password reset, account deletion, per-user AI quotas, managed KMS/envelope encryption, key rotation, database backups/restore tests, monitoring and independent security review are not complete. Agent execution, Android and isolated computer-use workers are also not implemented.

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
