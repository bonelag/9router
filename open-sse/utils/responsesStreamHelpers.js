// Helpers for OpenAI Responses API streaming termination + event framing
import { FORMATS } from "../translator/formats.js";
import { formatSSE } from "./streamHelpers.js";
import { RESPONSES_SSE_FRAME_SEPARATOR, RESPONSES_SSE_DONE } from "../config/responsesRecovery.js";
import { RESPONSES_RECOVERY_CONFIG } from "../config/runtimeConfig.js";

// Shared framing for recovery inspection and history capture. The original
// bytes are always forwarded; parsing only observes complete SSE frames.
export function createResponsesFrameParser(maxBufferChars = RESPONSES_RECOVERY_CONFIG.historyMaxEntryBytes) {
  const decoder = new TextDecoder();
  let buffer = "";
  let disabled = false;

  const parse = (frame) => {
    let event = "";
    const data = [];
    for (const line of frame.split(/\r\n|\n|\r/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    const text = data.join("\n").trim();
    if (!text || text === RESPONSES_SSE_DONE) return null;
    try {
      const obj = JSON.parse(text);
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
      return { event: event || obj.type || "", data: obj };
    } catch { return null; }
  };

  return {
    push(chunk) {
      if (disabled) return [];
      buffer += decoder.decode(chunk, { stream: true });
      if (buffer.length > maxBufferChars) { disabled = true; buffer = ""; return []; }
      const frames = [];
      let separator;
      while ((separator = RESPONSES_SSE_FRAME_SEPARATOR.exec(buffer))) {
        const parsed = parse(buffer.slice(0, separator.index));
        buffer = buffer.slice(separator.index + separator[0].length);
        if (parsed) frames.push(parsed);
      }
      return frames;
    },
    finish() {
      if (disabled) return [];
      buffer += decoder.decode();
      const parsed = parse(buffer);
      buffer = "";
      return parsed ? [parsed] : [];
    },
  };
}

// Responses API events that signal the stream has reached a terminal state
const OPENAI_RESPONSES_TERMINAL_EVENTS = new Set([
  "response.completed",
  "response.done",
  "response.failed",
  "error"
]);

export function getOpenAIResponsesEventName(eventName, chunk) {
  if (eventName) return eventName;
  if (chunk && typeof chunk.type === "string") return chunk.type;
  return null;
}

export function isOpenAIResponsesTerminalEvent(eventName, chunk) {
  const type = getOpenAIResponsesEventName(eventName, chunk);
  if (OPENAI_RESPONSES_TERMINAL_EVENTS.has(type)) return true;
  const status = chunk?.response?.status;
  return status === "completed" || status === "failed";
}

const sharedEncoder = new TextEncoder();

// Encoded response.failed + [DONE] payload for aborted/stalled Responses passthrough streams
export function buildAbortedResponsesTerminalBytes() {
  return sharedEncoder.encode(`${formatIncompleteOpenAIResponsesStreamFailure()}data: [DONE]\n\n`);
}

// Synthesize a response.failed event for streams that close without a terminal event
export function formatIncompleteOpenAIResponsesStreamFailure() {
  return formatSSE({
    event: "response.failed",
    data: {
      type: "response.failed",
      response: {
        id: `resp_${Date.now()}`,
        status: "failed",
        error: {
          type: "stream_error",
          code: "stream_disconnected",
          message: "stream closed before response.completed"
        }
      }
    }
  }, FORMATS.OPENAI_RESPONSES);
}
