# Security Policy

## Secret handling
- Provider API keys are submitted over the authenticated same-origin API and encrypted at rest; the encryption master key is server-only.
- Never put provider keys in HTML, CSS, browser JavaScript, mobile app source, public config, commits, screenshots or client-visible API responses.
- Never prefix provider secrets with frontend-exposed variable conventions such as `VITE_`, `NEXT_PUBLIC_` or `EXPO_PUBLIC_`.
- Use deployment-platform secret storage in production. Keep local `.env` files untracked.
- If a key is exposed, revoke it immediately and create a replacement. Deleting it from the latest commit does not remove it from Git history.

## API protections implemented\n- Passwords hashed using scrypt; plaintext passwords are never stored.\n- Random session tokens stored as hashes in PostgreSQL.\n- HttpOnly, SameSite=Strict session cookies; Secure and __Host- prefixed in production.\n- CSRF token validation for authenticated state-changing endpoints.\n- Authentication required before AI provider calls.
- Helmet security headers and a restrictive Content Security Policy.
- Same-origin request checks for the chat endpoint.
- JSON request size limit and message length validation.
- Per-IP request rate limiting.
- No-store response headers on API endpoints.
- Provider keys are encrypted at rest using AES-256-GCM with a server-only 32-byte master key.\n- Provider APIs support Gemini, OpenAI, OpenRouter and Anthropic through server-side adapters.\n- Provider key management requires an authenticated session and CSRF token.\n- Provider metadata responses never return the original key.\n- Provider errors are not passed to the browser.
- No request-body or secret logging.

## Production requirements before public launch
This repository is not yet production-ready. Before public multi-user deployment, implement:
1. Real user authentication and authorization, with secure, HttpOnly, Secure, SameSite cookies or a vetted identity provider.
2. Per-user quotas, billing controls and abuse monitoring (IP limits alone are insufficient).
3. CSRF protection for cookie-authenticated state-changing routes.
4. Encrypted per-user provider credentials using a managed KMS; never store plaintext keys.
5. Database access controls, migrations, backups and retention/deletion workflows.
6. Dependency scanning, secret scanning, SAST and security review.
7. Separate isolated workers for browser/terminal tools; never execute user commands inside the API process.

## Reporting
Do not publish exploit details or credentials in public issues. Rotate any suspected exposed key first, then report the affected component privately to the repository owner.
