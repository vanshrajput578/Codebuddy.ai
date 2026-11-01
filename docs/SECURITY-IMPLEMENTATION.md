# Security implementation notes

## Implemented in the repository
- Server-side provider adapters for Gemini, OpenAI, OpenRouter and Anthropic.
- PostgreSQL schema for users, sessions, conversations and messages.
- Email/password registration and login; passwords are hashed using scrypt.
- Random opaque session cookies; only a hash of the token is stored in PostgreSQL.
- HttpOnly and SameSite=Strict cookies; Secure and `__Host-` prefix in production.
- CSRF token validation for authenticated chat and logout.
- Origin validation, Helmet/CSP, request limits and IP rate limits.
- Frontend served by the same Express origin.
- Security regression tests in `tests/security.test.mjs`.

## Local setup
1. Install Node.js 20+ and PostgreSQL 14+.
2. Create a database and database user.
3. Copy `.env.example` to `.env`; set `DATABASE_URL`, `APP_ORIGIN=http://localhost:4000`, and `CREDENTIAL_ENCRYPTION_KEY` (generate with `openssl rand -base64 32`). Provider API keys are entered in Settings.
4. Apply schema: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/schema.sql`.
5. Run `npm install`, then `npm test`, then `npm run dev`.
6. Open `http://localhost:4000`.

## Production requirements
Set `NODE_ENV=production`, use HTTPS, set the exact `APP_ORIGIN`, store secrets in the hosting platform's secret manager, and enable database TLS where required. Configure trusted proxy settings only when the deployment topology is known.

The current code does not yet provide email verification, password reset, per-user AI quotas, provider-key rotation reminders or account deletion. The credential vault uses one server master key; back it up securely and rotate it only with a deliberate re-encryption migration. Do not treat it as production-ready until those controls and an independent security review are complete.

## API contract
- `GET /api/health`: database availability only.
- `POST /api/auth/register`: accepts `{email, password, displayName}`; returns user, CSRF token and sets HttpOnly session cookie.
- `POST /api/auth/login`: accepts `{email, password}`; returns user, CSRF token and sets HttpOnly session cookie.
- `GET /api/auth/me`: returns current user and rotates CSRF token.
- `POST /api/auth/logout`: requires session cookie and `X-CSRF-Token`.
- `GET /api/conversations`: lists only the signed-in user's conversations.\n- `GET /api/conversations/:id/messages`: returns messages only when the conversation belongs to the signed-in user.\n- `DELETE /api/conversations/:id`: deletes only a conversation owned by the signed-in user and requires CSRF.\n- `GET /api/providers`: returns only provider names, model IDs and masked configured status.\n- `PUT /api/providers/:provider`: encrypts the submitted key with AES-256-GCM before storage.\n- `DELETE /api/providers/:provider`: deletes that user's provider key.\n- `PUT /api/provider-selection`: selects one configured provider.\n- `POST /api/providers/:provider/test`: tests a saved key and returns a generic result only.\n- `POST /api/chat`: calls the selected provider adapter and saves user/assistant messages. The decrypted provider key exists only in the server process for the outbound request.
