# Security Policy

## Secret handling

- Provider API keys are submitted over authenticated same-origin routes and encrypted at rest. The encryption master key is server-only.
- Never put provider keys in HTML, CSS, browser JavaScript, mobile app source, public config, commits or screenshots.
- Keep local `.env` files untracked. Use deployment-platform secret storage.
- If a key is exposed, revoke it and create a replacement. Removing it from the latest commit does not erase Git history.

## Protections implemented

- Passwords hashed using scrypt; plaintext passwords are never stored.
- Random session tokens stored as hashes in PostgreSQL.
- HttpOnly, SameSite=Strict cookies; Secure and `__Host-` prefixed in production.
- CSRF validation and exact-origin checks on authenticated state-changing routes.
- Helmet security headers and a restrictive Content Security Policy.
- Request-size and message-length limits; per-IP rate limiting.
- AES-256-GCM encryption for per-user provider credentials, with authenticated additional data binding each ciphertext to its user and provider.
- Provider metadata responses never return the original API key.
- Provider requests have bounded timeouts.
- No request-body or secret logging is intentionally implemented.

## Before public production launch

1. Add email verification, account recovery and account deletion.
2. Add per-user quotas, billing controls and abuse monitoring.
3. Move credential encryption to managed KMS/HSM-backed envelope encryption and define key rotation.
4. Add database migrations, access controls, backups and restore tests.
5. Add dependency scanning, SAST, monitoring and an independent security review.
6. Run browser and terminal tools only in isolated workers, never inside the API process.

## Reporting

Do not publish exploit details or credentials in public issues. Rotate any suspected exposed key first, then report the affected component privately to the repository owner.
