# Security implementation notes

## Current backend
The API uses the official Google Gen AI Node SDK. The browser sends only a user message to `POST /api/chat`; the server reads `GEMINI_API_KEY` from its environment and calls Gemini. The provider key is never sent to the browser.

## Local setup
1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Set `GEMINI_API_KEY` and `APP_ORIGIN` in the server-only `.env` file.
5. Serve the frontend and proxy `/api` to the API server, or configure a same-origin reverse proxy. Do not expose the API on an unrestricted public host.

## Important deployment boundary
The current chat endpoint is a protected-by-origin and rate-limited prototype, not a complete multi-user authentication system. Origin checks are not authentication. Do not publish this API as a paid/public service until authentication, per-user quotas, monitoring and credential lifecycle controls are implemented.

## API contract
- `GET /api/health`: returns service status and whether a provider is configured. It never returns the key.
- `POST /api/chat`: accepts JSON `{ "message": "..." }` and returns JSON `{ "answer": "..." }`.
- Provider failures return a generic error; raw provider responses and secrets are not exposed.
