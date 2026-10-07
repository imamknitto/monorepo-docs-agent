# monorepo-docs-agent

pnpm workspace (plain, no Turborepo) for the docs-agent frontend + gateway.
The Python conversion service lives in the sibling repo
`md-conversion-service-py` and is consumed as a remote REST API —
never imported, only called over HTTP.

```
apps/platform/   Vite + React + TS + TanStack Router + Tailwind
                 Upload PDF → render markdown (/ + /r/$docId)
apps/api/        Hono gateway, public :8000
                 POST /convert, GET /download/:docId, GET /public/* (proxy),
                 GET /health (aggregate), POST /v1/ask (501 stub)
packages/agent/  TS library: askDoc / generateQa stubs for future RAG,
                 consumed by apps/api
packages/shared/ Shared contracts (OpenAPI snapshot of the converter + generated types)
```

## Prereqs

- Node 20+, pnpm 9 (`corepack enable`)
- A running converter: local checkout of `md-conversion-service-py`,
  or `CONVERTER_URL` pointing at a deployment (+ `CONVERTER_API_KEY`).

## Run (dev)

```powershell
pnpm install

# 1) converter (:8100) — from the sibling repo
py -m venv ..\md-conversion-service-py\.venv   # first time only
..\md-conversion-service-py\.venv\Scripts\Activate.ps1
python -m pip install -e ..\md-conversion-service-py
python -m uvicorn app.main:app --host 127.0.0.1 --port 8100  # run inside md-conversion-service-py/

# 2) gateway (:8000)
Copy-Item apps/api/.env.example apps/api/.env   # CONVERTER_URL=http://127.0.0.1:8100
pnpm dev:api

# 3) platform (:5173)
Copy-Item apps/platform/.env.example apps/platform/.env   # VITE_API_URL=http://127.0.0.1:8000
pnpm dev:platform
```

Open http://127.0.0.1:5173 — upload a PDF, get `/r/<doc_id>` with rendered markdown.

## Docker (local integration)

```powershell
docker compose build
$env:CONVERTER_API_KEY="dev-secret"   # must match ../md-conversion-service-py/.env
docker compose up -d
curl.exe http://127.0.0.1:8000/health
docker compose down
```

`converter` here builds the sibling checkout for integration; deployment
uses the published `md-conversion-service-py` image / remote URL instead.
Only `api` and `web` publish ports. Ports: `8000` gateway, `3000` web.
