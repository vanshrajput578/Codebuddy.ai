# NEXUS AI

**Your Personal Autonomous AI Workspace**

NEXUS AI is an original AI-agent platform for web and Android. It is inspired by the general capabilities of autonomous agent products, with its own identity, architecture and implementation.

> **Current status:** Web workspace prototype and architecture documentation. The AI backend, persistent memory, Android client, browser automation and sandbox are planned—not yet implemented.

## Goals
- One account across web and Android.
- Configurable AI providers and model routing.
- Streaming conversations and user-controlled memory.
- Multi-step agent tasks with approvals, cancellation and execution history.
- Browser, file and terminal tools in isolated environments.
- Multi-agent delegation and scheduled workflows.

## Structure
- `index.html`, `styles.css`, `app.js`: current browser-openable frontend prototype.
- `docs/ARCHITECTURE.md`: system design and security boundaries.
- `docs/ROADMAP.md`: phased implementation and acceptance criteria.
- `.env.example`: server-side configuration template.

## Run locally
Open `index.html` in a browser or serve this directory with a static HTTP server. The current UI is a frontend preview; it does not call an AI provider or execute tools.

## Deployment
The static frontend can be published using GitHub Pages. This does **not** deploy an AI backend. Never place provider API keys in browser JavaScript or static hosting.

## Security
Provider secrets belong on the server, encrypted at rest. Browser and terminal automation must run in isolated sandboxes. Require approval for destructive or external side effects and enforce authorization on the backend.

## Status
See [Architecture](docs/ARCHITECTURE.md) and [Roadmap](docs/ROADMAP.md).

## License
No open-source license has been selected yet. Normal copyright applies; do not assume unrestricted reuse.