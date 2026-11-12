import { createHash } from "node:crypto";
import { RESPONSES_RECOVERY_CONFIG } from "../config/runtimeConfig.js";
import { RESPONSES_STATE_FIELDS, RESPONSES_FINGERPRINT_OMIT_FIELDS } from "../config/responsesRecovery.js";
import { RESPONSES_ITEM, ROLE } from "../translator/schema/index.js";
import { RESPONSES_EVENT } from "../translator/schema/streamEvents.js";
import { RESPONSES_STATUS } from "../translator/schema/finishReasons.js";
import { createResponsesFrameParser } from "../utils/responsesStreamHelpers.js";

const encoder = new TextEncoder();
const inputItems = (input) => typeof input === "string"
  ? [{ type: RESPONSES_ITEM.MESSAGE, role: ROLE.USER, content: input }]
  : Array.isArray(input) ? input : input == null ? [] : null;

export class ResponsesHistoryCache {
  constructor(config = RESPONSES_RECOVERY_CONFIG, now = Date.now) {
    this.config = config;
    this.now = now;
    this.entries = new Map();
    this.bytes = 0;
  }

  remove(key) {
    const entry = this.entries.get(key);
    if (entry) { this.bytes -= entry.bytes; this.entries.delete(key); }
  }

  getSerialized(scope, id) {
    const key = `${scope}:${id}`;
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) { this.remove(key); return null; }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.serialized;
  }

  get(scope, id) {
    const serialized = this.getSerialized(scope, id);
    return serialized ? JSON.parse(serialized) : null;
  }

  set(scope, id, record) {
    if (typeof id !== "string" || !id || record.history.length > this.config.historyMaxItems) return false;
    const serialized = JSON.stringify(record);
    const bytes = encoder.encode(serialized).byteLength;
    if (bytes > this.config.historyMaxEntryBytes || bytes > this.config.historyMaxBytes) return false;
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= this.now()) this.remove(key);
    }
    const key = `${scope}:${id}`;
    this.remove(key);
    while (this.entries.size >= this.config.historyMaxEntries || this.bytes + bytes > this.config.historyMaxBytes) {
      this.remove(this.entries.keys().next().value);
    }
    this.entries.set(key, { scope, serialized, bytes, expiresAt: this.now() + this.config.historyTtlMs });
    this.bytes += bytes;
    return true;
  }

  findItems(scope, ids) {
    const remaining = new Set(ids);
    const found = new Map();
    for (const [key, entry] of [...this.entries].reverse()) {
      if (!remaining.size) break;
      if (entry.expiresAt <= this.now()) { this.remove(key); continue; }
      if (entry.scope !== scope) continue;
      for (const item of JSON.parse(entry.serialized).history) {
        if (item?.type !== RESPONSES_ITEM.ITEM_REFERENCE && remaining.has(item?.id)) {
          found.set(item.id, item);
          remaining.delete(item.id);
        }
      }
    }
    return found;
  }

  clear() { this.entries.clear(); this.bytes = 0; }
}

// Keep only bounded serialized snapshots, including across Next development reloads.
const cacheKey = Symbol.for("9router.responsesHistoryCache");
export const responsesHistoryCache = globalThis[cacheKey] ??= new ResponsesHistoryCache();

export function createResponsesHistoryContext(body, apiKey = "", cache = responsesHistoryCache) {
  if (!cache.config.enabled || !body || typeof body !== "object" || Array.isArray(body)) return null;
  const input = inputItems(body.input);
  if (!input) return null;
  const scope = createHash("sha256").update(apiKey ? `key:${apiKey}` : "local").digest("hex");
  const request = { input, conversation: body.conversation };
  for (const field of RESPONSES_STATE_FIELDS) {
    if (body[field] !== undefined) request[field] = body[field];
  }
  const serialized = JSON.stringify(request);
  const bounded = encoder.encode(serialized).byteLength <= cache.config.historyMaxEntryBytes;
  return {
    scope, cache,
    request: bounded ? serialized : null,
    parent: body.previous_response_id ? cache.getSerialized(scope, body.previous_response_id) : null,
  };
}

// Canonical comparison is only for avoiding duplicated replay prefixes. The
// actual message (including phase, media, annotations and tool data) is retained.
function fingerprint(item) {
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== "object") return value;
    const normalized = { ...value };
    if (normalized.role && !normalized.type) normalized.type = RESPONSES_ITEM.MESSAGE;
    if (normalized.type === RESPONSES_ITEM.OUTPUT_TEXT) normalized.type = RESPONSES_ITEM.INPUT_TEXT;
    if (typeof normalized.content === "string") normalized.content = [{ type: RESPONSES_ITEM.INPUT_TEXT, text: normalized.content }];
    return Object.fromEntries(Object.keys(normalized).sort().filter((key) => !RESPONSES_FINGERPRINT_OMIT_FIELDS.has(key)).map((key) => [key, canonical(normalized[key])]));
  };
  return JSON.stringify(canonical(item));
}

function mergeHistory(previous, current) {
  const old = previous.filter((item) => item?.type !== RESPONSES_ITEM.REASONING);
  const next = current.filter((item) => item?.type !== RESPONSES_ITEM.REASONING);
  const oldPrints = old.map(fingerprint);
  const nextPrints = next.map(fingerprint);
  let overlap = Math.min(old.length, next.length);
  while (overlap && !oldPrints.slice(-overlap).every((value, i) => value === nextPrints[i])) overlap--;
  return [...old, ...next.slice(overlap)];
}

// A client may already replay the complete visible transcript while also
// carrying a stale previous_response_id. Treat it as self-contained only when
// it contains a prior model/tool output followed by a new user/tool result.
// A lone new message still requires the cached parent and remains fail-closed.
function hasSelfContainedReplay(input) {
  let hasPriorOutput = false;
  for (const item of input) {
    if (!item || typeof item !== "object" || item.type === RESPONSES_ITEM.ITEM_REFERENCE) continue;
    const isAssistant = item.type === RESPONSES_ITEM.MESSAGE && item.role === ROLE.ASSISTANT;
    const isCall = item.type === RESPONSES_ITEM.FUNCTION_CALL || item.type === RESPONSES_ITEM.CUSTOM_TOOL_CALL;
    if (isAssistant || isCall) {
      hasPriorOutput = true;
      continue;
    }
    const isUser = item.type === RESPONSES_ITEM.MESSAGE && item.role === ROLE.USER;
    const isCallOutput = item.type === RESPONSES_ITEM.FUNCTION_CALL_OUTPUT || item.type === RESPONSES_ITEM.CUSTOM_TOOL_CALL_OUTPUT;
    if (hasPriorOutput && (isUser || isCallOutput)) return true;
  }
  return false;
}

export function materializeResponsesHistory(request, context) {
  const input = inputItems(request.input);
  if (!input) return null;
  // Conversations are independently persisted server objects. This cache has
  // no proof that it has their complete history, so never flatten them silently.
  let complete = !request.conversation;
  let previous = [];
  if (request.previous_response_id) {
    const parent = context?.parent
      ? JSON.parse(context.parent)
      : context?.cache.get(context.scope, request.previous_response_id);
    if (parent?.complete) previous = parent.history;
    else complete = complete && hasSelfContainedReplay(input);
  }
  const ids = input.filter((item) => item?.type === RESPONSES_ITEM.ITEM_REFERENCE).map((item) => item.id);
  const known = new Map(previous.filter((item) => item?.id).map((item) => [item.id, item]));
  for (const item of input) {
    if (item?.id && item.type !== RESPONSES_ITEM.ITEM_REFERENCE) known.set(item.id, item);
  }
  const missing = ids.filter((id) => !known.has(id));
  if (missing.length && context) {
    for (const [id, item] of context.cache.findItems(context.scope, missing)) known.set(id, item);
  }
  const expanded = input.map((item) => {
    if (item?.type !== RESPONSES_ITEM.ITEM_REFERENCE) return item;
    if (!known.has(item.id)) { complete = false; return item; }
    return known.get(item.id);
  });
  return { complete, history: mergeHistory(previous, expanded) };
}

function recordResponse(context, response) {
  if (!response?.id || response.error || (response.status && response.status !== RESPONSES_STATUS.COMPLETED) || !Array.isArray(response.output)) return;
  const request = JSON.parse(context.request);
  const input = materializeResponsesHistory(request, context);
  if (!input) return;
  // Retain the reasoning item's identity for explicit reference resolution,
  // without keeping its encrypted or hidden content in the recovery cache.
  const output = response.output.map((item) => item?.type === RESPONSES_ITEM.REASONING
    ? { type: RESPONSES_ITEM.REASONING, ...(item.id ? { id: item.id } : {}) }
    : item);
  context.cache.set(context.scope, response.id, { complete: input.complete, history: [...input.history, ...output] });
}

// Observe the client-format response through a single pull-driven reader.
// There is no tee, background producer, eager drain, or unbounded chunk queue.
export function observeResponsesResponse(response, context) {
  if (!context?.request || !response?.ok || !response.body) return response;
  const isSse = (response.headers.get("content-type") || "").includes("text/event-stream");
  const reader = response.body.getReader();
  const parser = createResponsesFrameParser(context.cache.config.historyMaxEntryBytes);
  const decoder = new TextDecoder();
  let jsonText = "";
  let observedBytes = 0;
  let disabled = false;
  let responseId = null;
  const outputItems = new Map();

  const observeFrame = ({ event, data }) => {
    responseId = data.response?.id || responseId;
    if (event === RESPONSES_EVENT.OUTPUT_ITEM_DONE && data.item) outputItems.set(data.output_index, data.item);
    if (event === RESPONSES_EVENT.COMPLETED) {
      recordResponse(context, {
        ...data.response,
        id: data.response?.id || responseId,
        output: data.response?.output?.length ? data.response.output : [...outputItems].sort(([a], [b]) => a - b).map(([, item]) => item),
      });
    }
  };

  const body = new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (done) {
          if (!disabled) {
            if (isSse) parser.finish().forEach(observeFrame);
            else {
              try { recordResponse(context, JSON.parse(jsonText + decoder.decode())); } catch { /* not a Responses JSON body */ }
            }
          }
          controller.close();
          return;
        }
        observedBytes += value.byteLength;
        if (observedBytes > context.cache.config.historyMaxEntryBytes) { disabled = true; jsonText = ""; outputItems.clear(); }
        if (!disabled) {
          try {
            if (isSse) parser.push(value).forEach(observeFrame);
            else jsonText += decoder.decode(value, { stream: true });
          } catch { disabled = true; } // diagnostics must never break a response
        }
        controller.enqueue(value);
      } catch (error) { controller.error(error); }
    },
    cancel(reason) { return reader.cancel(reason); },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}
