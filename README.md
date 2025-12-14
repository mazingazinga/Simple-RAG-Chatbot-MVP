# Simple RAG Chatbot MVP

Next.js 16+ App Router starter with Tailwind CSS, shadcn/ui, Drizzle ORM, Postgres + pgvector (docker-compose), and a TypeScript worker entrypoint.

## Stack
- Next.js 16, React 19, TypeScript, App Router
- Tailwind CSS 3 + shadcn/ui primitives
- Drizzle ORM + drizzle-kit
- Postgres 16 with pgvector via docker-compose
- Worker runner powered by `tsx`

## Quickstart
1) Install deps: `npm install`  
2) Configure env: copy `.env.example` to `.env.local` and update values.  
3) Start DB: `docker-compose up -d` (creates pgvector extension automatically).  
4) Push schema: `npm run db:push` (uses `drizzle.config.ts`).  
5) Run dev server: `npm run dev` and open http://localhost:3000.  
6) Run worker: `npm run worker` (set `DOC_ID=<id>` to process a specific document marked `processing`).

## Configuration
- Env: `.env.example` documents required values. `DATABASE_URL` (Postgres + pgvector), `OPENAI_API_KEY` (chat + embeddings; offline deterministic fallback if missing), `UPLOAD_SECRET` (signs upload tokens; change in prod), optional `DOC_ID` (to target a document when running the worker manually). OCR is not implemented.
- Database: Postgres 16 + pgvector via docker-compose. Schema uses 1536-dim vectors (sized for `text-embedding-3-large`). Migrations live in `drizzle/migrations`; run `npm run db:push` to sync.
- Limits & uploads: Only PDFs are supported. Max upload size 50 MB enforced at init/chunk/complete; user-facing error is “max upload size exceeded.” Upload tokens expire after 1 hour and write to `tmp/uploads` before being moved to `tmp/files`; both are ignored by git.
- Chunking: Hybrid paragraph chunking targets ~600–1400 characters. Page ranges are stored per chunk and used for metadata and retrieval.

## Scripts
- `npm run dev` - Next.js dev server
- `npm run lint` - Next.js lint
- `npm run db:push` - Push Drizzle schema to Postgres
- `npm run worker` - Run the worker entrypoint at `worker/index.ts`

## Processing flow
- Upload API: `/api/upload/{init|chunk|complete}` issues signed tokens (`UPLOAD_SECRET`), writes chunks to `tmp/uploads`, and moves the final PDF to `tmp/files`. Upload init resets chat history for the session.
- Processing: `/api/upload/complete` marks the document `processing` and kicks off `worker/process-document.ts` in-process (fire-and-forget). The CLI worker (`npm run worker`) can also process the oldest `processing` doc when run.
- Extraction & storage: `processDocument` loads the PDF in-process via pdf.js (workers disabled), extracts text-only (no OCR), chunks paragraphs, embeds (OpenAI if available; deterministic fallback otherwise), writes chunks + metadata to pgvector, marks the doc `ready`, and makes it the session’s active doc. The previous active doc (and its chunks) is deleted to keep one active doc per session. Starting a new upload resets chat history for that session.

## Known constraints
- pdf.js is forced into an in-process mode (workers disabled) which can block the Node runtime on large PDFs; consider moving heavy processing to a dedicated worker/queue if needed.
- Text-only extraction: images and scanned PDFs are not OCR’d.
- Processing is fire-and-forget from the API route; there is no queue/backpressure, so run the worker separately for more control.
- Upload/temp files live under `tmp/`; recent code attempts cleanup on reset and stale-doc cleanup, but large ingestion may still need manual cleanup.
- Docker data persists in the `postgres_data` volume; remove it for a clean slate.
