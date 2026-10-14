# monorepo-docs-agent

pnpm workspace for a docs agent: upload a PDF, view the converted markdown, and chat with that document via RAG. The workspace includes the platform UI, API gateway + indexing worker, and a shared agent library. PDF conversion is handled by a separate HTTP service (sibling repo `md-conversion-service-py` or a remote `CONVERTER_URL`).

## Stack

- **Platform**: Vite, React, TypeScript, TanStack Router, Tailwind
- **API / worker**: Hono, BullMQ, Postgres, Redis, Qdrant
- **Agent**: TypeScript library (retrieval + answer pipeline)
- **Converter**: external REST service (`md-conversion-service-py` or `CONVERTER_URL`)
- **Tooling**: pnpm workspace, Docker Compose for infra

## Preparation & step to run

**Prep**

- Node 20+, pnpm 9 (`corepack enable`), Docker
- Converter running locally (sibling repo) or via `CONVERTER_URL`
- Copy `.env.example` → `.env` (root) and `apps/platform/.env.example` → `apps/platform/.env`
- Set at least `OPENAI_API_KEY` and the DB/Redis/Qdrant URLs as needed

**Run** (PowerShell)

```powershell
pnpm install

# 1) converter (:8379) — from sibling repo md-conversion-service-py
# start uvicorn on 127.0.0.1:8379 (see that repo's README)

# 2) infra
docker compose up -d db redis qdrant

# 3) gateway + worker
pnpm db:generate
pnpm db:migrate
pnpm dev:api
pnpm dev:worker   # second terminal

# 4) platform
pnpm dev:platform
```

Open http://127.0.0.1:8378

Ports: platform `8378`, API `8377`, converter `8379`, Postgres `15433`, Redis `16379`, Qdrant `6333`.

## Features & app flow

- Upload PDF as a background job (progress, cancel; resumes after reload)
- View rendered markdown at `/r/<docId>`
- Worker indexes the document; chat unlocks when indexing finishes
- Per-document, per-session RAG chat (“Ask this document”)
- List / delete documents; download when available

```
Upload PDF → Convert (API) → View markdown
                          ↘ Worker indexes → RAG chat
```
