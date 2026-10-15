import { parseClientStreamRequest } from "@anvia/client";
import { DOC_ID_RE, USER_ID_RE, parseSessionId } from "../../config.js";
import { lastUserText } from "./service.js";

function readUserId(header: string | undefined): string | null {
  const raw = header?.trim();
  if (!raw || !USER_ID_RE.test(raw)) return null;
  return raw;
}

export type ChatScope =
  | { ok: true; docId: string; sessionId: string; userId: string }
  | { ok: false; status: 400 | 404; detail: string };

/** Path + fingerprint checks shared by chat session routes. */
export function readChatScope(
  docId: string,
  sessionId: string,
  userIdHeader: string | undefined,
): ChatScope {
  if (!DOC_ID_RE.test(docId)) {
    return { ok: false, status: 404, detail: "Invalid doc_id." };
  }
  const sess = parseSessionId(docId, sessionId);
  if (!sess.ok) return { ok: false, status: 400, detail: sess.detail };
  const userId = readUserId(userIdHeader);
  if (!userId) {
    return {
      ok: false,
      status: 400,
      detail: "Missing or invalid x-user-id header.",
    };
  }
  return { ok: true, docId, sessionId, userId };
}

export type ParsedQuestion =
  | { ok: true; question: string }
  | { ok: false; status: 400 | 422; detail: string };

/** Latest user text from a client-protocol stream body. */
export function parseChatQuestion(body: unknown): ParsedQuestion {
  try {
    const parsed = parseClientStreamRequest(body);
    if (parsed.type !== "messages") {
      return {
        ok: false,
        status: 400,
        detail: "Only message streams are supported.",
      };
    }
    const question = lastUserText(parsed.messages);
    if (!question) {
      return {
        ok: false,
        status: 422,
        detail: 'Field "question" is required.',
      };
    }
    if (question.length > 2000) {
      return {
        ok: false,
        status: 422,
        detail: 'Field "question" exceeds 2000 characters.',
      };
    }
    return { ok: true, question };
  } catch {
    return { ok: false, status: 422, detail: "Invalid stream request." };
  }
}
