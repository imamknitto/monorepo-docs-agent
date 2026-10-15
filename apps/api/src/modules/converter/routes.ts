import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { DOC_ID_RE, MAX_UPLOAD_BYTES } from "../../config.js";
import { stripImageBytes } from "../documents/artifacts.js";
import {
  cancelConversionJob,
  convertDocument,
  getConversionJob,
  startConversion,
} from "./service.js";
import { parseConvertForm } from "./utils.js";

const converterRoutes = new Hono();

converterRoutes.use(
  "/convert*",
  bodyLimit({ maxSize: MAX_UPLOAD_BYTES + 1024 * 1024 }),
);

/** Sync conversion: returns result directly */
converterRoutes.post("/convert", async (c) => {
  const requestId = c.get("requestId") as string | undefined;
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ detail: "Invalid multipart body." }, 400);
  }
  const upload = parseConvertForm(form);
  if (!upload.ok) return c.json({ detail: upload.detail }, upload.status);

  const result = await convertDocument(upload, requestId);
  if (result.type === "timeout") {
    return c.json(
      {
        detail:
          "Conversion timed out. The file is likely large — retry with async mode or turn off image OCR.",
        code: "convert_timeout",
      },
      504,
    );
  }
  if (result.type === "unavailable" || result.type === "upstream-failed") {
    return c.json(
      {
        detail:
          result.type === "upstream-failed"
            ? "Conversion failed upstream."
            : "Conversion service unavailable.",
      },
      502,
    );
  }
  if (result.type === "passthrough") return result.response;
  if (result.type === "bad-json") {
    return c.json({ detail: "Conversion response was not JSON." }, 502);
  }
  if (result.type === "store-failed") {
    return c.json({ detail: result.detail }, result.status);
  }
  return c.json(stripImageBytes(result.payload));
});

/** Async conversion: returns 202 immediately, client polls GET /v1/convert/jobs/:jobId */
converterRoutes.post("/convert/jobs", async (c) => {
  const requestId = c.get("requestId") as string | undefined;
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ detail: "Invalid multipart body." }, 400);
  }
  const upload = parseConvertForm(form);
  if (!upload.ok) return c.json({ detail: upload.detail }, upload.status);

  const result = await startConversion(upload, requestId);
  if (result.type === "unavailable") {
    return c.json({ detail: "Conversion service unavailable." }, 502);
  }
  if (result.type === "queue-full") {
    return c.json(
      {
        detail: "Conversion queue is full, try again shortly.",
        code: "convert_queue_full",
      },
      429,
    );
  }
  if (result.type === "upstream-failed") {
    return c.json({ detail: "Conversion failed upstream." }, 502);
  }
  return result.response;
});

/** Get async job status */
converterRoutes.get("/convert/jobs/:jobId", async (c) => {
  const jobId = c.req.param("jobId");
  if (!DOC_ID_RE.test(jobId)) return c.json({ detail: "Invalid job id." }, 400);
  const result = await getConversionJob(
    jobId,
    c.get("requestId") as string | undefined,
  );
  if (result.type === "not-found") {
    return c.json({ detail: "Job not found or expired." }, 404);
  }
  if (result.type === "unavailable") {
    return c.json({ detail: "Conversion service unavailable." }, 502);
  }
  if (result.type === "bad-json") {
    return c.json({ detail: "Conversion response was not JSON." }, 502);
  }
  if (result.type === "store-failed") {
    return c.json({ detail: result.detail }, result.status);
  }
  return c.json(stripImageBytes(result.job));
});

/** Cancel async job (queued or processing) */
converterRoutes.delete("/convert/jobs/:jobId", async (c) => {
  const jobId = c.req.param("jobId");
  if (!DOC_ID_RE.test(jobId)) return c.json({ detail: "Invalid job id." }, 400);
  const result = await cancelConversionJob(jobId);
  if (result.type === "not-found") {
    return c.json({ detail: "Job not found or expired." }, 404);
  }
  if (result.type === "conflict") {
    return c.json({ detail: "Cannot cancel completed or failed job." }, 409);
  }
  if (result.type === "unavailable") {
    return c.json({ detail: "Conversion service unavailable." }, 502);
  }
  return result.response;
});

export { converterRoutes };
