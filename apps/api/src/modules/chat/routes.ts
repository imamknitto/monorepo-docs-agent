import { Hono, type Context } from "hono";
import { agentToClientStream } from "@anvia/client";
import { createClientStreamResponse } from "@anvia/server";
import { NotConfiguredError } from "@halodocs/agent";
import { sessionUserId } from "../../config.js";
import { loadSession, type AuthVariables } from "../auth/middleware.js";
import { getDocStatus } from "../documents/store.js";
import {
  clearHistory,
  loadUiHistory,
  streamAgentAnswer,
  toClientError,
} from "./service.js";
import { parseChatQuestion, readChatScope } from "./utils.js";

const chatRoutes = new Hono<{ Variables: AuthVariables }>();

// Resolve the session once per request: a logged-in user's identity (`u:<id>`)
// takes precedence over the guest fingerprint header.
chatRoutes.use("/*", loadSession);

/** Server-derived identity for chat memory, or null for guests. */
function chatIdentity(c: Context<{ Variables: AuthVariables }>): string | null {
  const user = c.get("user");
  return user ? sessionUserId(user.id) : null;
}

chatRoutes.get("/chat/:docId/:sessionId", async (c) => {
  const scope = readChatScope(
    c.req.param("docId"),
    c.req.param("sessionId"),
    c.req.header("x-user-id"),
    chatIdentity(c),
  );
  if (!scope.ok) return c.json({ detail: scope.detail }, scope.status);
  try {
    const messages = await loadUiHistory(scope.sessionId, scope.userId);
    return c.json({ sessionId: scope.sessionId, messages });
  } catch (err) {
    if (err instanceof NotConfiguredError) {
      return c.json({ detail: err.message }, 503);
    }
    throw err;
  }
});

chatRoutes.delete("/chat/:docId/:sessionId", async (c) => {
  const scope = readChatScope(
    c.req.param("docId"),
    c.req.param("sessionId"),
    c.req.header("x-user-id"),
    chatIdentity(c),
  );
  if (!scope.ok) return c.json({ detail: scope.detail }, scope.status);
  try {
    await clearHistory(scope.sessionId, scope.userId);
    return c.json({ sessionId: scope.sessionId, cleared: true });
  } catch (err) {
    if (err instanceof NotConfiguredError) {
      return c.json({ detail: err.message }, 503);
    }
    throw err;
  }
});

chatRoutes.post("/chat/:docId/:sessionId", async (c) => {
  const scope = readChatScope(
    c.req.param("docId"),
    c.req.param("sessionId"),
    c.req.header("x-user-id"),
    chatIdentity(c),
  );
  if (!scope.ok) return c.json({ detail: scope.detail }, scope.status);

  const parsed = parseChatQuestion(await c.req.json().catch(() => null));
  if (!parsed.ok) return c.json({ detail: parsed.detail }, parsed.status);

  const status = await getDocStatus(scope.docId);
  if (!status.found || !status.isProcessed) {
    return c.json(
      { detail: "Document is still indexing, try again shortly." },
      503,
    );
  }

  return createClientStreamResponse({
    events: agentToClientStream({
      events: streamAgentAnswer(
        scope.docId,
        scope.sessionId,
        scope.userId,
        parsed.question,
        status.summary,
      ),
      mapError: (error) => {
        console.error(
          `[chat:answer] doc=${scope.docId} session=${scope.sessionId} stream error`,
          error instanceof Error ? (error.stack ?? error.message) : error,
        );
        return toClientError(error);
      },
    }),
    format: "jsonl",
    headers: { "cache-control": "no-cache", "x-accel-buffering": "no" },
  });
});

export { chatRoutes };
