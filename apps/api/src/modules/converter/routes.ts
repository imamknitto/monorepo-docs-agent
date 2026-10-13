import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB, DOC_ID_RE } from "../../config.js";
import { converterClient } from "./client.js";
import { getDocumentQueue } from "../../config/queue.js";
import { upsertPendingDoc } from "../../modules/documents/store.js";

function passThrough(res: Response): Response {
  const headers = new Headers();
  for (const key of ["content-type", "content-length", "content-disposition"]) {
    const v = res.headers.get(key);
    if (v) headers.set(key, v);
  }
  return new Response(res.body, { status: res.status, headers });
}

const converterRoutes = new Hono();

// Apply body limit to convert endpoints
converterRoutes.use(
  "/convert*",
  bodyLimit({ maxSize: MAX_UPLOAD_BYTES + 1024 * 1024 }),
);

/** Record a converted doc + enqueue indexing. Idempotent: skips queueing twice. */
async function enqueueIndexing(
  docId: string,
  name: string,
  markdownUrl: string | null,
  stats: unknown,
  reqId?: string,
): Promise<void> {
  if (!DOC_ID_RE.test(docId)) {
    console.warn(
      `[index:enqueue] skipped: invalid doc_id=${docId} req=${reqId ?? "-"}`,
    );
    return;
  }
  // Async jobs are polled repeatedly — don't enqueue twice.
  try {
    const { getDocStatus } = await import("../../modules/documents/store.js");
    const existing = await getDocStatus(docId);
    if (existing.found) return;
  } catch {
    /* status check best-effort; fall through to upsert */
  }
  try {
    const ok = await upsertPendingDoc({
      docId,
      name,
      markdownUrl,
      stats: stats ?? {},
    });
    console.log(
      `[index:enqueue] doc=${docId} upsert=${ok ? "ok" : "SKIPPED(no DATABASE_URL)"} markdownUrl=${markdownUrl ?? "(null)"}`,
    );
    const queue = getDocumentQueue();
    if (!queue) {
      console.error(
        `[index:enqueue] doc=${docId} FAILED queue unavailable (REDIS_URL invalid/unreachable) — worker will never pick this up`,
      );
    } else {
      try {
        const job = await queue.add("index", { docId, name, markdownUrl });
        console.log(`[index:enqueue] doc=${docId} queued job=${job.id}`);
      } catch (err) {
        console.error(
          `[index:enqueue] doc=${docId} FAILED queue.add err=${err instanceof Error ? err.message : String(err)}`,
          err instanceof Error ? err.stack : "",
        );
      }
    }
  } catch (err) {
    console.warn(
      `[index:enqueue] skipped req=${reqId ?? "-"} err=${err instanceof Error ? err.message : String(err)}`,
      err instanceof Error ? err.stack : "",
    );
  }
}

/** Sync conversion: returns result directly */
converterRoutes.post("/convert", async (c) => {
  const requestIdHeader = c.get("requestId") as string | undefined;
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ detail: "Invalid multipart body." }, 400);
  }
  const file = form.get("file");
  const scanImages = form.get("scan_images");
  const extractImages = form.get("extract_images");
  const ocrImages = form.get("ocr_images");
  const ocrScopeRaw = form.get("ocr_scope");
  const ocrScope = ocrScopeRaw === "flowchart" ? "flowchart" : "all";
  const webhookUrl = form.get("webhook_url")?.toString() ?? undefined;

  if (!(file instanceof File))
    return c.json({ detail: 'Field "file" is required.' }, 422);
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return c.json({ detail: "v1 only supports PDF files." }, 400);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return c.json(
      { detail: `File exceeds the ${MAX_UPLOAD_MB} MB limit.` },
      413,
    );
  }

  const out = new FormData();
  out.append("file", file, file.name);
  out.append(
    "scan_images",
    String(scanImages === "true" || scanImages === "on"),
  );
  out.append(
    "extract_images",
    extractImages === null
      ? "true"
      : String(extractImages === "true" || extractImages === "on"),
  );
  out.append("ocr_images", String(ocrImages === "true" || ocrImages === "on"));
  out.append("ocr_scope", ocrScope);
  if (webhookUrl) {
    out.append("webhook_url", webhookUrl);
  }

  let res: Response;
  const convertStarted = Date.now();
  console.log(
    `[convert] start req=${requestIdHeader ?? "-"} file=${file.name} bytes=${file.size}`,
  );
  try {
    res = await converterClient.convertSync(out, undefined, requestIdHeader);
  } catch (err) {
    const elapsed = Date.now() - convertStarted;
    const code =
      (err as { cause?: { code?: string } })?.cause?.code ??
      (err as { code?: string })?.code;
    const name = err instanceof Error ? err.name : "";
    const timedOut =
      name === "TimeoutError" ||
      code === "UND_ERR_HEADERS_TIMEOUT" ||
      code === "UND_ERR_BODY_TIMEOUT";
    console.error(
      `converter ${timedOut ? "timeout" : "unreachable"} ` +
        `req=${requestIdHeader ?? "-"} file=${file.name} bytes=${file.size} ` +
        `elapsed=${elapsed}ms err=${err instanceof Error ? err.message : String(err)}`,
      err,
    );
    if (timedOut) {
      return c.json(
        {
          detail:
            "Conversion timed out. The file is likely large — retry with async mode or turn off image OCR.",
          code: "convert_timeout",
        },
        504,
      );
    }
    console.error("converter unreachable", err);
    return c.json({ detail: "Conversion service unavailable." }, 502);
  }
  console.log(
    `[convert] upstream req=${requestIdHeader ?? "-"} status=${res.status} elapsed=${Date.now() - convertStarted}ms`,
  );
  if (res.status >= 500) {
    console.error("converter error", res.status);
    return c.json({ detail: "Conversion failed upstream." }, 502);
  }

  // Best-effort: record + enqueue indexing without blocking the response.
  if (res.ok) {
    const cloned = res.clone();
    try {
      const meta = (await cloned.json()) as {
        doc_id?: string;
        markdown_url?: string | null;
        stats?: unknown;
      };
      if (meta.doc_id) {
        await enqueueIndexing(
          meta.doc_id,
          file.name,
          meta.markdown_url ?? null,
          meta.stats,
          requestIdHeader,
        );
      }
    } catch (err) {
      console.warn(
        `[index:enqueue] skipped req=${requestIdHeader ?? "-"} err=${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : "",
      );
    }
  }

  return passThrough(res);
});

/** Async conversion: returns 202 immediately, client polls GET /v1/convert/jobs/:jobId */
converterRoutes.post("/convert/jobs", async (c) => {
  const requestIdHeader = c.get("requestId") as string | undefined;
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ detail: "Invalid multipart body." }, 400);
  }
  const file = form.get("file");
  const scanImages = form.get("scan_images");
  const extractImages = form.get("extract_images");
  const ocrImages = form.get("ocr_images");
  const ocrScopeRaw = form.get("ocr_scope");
  const ocrScope = ocrScopeRaw === "flowchart" ? "flowchart" : "all";
  const webhookUrl = form.get("webhook_url")?.toString() ?? undefined;

  if (!(file instanceof File))
    return c.json({ detail: 'Field "file" is required.' }, 422);
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return c.json({ detail: "v1 only supports PDF files." }, 400);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return c.json(
      { detail: `File exceeds the ${MAX_UPLOAD_MB} MB limit.` },
      413,
    );
  }

  const out = new FormData();
  out.append("file", file, file.name);
  out.append(
    "scan_images",
    String(scanImages === "true" || scanImages === "on"),
  );
  out.append(
    "extract_images",
    extractImages === null
      ? "true"
      : String(extractImages === "true" || extractImages === "on"),
  );
  out.append("ocr_images", String(ocrImages === "true" || ocrImages === "on"));
  out.append("ocr_scope", ocrScope);
  if (webhookUrl) {
    out.append("webhook_url", webhookUrl);
  }

  console.log(
    `[convert:async] start req=${requestIdHeader ?? "-"} file=${file.name} bytes=${file.size}`,
  );
  let res: Response;
  try {
    res = await converterClient.convertAsync(out, undefined, requestIdHeader);
  } catch (err) {
    console.error(
      `[convert:async] converter unreachable req=${requestIdHeader ?? "-"} err=${err instanceof Error ? err.message : String(err)}`,
      err,
    );
    return c.json({ detail: "Conversion service unavailable." }, 502);
  }
  if (res.status === 429) {
    return c.json(
      {
        detail: "Conversion queue is full, try again shortly.",
        code: "convert_queue_full",
      },
      429,
    );
  }
  if (res.status >= 500) {
    console.error("[convert:async] converter error", res.status);
    return c.json({ detail: "Conversion failed upstream." }, 502);
  }
  return passThrough(res);
});

/** Get async job status */
converterRoutes.get("/convert/jobs/:jobId", async (c) => {
  const jobId = c.req.param("jobId");
  if (!DOC_ID_RE.test(jobId)) return c.json({ detail: "Invalid job id." }, 400);
  let res: Response;
  try {
    res = await converterClient.getJob(jobId);
  } catch {
    return c.json({ detail: "Conversion service unavailable." }, 502);
  }
  if (res.status === 404)
    return c.json({ detail: "Job not found or expired." }, 404);
  if (!res.ok)
    return c.json({ detail: "Conversion service unavailable." }, 502);

  // Async jobs are only recorded when they finish. Enqueue indexing on the
  // first poll that reports done (idempotent via getDocStatus in
  // enqueueIndexing) — the sync path does this inline after /convert.
  const requestIdHeader = c.get("requestId") as string | undefined;
  const cloned = res.clone();
  try {
    const job = (await cloned.json()) as {
      status?: string;
      doc_id?: string;
      filename?: string | null;
      result?: {
        doc_id?: string;
        markdown_url?: string | null;
        stats?: unknown;
      } | null;
    };
    if (job.status === "done" && job.doc_id) {
      await enqueueIndexing(
        job.doc_id,
        job.filename ?? job.doc_id,
        job.result?.markdown_url ?? null,
        job.result?.stats,
        requestIdHeader,
      );
    }
  } catch (err) {
    console.warn(
      `[index:enqueue] async poll skipped req=${requestIdHeader ?? "-"} err=${err instanceof Error ? err.message : String(err)}`,
      err instanceof Error ? err.stack : "",
    );
  }

  return passThrough(res);
});

/** Cancel async job (queued or processing) */
converterRoutes.delete("/convert/jobs/:jobId", async (c) => {
  const jobId = c.req.param("jobId");
  if (!DOC_ID_RE.test(jobId)) return c.json({ detail: "Invalid job id." }, 400);
  let res: Response;
  try {
    res = await converterClient.cancelJob(jobId);
  } catch {
    return c.json({ detail: "Conversion service unavailable." }, 502);
  }
  if (res.status === 404)
    return c.json({ detail: "Job not found or expired." }, 404);
  if (res.status === 409)
    return c.json({ detail: "Cannot cancel completed or failed job." }, 409);
  if (!res.ok)
    return c.json({ detail: "Conversion service unavailable." }, 502);
  return passThrough(res);
});

export { converterRoutes };
