import {
  TOKEN_RATE_LIMIT_ERROR_PATTERN,
  TOKEN_RATE_LIMIT_SSE_SETUP_EVENTS,
} from "../config/errorConfig.js";
import { TOKEN_RATE_LIMIT_RETRY_CONFIG } from "../config/runtimeConfig.js";
import {
  RESPONSES_SSE_DONE,
  RESPONSES_SSE_FRAME_SEPARATOR,
} from "../config/responsesRecovery.js";
import { reconstructStream } from "./emptyFailover.js";

const decoderText = (value) => typeof value === "string" ? value : "";

function matchCandidate(value) {
  const candidate = decoderText(value);
  if (!candidate) return null;
  const matched = TOKEN_RATE_LIMIT_ERROR_PATTERN.exec(candidate);
  if (!matched?.groups) return null;
  return {
    model: matched.groups.model,
    region: matched.groups.region,
    rawMessage: candidate.trim() || matched.groups.raw,
  };
}

function matchValue(value, depth = 0) {
  if (depth > 8 || value == null) return null;
  if (typeof value === "string") return matchCandidate(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const matched = matchValue(item, depth + 1);
      if (matched) return matched;
    }
    return null;
  }
  if (typeof value !== "object") return null;

  // Error/message fields first so logs retain the complete upstream message,
  // including provider prefixes and trace identifiers when present.
  for (const key of ["message", "error", "response", "detail"]) {
    if (!(key in value)) continue;
    const matched = matchValue(value[key], depth + 1);
    if (matched) return matched;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (["message", "error", "response", "detail"].includes(key)) continue;
    const matched = matchValue(nested, depth + 1);
    if (matched) return matched;
  }
  return null;
}

export function matchTokenRateLimitError(text) {
  const source = decoderText(text);
  if (!source) return null;

  try {
    const matched = matchValue(JSON.parse(source));
    if (matched) return matched;
  } catch { /* plain text or SSE */ }

  for (const line of source.split(/\r\n|\n|\r/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trimStart();
    try {
      const matched = matchValue(JSON.parse(data));
      if (matched) return matched;
    } catch {
      const matched = matchCandidate(data);
      if (matched) return matched;
    }
  }

  const fallback = matchCandidate(source);
  if (!fallback) return null;
  if (!/[\r\n]/.test(source)) return fallback;
  // Avoid logging an entire multi-frame stream when no structured message was
  // available; the exact matched upstream sentence is the useful raw message.
  const matched = TOKEN_RATE_LIMIT_ERROR_PATTERN.exec(source);
  return { ...fallback, rawMessage: matched?.groups?.raw || fallback.rawMessage };
}

function parseSseFrame(frame) {
  let event = "";
  const dataLines = [];
  for (const line of frame.split(/\r\n|\n|\r/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  const dataText = dataLines.join("\n").trim();
  let data = null;
  if (dataText && dataText !== RESPONSES_SSE_DONE) {
    try { data = JSON.parse(dataText); } catch { /* non-JSON SSE data */ }
  }
  return { event, dataText, data };
}

function isEmptyChatSetup(data) {
  if (!Array.isArray(data?.choices)) return false;
  if (!data.choices.length) return true;
  return data.choices.every((choice) => {
    if (choice?.finish_reason) return false;
    const delta = choice?.delta || choice?.message || {};
    return !(typeof delta.content === "string" && delta.content)
      && !(Array.isArray(delta.content) && delta.content.length)
      && !(typeof delta.reasoning === "string" && delta.reasoning)
      && !(typeof delta.reasoning_content === "string" && delta.reasoning_content)
      && !(typeof delta.output_text === "string" && delta.output_text)
      && !(Array.isArray(delta.tool_calls) && delta.tool_calls.length)
      && !delta.function_call;
  });
}

function inspectSseFrame(frame, responseStatus) {
  const parsed = parseSseFrame(frame);
  const type = parsed.event || parsed.data?.type || "";
  const plainError = typeof parsed.data === "string"
    ? /^\s*(?:\[Error\]|error\s*:|rate limit exceeded\s*:)/i.test(parsed.data)
    : /^\s*(?:\[Error\]|error\s*:|rate limit exceeded\s*:)/i.test(parsed.dataText);
  const errorLike = responseStatus >= 400
    || !!parsed.data?.error
    || !!parsed.data?.response?.error
    || parsed.data?.status === "failed"
    || parsed.data?.response?.status === "failed"
    || /(?:^|\.)(?:error|failed)$/.test(type)
    || plainError;
  const matched = errorLike ? matchTokenRateLimitError(parsed.dataText || frame) : null;
  if (matched) return { decision: "retry", matched };
  if (!parsed.dataText) return { decision: "continue", matched: null };
  if (parsed.dataText === RESPONSES_SSE_DONE) return { decision: "commit", matched: null };
  if (TOKEN_RATE_LIMIT_SSE_SETUP_EVENTS.has(type)) return { decision: "continue", matched: null };
  if (["queued", "in_progress"].includes(parsed.data?.response?.status)) return { decision: "continue", matched: null };
  if (isEmptyChatSetup(parsed.data)) return { decision: "continue", matched: null };
  return { decision: "commit", matched: null };
}

function replayResponse(response, head, reader, pendingRead) {
  return new Response(reconstructStream(head, reader, pendingRead), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function inspectSseResponse(response, { signal, primeTimeoutMs, maxInspectBytes }) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const head = [];
  let buffer = "";
  let bytes = 0;
  let pendingRead = null;
  let timer;
  let abortListener;
  const deadline = new Promise((resolve) => { timer = setTimeout(() => resolve(null), primeTimeoutMs); });
  const aborted = new Promise((_, reject) => {
    abortListener = () => reject(signal?.reason || new DOMException("Request aborted", "AbortError"));
    signal?.addEventListener("abort", abortListener, { once: true });
  });
  const finish = (matched = null) => ({ response: replayResponse(response, head, reader, pendingRead), matched });

  const inspectCompleteFrames = (flush = false) => {
    if (flush) buffer += decoder.decode();
    let sawCommit = false;
    let separator;
    while ((separator = RESPONSES_SSE_FRAME_SEPARATOR.exec(buffer))) {
      const inspected = inspectSseFrame(buffer.slice(0, separator.index), response.status);
      buffer = buffer.slice(separator.index + separator[0].length);
      if (inspected.matched) return inspected;
      if (inspected.decision === "commit") sawCommit = true;
    }
    if (flush && buffer) {
      const inspected = inspectSseFrame(buffer, response.status);
      buffer = "";
      if (inspected.matched) return inspected;
      if (inspected.decision === "commit") sawCommit = true;
    }
    return { decision: sawCommit ? "commit" : "continue", matched: null };
  };

  try {
    if (signal?.aborted) throw signal.reason || new DOMException("Request aborted", "AbortError");
    while (true) {
      pendingRead ||= reader.read();
      const result = await Promise.race([pendingRead, deadline, aborted]);
      if (result === null) return finish();
      pendingRead = null;
      if (result.done) {
        const inspected = inspectCompleteFrames(true);
        return finish(inspected.matched);
      }
      head.push(result.value);
      bytes += result.value.byteLength;
      if (bytes > maxInspectBytes) return finish();
      buffer += decoder.decode(result.value, { stream: true });
      const inspected = inspectCompleteFrames();
      if (inspected.matched) return finish(inspected.matched);
      if (inspected.decision === "commit") return finish();
    }
  } catch (error) {
    if (signal?.aborted) {
      await reader.cancel(error).catch(() => {});
      throw error;
    }
    // A mid-body socket/read failure is not this retry family's error. Preserve
    // the buffered bytes and the rejected pending read so downstream observes
    // the original stream failure exactly once (no accidental network replay).
    return finish();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortListener);
  }
}

export async function inspectTokenRateLimitResponse(response, {
  signal,
  config = TOKEN_RATE_LIMIT_RETRY_CONFIG,
} = {}) {
  if (!response?.body) return { response, matched: null };
  const contentType = (response.headers?.get?.("content-type") || "").toLowerCase();
  if (contentType.includes("text/event-stream")) {
    return inspectSseResponse(response, {
      signal,
      primeTimeoutMs: config.primeTimeoutMs,
      maxInspectBytes: config.maxInspectBytes,
    });
  }
  if (response.ok && response.status < 400) return { response, matched: null };
  if (typeof response.clone !== "function") return { response, matched: null };
  try {
    const text = await response.clone().text();
    return { response, matched: matchTokenRateLimitError(text) };
  } catch {
    return { response, matched: null };
  }
}

function delayWithSignal(delayMs, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason || new DOMException("Request aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, delayMs);
    const onAbort = () => done(signal.reason || new DOMException("Request aborted", "AbortError"));
    function done(error = null) {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function logIntercept(log, details) {
  if (log?.warn) log.warn("TOKEN_RATE_LIMIT_RETRY", "Intercepted upstream regional token rate limit", details);
  else console.warn(`[TOKEN_RATE_LIMIT_RETRY] ${JSON.stringify(details)}`);
}

export async function retryTokenRateLimitResponse({
  response,
  resend,
  endpoint,
  signal,
  log,
  config = TOKEN_RATE_LIMIT_RETRY_CONFIG,
}) {
  let current = response;
  let completedRetries = 0;

  while (true) {
    const inspected = await inspectTokenRateLimitResponse(current, { signal, config });
    current = inspected.response;
    if (!inspected.matched) {
      return { response: current, matched: completedRetries > 0, exhausted: false, retries: completedRetries };
    }

    if (completedRetries >= config.maxRetries) {
      logIntercept(log, {
        timestamp: new Date().toISOString(),
        endpoint,
        model: inspected.matched.model,
        region: inspected.matched.region,
        attempt: `${config.maxRetries}/${config.maxRetries}`,
        backoffMs: 0,
        exhausted: true,
        rawMessage: inspected.matched.rawMessage,
      });
      return { response: current, matched: true, exhausted: true, retries: completedRetries };
    }

    const retryAttempt = completedRetries + 1;
    const backoffMs = retryAttempt * config.baseDelayMs;
    logIntercept(log, {
      timestamp: new Date().toISOString(),
      endpoint,
      model: inspected.matched.model,
      region: inspected.matched.region,
      attempt: `${retryAttempt}/${config.maxRetries}`,
      backoffMs,
      exhausted: false,
      rawMessage: inspected.matched.rawMessage,
    });

    // Intentionally ignore Retry-After. This retry family has a fixed linear
    // schedule and must replay the exact serialized upstream request.
    await current.body?.cancel("token rate limit retry").catch(() => {});
    await delayWithSignal(backoffMs, signal);
    current = await resend();
    completedRetries = retryAttempt;
  }
}
