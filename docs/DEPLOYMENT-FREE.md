# NEXUS AI — zero-budget deployment preparation

## Selected hosting layout

- **Render Free Web Service** runs the existing Node.js/Express app.
- **Neon Free PostgreSQL** stores all durable application data.
- The Express app serves its own web client and API on one origin. Do not deploy the frontend separately.
- This is a hobby/testing deployment. Render free services sleep after 15 minutes without inbound traffic and can take about a minute to wake. Free instances have limited resources and no production SLA.
- Neon Free currently provides 1 GB storage per project and 100 compute-hours per month. Compute scales to zero after inactivity; quotas can suspend database compute until the next monthly window. Check the live plan limits before use.

## Render service configuration

The root `render.yaml` defines the web service. It intentionally does not create a Render Postgres database: Render's free Postgres expires after 30 days, so Neon is the persistent free-tier choice.

Render settings:
- Repository: `vanshrajput578/Codebuddy.ai`
- Branch: `phase-5/android-client-ready`
- Runtime: Node
- Build: `npm install`
- Start: `npm start`
- Health check: `/api/health`
- Region: Singapore

## Required secrets and environment variables

Set these in the Render service Environment page. Do not commit them to GitHub or paste them into chat.

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `TRUST_PROXY` | `true` |
| `DATABASE_SSL` | `true` |
| `APP_ORIGIN` | Exact HTTPS origin Render assigns, e.g. `https://your-service.onrender.com` (no trailing slash) |
| `DATABASE_URL` | Neon pooled PostgreSQL connection string; use the connection string from Neon and retain its TLS parameters |
| `CREDENTIAL_ENCRYPTION_KEY` | A fresh 32-byte key encoded as Base64 |

Generate the encryption key locally with:
```sh
openssl rand -base64 32
```
Keep a secure offline backup. If this key is lost, saved provider API keys cannot be decrypted. Never reuse a key from another application.

## Neon database setup

1. Create a Neon account and a new PostgreSQL project.
2. Select a region close to Render (Singapore if offered).
3. Copy the **pooled** connection string from Neon. Keep it private.
4. Open Neon's SQL Editor for the new database.
5. Run the complete contents of `db/schema.sql` once. This initializes all NEXUS tables.
6. Paste the pooled connection string into Render's `DATABASE_URL` environment variable.

Do not run the full schema repeatedly against an existing database. For an older database that already has the Phase 4 agent tables, inspect the applied schema and run only the appropriate migration (currently `db/migrations/003_agent_runtime.sql`) if needed.

## Deployment sequence

1. Connect the GitHub repository to Render and create the service from this branch, or use the Blueprint flow to read `render.yaml`.
2. Create Neon project and initialize its schema.
3. Set all required environment variables in Render. Set `APP_ORIGIN` to the exact Render HTTPS origin.
4. Trigger/retry deployment.
5. Verify `https://<render-host>/api/health` returns HTTP 200 and JSON with `ok: true` and `database: true`.
6. Configure the same HTTPS origin in the NEXUS Android app Settings.
7. Test registration, login/session restoration, provider key save/test, chat, conversation history, agent planning, approval, pause/resume and cancellation.

## Important limitations and security notes

- Render Free sleeps after 15 minutes of inactivity; cold starts may take about a minute.
- Neon Free compute and storage are capped. Watch usage; reaching quotas can suspend database compute or reject further writes.
- The hosting plan is $0, but AI provider API calls may incur separate charges. Use provider free quotas only where available and set provider-side spending limits.
- The current API has no account email verification/recovery or production abuse/billing controls. Do not treat this as a public production launch.
- Do not add uptime-ping services to keep the free instance awake; that defeats the free-tier idle policy and may trigger restrictions.
- No deployment is performed merely by committing this preparation. The owner must connect Render and Neon accounts and configure secrets.
