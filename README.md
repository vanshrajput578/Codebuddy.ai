# NEXUS AI

**Your Personal Autonomous AI Workspace**

NEXUS AI is an AI workspace foundation with a browser UI and a server-side Gemini chat API.

> **Current status:** The frontend can call a server-side Gemini endpoint. Agent execution, persistent memory, Android client, account authentication, browser automation and sandbox are not implemented. This is not production-ready for public multi-user use.

## Run locally
1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Set `GEMINI_API_KEY` and `APP_ORIGIN` in `.env`.
5. Start the API with `npm run dev`.
6. Serve the static frontend on the configured origin and reverse-proxy `/api` to the API server. The frontend and API must be same-origin; do not point browser code directly at a provider API.

## Secret safety
- **Never** put provider keys in `app.js`, HTML, CSS, frontend build variables or GitHub commits.
- Keep the real `.env` file local and untracked. `.env.example` contains placeholders only.
- Use your hosting provider's server-side secret manager in deployment.
- If a key was ever committed or shared, revoke it and issue a new one. Removing a key from the latest commit is not enough.
- The API never returns provider credentials or raw provider errors.

## Current API
- `GET /api/health`: basic health and provider-configured status; no secrets.
- `POST /api/chat`: sends a user message to Gemini from the server.
- Security controls: Helmet headers, restrictive CSP, origin checks, request size/message validation, per-IP rate limiting and no-store API responses.

## Important production warning
Origin checks are not authentication. IP rate limiting is not a substitute for per-user quotas. Before public deployment, add real user authentication, per-user authorization and quotas, CSRF protection for cookie sessions, encrypted user credential storage using a managed KMS, monitoring and an isolated worker for tools. See [SECURITY.md](SECURITY.md) and [security implementation notes](docs/SECURITY-IMPLEMENTATION.md).

## Project docs
- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [Security policy](SECURITY.md)

## License
No open-source license has been selected yet. Normal copyright applies.
