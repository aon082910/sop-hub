# SOP-Hub

[![Build](https://github.com/aon082910/sop-hub/actions/workflows/build.yml/badge.svg)](https://github.com/aon082910/sop-hub/actions/workflows/build.yml)

A self-hosted clone of [Scribe](https://scribe.com/): turn a workflow into a step-by-step
visual guide, with AI help from either a local model (Ollama) or a cloud provider
(Anthropic Claude, OpenAI, or any OpenAI-compatible endpoint). Runs entirely on your own
hardware (e.g. Unraid) via a single Docker container.

## Features

- **Capture** — record a process two ways:
  - Manual: upload screenshots in order and write them up in the editor.
  - Browser extension (`extension/`): click through the workflow in Chrome and SOP-Hub
    auto-captures a screenshot + click position for every click, then uploads the whole
    walkthrough as a new guide in one click.
- **Editor** — reorder, retitle, and rewrite steps; redact sensitive parts of a
  screenshot by drawing boxes over them before publishing.
- **AI assistance**, local or cloud, picked per-request:
  - Describe a step from its screenshot (vision).
  - Auto-generate a guide title + summary from its steps.
  - Rewrite step text for clarity/tone.
  - Ask-AI chat that answers questions about a specific guide.
- **Publish & share** — one click publishes a guide to a public read-only link.
- **Export** — PDF, HTML, and Markdown, each self-contained with embedded step images.
- **Multi-tenant** — users, workspaces, and workspace membership.

## Quick start

```bash
docker run -d \
  --name sop-hub \
  -p 8080:8080 \
  -e JWT_SECRET=$(openssl rand -hex 32) \
  -e PUID=99 -e PGID=100 \
  -v /mnt/user/appdata/sop-hub:/config \
  allornothing/sop-hub:latest
```

Or with compose (`docker-compose.yml` in this repo wraps the same image):

```bash
cp .env.example .env   # set a real JWT_SECRET at minimum
docker compose up -d --build
```

Open http://localhost:8080. Local AI is the default (`AI_DEFAULT_PROVIDER=ollama`) — point
`OLLAMA_BASE_URL` at any Ollama instance on your LAN (it does not run inside this
container), or set cloud credentials instead — see **AI provider setup** below.

## Architecture

Everything runs in one container, matching the rest of the AoN-Unraid-Apps collection:
Postgres (embedded, data lives under `/config/postgres`), the Node/Express API, and the
built React frontend (served statically by Express on the same port). `/config` is the
single folder to back up — it holds the database and all uploaded step screenshots.

The backend never hard-codes an AI provider: `backend/src/services/aiProvider.ts` exposes
`generateText` / `generateVisionCaption`, dispatched by an `AiProviderName` of
`ollama | anthropic | openai | custom`. Every AI route accepts an optional `provider`
field and otherwise falls back to `AI_DEFAULT_PROVIDER`. Swapping or adding a provider
means editing that one file — feature routes never change.

```
Dockerfile         multi-stage build: frontend -> backend -> single runtime image
entrypoint.sh       boots embedded Postgres (as PUID:PGID), runs migrations, starts the app
backend/            Node.js/TypeScript + Express API, AI provider abstraction, exports
frontend/           React + Vite SPA
extension/          Manifest V3 Chrome extension -- the "capture" side of the product
```

## Using the browser extension

1. In Chrome, go to `chrome://extensions`, enable Developer Mode, "Load unpacked", and
   select the `extension/` folder.
2. Click the SOP-Hub Capture icon, log in with your SOP-Hub account and server URL.
3. Click "Start recording" and walk through the process in the browser — every click
   captures a screenshot.
4. Click "Stop recording" then "Upload to SOP-Hub" — a new guide appears in the app,
   ready to edit and add AI-generated step descriptions.

## AI provider setup

| Provider | Where it runs | Config |
|---|---|---|
| Ollama | Any Ollama instance you already run (LAN box, another container) | `OLLAMA_BASE_URL`, `OLLAMA_MODEL` (use a vision model like `llava` for screenshot captions) |
| Anthropic | Cloud | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` |
| OpenAI | Cloud | `OPENAI_API_KEY`, `OPENAI_MODEL` |
| Custom | Cloud or self-hosted, any OpenAI-compatible API | `CUSTOM_OPENAI_BASE_URL`, `CUSTOM_OPENAI_API_KEY`, `CUSTOM_OPENAI_MODEL` |

`AI_DEFAULT_PROVIDER` picks the default; each user's browser can locally override it
per-session from the app's Settings page (stored in `localStorage`, sent as `provider`
on each AI request — no keys ever touch the browser).

## Configuration reference

| Variable | Default | Notes |
|---|---|---|
| `JWT_SECRET` | *(required)* | Any long random string — signs auth tokens |
| `PUID` / `PGID` | `99` / `100` | Unraid's `nobody`/`users` — owns everything under `/config` |
| `TZ` | `Etc/UTC` | Timezone for timestamps |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `sophub` / `sophub` / `sophub` | Embedded DB credentials, never exposed outside the container |
| `AI_DEFAULT_PROVIDER` | `ollama` | `ollama` \| `anthropic` \| `openai` \| `custom` |
| `OLLAMA_BASE_URL` / `OLLAMA_MODEL` | `http://ollama:11434` / `llava` | Point at your own Ollama instance |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | — | Cloud AI |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | — | Cloud AI |
| `CUSTOM_OPENAI_BASE_URL` / `CUSTOM_OPENAI_API_KEY` / `CUSTOM_OPENAI_MODEL` | — | Any OpenAI-compatible endpoint |

## Development (without Docker)

```bash
# backend -- needs a Postgres reachable at DATABASE_URL
cd backend && npm install
npm run migrate
npm run dev                      # http://localhost:4000

# frontend -- point it at the backend above
cd frontend && npm install
VITE_API_BASE_URL=http://localhost:4000 npm run dev   # http://localhost:5173
```

## Data model

See `backend/src/db/schema.sql` — `users`, `workspaces`, `workspace_members`, `guides`,
`steps`, `guide_chat_messages`.

## Known limitations / next steps

- Step drag-and-drop reordering is up/down buttons, not drag handles yet.
- Redaction is a black box only (no blur), applied destructively to the stored screenshot
  with no undo once applied.
- The extension does not yet auto-suggest step titles from the DOM element clicked —
  it relies on the AI "Describe screenshot" action in the editor instead.
- No role-based permissions beyond workspace membership (all members can edit all guides).

## License

MIT — see [LICENSE](LICENSE).
