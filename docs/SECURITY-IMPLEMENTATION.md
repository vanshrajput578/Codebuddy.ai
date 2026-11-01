# Security implementation notes

## Implemented in the repository
- Server-side Gemini API integration.
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
3. Copy `.env.example` to `.env`; set `DATABASE_URL`, `APP_ORIGIN=http://localhost:4000`, and `GEMINI_API_KEY`.
4. Apply schema: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/schema.sql`.
5. Run `npm install`, then `npm test`, then `npm run dev`.
6. Open `http://localhost:4000`.

## Production requirements
Set `NODE_ENV=production`, use HTTPS, set the exact `APP_ORIGIN`, store secrets in the hosting platform's secret manager, and enable database TLS where required. Configure trusted proxy settings only when the deployment topology is known.

The current code does not yet provide email verification, password reset, per-user AI quotas, conversation persistence, user-managed provider keys or account deletion. Do not treat it as production-ready until those controls and an independent security review are complete.

## API contract
- `GET /api/health`: database availability only.
- `POST /api/auth/register`: accepts `{email, password, displayName}`; returns user, CSRF token and sets HttpOnly session cookie.
- `POST /api/auth/login`: accepts `{email, password}`; returns user, CSRF token and sets HttpOnly session cookie.
- `GET /api/auth/me`: returns current user and rotates CSRF token.
- `POST /api/auth/logout`: requires session cookie and `X-CSRF-Token`.
- `POST /api/chat`: requires session cookie and `X-CSRF-Token`; provider key remains server-side.
