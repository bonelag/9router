import { HTTP_STATUS, RESPONSES_RECOVERY_CONFIG } from "../config/runtimeConfig.js";
import {
  RESPONSES_STATE_FIELDS, RESPONSES_ENCRYPTED_FIELDS, RESPONSES_ITEM_STATE_FIELDS,
  RESPONSES_BACKEND_ERROR_PATTERNS, RESPONSES_STATE_ERROR_CODES,
  RESPONSES_SETUP_EVENTS, RESPONSES_CALL_OUTPUT_TYPES, RESPONSES_CALL_TYPES,
} from "../config/responsesRecovery.js";
import { RESPONSES_ITEM } from "../translator/schema/blocks.js";
import { RESPONSES_EVENT } from "../translator/schema/streamEvents.js";
import { RESPONSES_STATUS } from "../translator/schema/finishReasons.js";
import { createResponsesFrameParser } from "../utils/responsesStreamHelpers.js";
import { reconstructStream } from "./emptyFailover.js";
import { materializeResponsesHistory } from "./responsesHistory.js";

function errorFields(payload, fallback = "") {
  const error = payload?.error ?? payload?.response?.error;
  if (typeof error === "string") return { message: error, code: "" };
  return {
    message: typeof error?.message === "string" ? error.message : fallback,
    code: String(error?.code || error?.type || "").toLowerCase(),
    status: Number(error?.status_code || error?.status || payload?.status_code),
  };
}

function hasItemState(body) {
  return Array.isArray(body?.input) && body.input.some((item) => item && (
    item.type === RESPONSES_ITEM.ITEM_REFERENCE || typeof item.id === "string"
    || RESPONSES_ENCRYPTED_FIELDS.some((field) => typeof item[field] === "string" && item[field])
    || [item.content, item.output].some((parts) => Array.isArray(parts) && parts.some((part) => part?.type === RESPONSES_ITEM.ENCRYPTED_CONTENT || RESPONSES_ENCRYPTED_FIELDS.some((field) => part?.[field])))
  ));
}

function hasState(body) {
  return !!body?.previous_response_id || hasItemState(body);
}

export function isResponsesBackendChangeError(status, payload, request, fallbackText = "", event = "") {
  const error = errorFields(payload, fallbackText);
  let effectiveStatus = status;
  if (status === 200) {
    const failed = event === RESPONSES_EVENT.FAILED || event === RESPONSES_EVENT.ERROR
      || payload?.status === RESPONSES_STATUS.FAILED || payload?.response?.status === RESPONSES_STATUS.FAILED;
    if (!failed) return false;
    effectiveStatus = RESPONSES_STATE_ERROR_CODES.get(error.code) || error.status;
  }
  if (!hasState(request)) return false;
  return RESPONSES_BACKEND_ERROR_PATTERNS.some((pattern) => (
    pattern.statuses.includes(effectiveStatus) && pattern.message.test(error.message)
    && (!pattern.code || error.code === pattern.code)
    && (pattern.reference !== "response" || !!request.previous_response_id)
    && (pattern.reference !== "item" || hasItemState(request))
  ));
}

export function buildResponsesRecoveryBody(body, context) {
  const request = context?.request ? JSON.parse(context.request) : body;
  const materialized = materializeResponsesHistory(request, context);
  if (!materialized?.complete) return null;
  const clean = JSON.parse(JSON.stringify(body));
  for (const field of RESPONSES_STATE_FIELDS) delete clean[field];
  clean.input = materialized.history.filter((item) => item?.type !== RESPONSES_ITEM.REASONING).map((item) => {
    if (!item || typeof item !== "object") return item;
    const copy = { ...item };
    for (const field of [...RESPONSES_ITEM_STATE_FIELDS, ...RESPONSES_ENCRYPTED_FIELDS]) delete copy[field];
    for (const field of ["content", "output"]) {
      if (!Array.isArray(copy[field])) continue;
      copy[field] = copy[field].filter((part) => part?.type !== RESPONSES_ITEM.ENCRYPTED_CONTENT).map((part) => {
        if (!part || typeof part !== "object") return part;
        const content = { ...part };
        for (const encrypted of RESPONSES_ENCRYPTED_FIELDS) delete content[encrypted];
        return content;
      });
    }
    return copy;
  });
  // Never invent or orphan a function/custom-tool call after resolving history.
  const calls = new Map();
  for (const item of clean.input) {
    if (RESPONSES_CALL_TYPES.has(item?.type)) calls.set(item.call_id, item.type);
    const expected = RESPONSES_CALL_OUTPUT_TYPES.get(item?.type);
    if (expected && (!item.call_id || calls.get(item.call_id) !== expected)) return null;
  }
  return clean;
}

function replayResponse(response, head, reader, pendingRead) {
  return new Response(reconstructStream(head, reader, pendingRead), {
    status: response.status, statusText: response.statusText, headers: response.headers,
  });
}

// Pull at most one upstream chunk at a time. On a deadline or byte cap, return
// the still-pending read to the replay stream instead of losing/canceling data.
export async function inspectResponsesBackendError(response, request, {
  signal, timeoutMs = RESPONSES_RECOVERY_CONFIG.primeTimeoutMs,
  maxBytes = RESPONSES_RECOVERY_CONFIG.maxInspectBytes,
} = {}) {
  if (!response.body || (!response.ok && response.status !== HTTP_STATUS.BAD_REQUEST && response.status !== HTTP_STATUS.NOT_FOUND)) return { response };
  const isSse = (response.headers.get("content-type") || "").toLowerCase().includes("text/event-stream");
  const reader = response.body.getReader();
  const head = [];
  const parser = createResponsesFrameParser(maxBytes);
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  let pendingRead = null;
  let timer;
  let abortListener;
  const deadline = new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
  const aborted = new Promise((_, reject) => {
    abortListener = () => reject(signal?.reason || new DOMException("Request aborted", "AbortError"));
    signal?.addEventListener("abort", abortListener, { once: true });
  });
  const finish = (error = false) => ({ response: replayResponse(response, head, reader, pendingRead), error });
  const inspectRawBody = () => {
    text += decoder.decode();
    let payload;
    try { payload = JSON.parse(text); } catch { /* plain-text or real SSE body */ }
    return isResponsesBackendChangeError(response.status, payload, request, text);
  };
  const inspectFrame = ({ event, data }) => {
    if (isResponsesBackendChangeError(response.status, data, request, "", event)) return "error";
    if (data.error || data.response?.error || event === RESPONSES_EVENT.FAILED || event === RESPONSES_EVENT.ERROR) return "commit";
    if (RESPONSES_SETUP_EVENTS.has(event)) return null;
    // Reasoning is safe to discard on a verified error, but meaningful output
    // or a tool action commits the stream and can never be silently replayed.
    if (event === RESPONSES_EVENT.OUTPUT_ITEM_ADDED && data.item?.type === RESPONSES_ITEM.REASONING) return null;
    if (event.startsWith("response.reasoning")) return null;
    return "commit";
  };
  try {
    if (signal?.aborted) throw signal.reason || new DOMException("Request aborted", "AbortError");
    while (true) {
      pendingRead ||= reader.read();
      const result = await Promise.race([pendingRead, deadline, aborted]);
      if (result === null) return finish();
      pendingRead = null;
      if (result.done) {
        if (isSse) {
          for (const frame of parser.finish()) {
            const decision = inspectFrame(frame);
            if (decision) return finish(decision === "error");
          }
        }
        // Some OpenAI-compatible gateways return a bare JSON error while keeping
        // `text/event-stream`. If no SSE frame committed the stream, inspect the
        // original bytes as JSON/plain text before passing the response through.
        return finish(inspectRawBody());
      }
      head.push(result.value);
      bytes += result.value.byteLength;
      if (bytes > maxBytes) return finish();
      text += decoder.decode(result.value, { stream: true });
      if (isSse) {
        for (const frame of parser.push(result.value)) {
          const decision = inspectFrame(frame);
          if (decision) return finish(decision === "error");
        }
      }
    }
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortListener);
  }
}

export async function recoverResponsesUpstream({ result, body, context, execute, signal, log, config = RESPONSES_RECOVERY_CONFIG }) {
  const request = context?.request ? JSON.parse(context.request) : body;
  if (!config.enabled || context?.attempted || !hasState(request)) return result;
  const inspected = await inspectResponsesBackendError(result.response, request, {
    signal, timeoutMs: config.primeTimeoutMs, maxBytes: config.maxInspectBytes,
  });
  const original = { ...result, response: inspected.response };
  if (!inspected.error) return original;
  const recoveryBody = buildResponsesRecoveryBody(body, context);
  if (!recoveryBody) {
    log?.warn?.("RESPONSES", "Backend state mismatch; complete replay history is unavailable, preserving the upstream error");
    return original;
  }
  if (context) context.attempted = true;
  await inspected.response.body?.cancel().catch(() => {});
  log?.info?.("RESPONSES", "Verified backend state mismatch; retrying once with preserved message/tool history");
  const recovered = await execute(recoveryBody);
  return { ...recovered, recoveryBody };
}
