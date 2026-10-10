# monorepo-docs-agent

pnpm workspace (plain, no Turborepo) for the docs-agent frontend + gateway,
now with a per-document RAG chat. The Python conversion service lives in the
sibling repo `md-conversion-service-py` and is consumed as a remote REST API —
never imported, only called over HTTP.

```
apps/platform/   Vite + React + TS + TanStack Router + Tailwind
                  Upload PDF → render markdown (/ + /r/$docId) + RAG chat panel.
                  Files > 8 MB (or sync timeouts) convert via background jobs
                  with progress; OCR on large files shows a cost warning.
apps/api/        Hono gateway, public :8377
                  POST /convert (proxy + enqueue index; HTTP 504 past
                    CONVERT_TIMEOUT_MS, with code convert_timeout),
                  POST /convert/jobs (202 async for large PDFs) +
                    GET /v1/convert/jobs/:jobId (poll: queued|processing|
                    done|error, per-page progress),
                  GET /documents, DELETE /documents/:docId (cascade),
                  GET /download/:docId, GET /public/* (proxy),
                  GET /health/live|/health/ready|/health,
                  GET /v1/status/:docId, GET /v1/debug/:docId (stuck-index
                    diagnosis: Postgres row + BullMQ job state + env),
                  GET|POST|DELETE /v1/chat/:docId/:sessionId (per-session RAG),
                  POST /v1/ask (non-streaming)
                  src/worker.ts  BullMQ worker: converter markdown → pages →
                  summary + embeddings → Qdrant
packages/agent/  TS library: shared contracts, markdown/page utilities,
                  retrieval + answer pipeline (providers/tools/prompts)
```

## RAG design

- **OCR/markdown source**: the Python converter (`md-conversion-service-py`,
  PyMuPDF reflow + pdfplumber tables + optional RapidOCR). Not Mistral OCR.
- **Ingest**: `POST /convert` proxies the converter, records the `doc_id` and
  enqueues a BullMQ job. Large PDFs go through `POST /convert/jobs` (202 +
  polling `GET /v1/convert/jobs/:jobId`); the gateway enqueues indexing
  idempotently once the job is done. The worker fetches
  `/public/<doc_id>/doc.md`, splits it
  into `## Page N` chunks, summarizes the first pages, stores `DocumentPage`
  rows and embeds each page (Xenova/all-MiniLM-L6-v2, 384d) into Qdrant.
- **Chat**: scoped per document, per session, per user. Memory identity is a
  browser fingerprint: `userId = fp:<localStorage id>`, sent as `x-user-id`.
  Session id is canonical: `doc:<docId>:s:<uuid>`.
- **Retrieval**: Qdrant filtered by `documentId`; falls back to deterministic
  keyword scoring when embeddings/Qdrant are unavailable.

## Prereqs

- Node 20+, pnpm 9 (`corepack enable`)
- Docker (Postgres + Redis + Qdrant) for the RAG path
- A running converter: local checkout of `md-conversion-service-py`,
  or `CONVERTER_URL` pointing at a deployment (+ `CONVERTER_API_KEY`).
- An OpenAI-compatible chat model (`OPENAI_API_KEY`) for summaries + answers.

## Run (dev)

```powershell
pnpm install

# 1) converter (:8379) — from the sibling repo
py -m venv ..\md-conversion-service-py\.venv   # first time only
..\md-conversion-service-py\.venv\Scripts\Activate.ps1
python -m pip install -e ..\md-conversion-service-py
python -m uvicorn app.main:app --host 127.0.0.1 --port 8379  # run inside md-conversion-service-py/

# 2) RAG infra (Postgres 15433, Redis 16379, Qdrant 6333)
docker compose up -d db redis qdrant

# 3) gateway (:8377) + worker — env tunggal di root (mirip fullstack)
Copy-Item .env.example .env   # fill DATABASE_URL, OPENAI_API_KEY, ...
pnpm db:generate
pnpm db:migrate
pnpm dev:api
pnpm dev:worker      # second terminal: indexes uploaded documents

# 4) platform (:8378)
Copy-Item apps/platform/.env.example apps/platform/.env   # VITE_API_URL=http://127.0.0.1:8377
pnpm dev:platform
```

Open http://127.0.0.1:8378 — upload a PDF, get `/r/<doc_id>` with rendered
markdown and an "Ask this document" panel that unlocks once indexing finishes.

## Endpoints (convert)

- `POST /convert` (multipart `file`, `scan_images`, `extract_images`,
  `ocr_images`, `ocr_scope`) → converter `ConvertResponse`; `413` past
  `MAX_UPLOAD_MB`, `504 { code: convert_timeout }` past `CONVERT_TIMEOUT_MS`
- `POST /convert/jobs` (same fields) → `202 { job_id, doc_id }`; `429` when
  the converter queue is full
- `GET /v1/convert/jobs/:jobId` → `{ status, progress: { pages_done,
  pages_total }, result, error }`
- `GET /v1/debug/:docId` → `{ doc, queue, env, hint }` for stuck-index diagnosis

## Environment

Server env lives in root `.env` (see `.env.example`), loaded by
`apps/api` + worker via `pnpm with-env`:

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `8377` | Gateway listen port |
| `PLATFORM_URL` | `http://127.0.0.1:8378,...` | CORS origins (comma-separated) |
| `MAX_UPLOAD_MB` | `30` | Upload limit (gateway + platform) |
| `CONVERTER_URL` / `CONVERTER_API_KEY` | `http://127.0.0.1:8379` / empty | Sibling converter service |
| `CONVERT_TIMEOUT_MS` | `600000` | Sync proxy cap; slower → `504`, use async jobs |
| `DATABASE_URL` / `REDIS_URL` / `QDRANT_URL` | local ports | RAG path; convert works without them |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` | empty | Chat/summary model (OpenAI-compatible) |
| `CHAT_MODEL` / `SUMMARY_MODEL` / `EMBEDDING_MODEL` | `gpt-4o-mini` / … / `Xenova/all-MiniLM-L6-v2` | Model ids |

Platform env lives in `apps/platform/.env` (see `apps/platform/.env.example`):
`VITE_API_URL` (default `http://127.0.0.1:8377`), `VITE_AGENT_URL`.

Never commit `.env` files — only `.env.example`.

## Endpoints (RAG)

- `GET /v1/status/:docId` → `{ indexed, pages, summary }`
- `GET /v1/chat/:docId/:sessionId` → `{ messages }` (header `x-user-id`)
- `POST /v1/chat/:docId/:sessionId` `{ question }` → NDJSON stream
  (`text_delta`, `citations`, `done`, `error`)
- `DELETE /v1/chat/:docId/:sessionId` → clears that session
- `POST /v1/ask` `{ docId, question, sessionId? }` → `{ answer, citations, sessionId }`

## Docker (infra only)

Compose only runs the stateful backing services — the apps run locally via
`pnpm` and the converter from the sibling repo.

```powershell
docker compose up -d db redis qdrant
```

Ports: Postgres `15433`, Redis `16379`, Qdrant `6333`.
