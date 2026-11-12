import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HTTP_STATUS, RESPONSES_RECOVERY_CONFIG } from "../../open-sse/config/runtimeConfig.js";
import { RESPONSES_ITEM, ROLE } from "../../open-sse/translator/schema/index.js";
import { RESPONSES_EVENT } from "../../open-sse/translator/schema/streamEvents.js";
import {
  ResponsesHistoryCache, createResponsesHistoryContext, observeResponsesResponse,
} from "../../open-sse/services/responsesHistory.js";
import {
  isResponsesBackendChangeError, recoverResponsesUpstream, inspectResponsesBackendError,
} from "../../open-sse/services/responsesRecovery.js";

const encoder = new TextEncoder();
const mismatch = "The requested item was created under a different OpenAI resource. Use the same resource that created the item to access it.";
const key = "test-client-key";
const message = (role, text, extra = {}) => ({ type: RESPONSES_ITEM.MESSAGE, role, content: [{ type: role === ROLE.ASSISTANT ? RESPONSES_ITEM.OUTPUT_TEXT : RESPONSES_ITEM.INPUT_TEXT, text }], ...extra });
const sse = (event, data) => `event: ${event}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`;
const failed = (text = mismatch, code = "invalid_request_error") => sse(RESPONSES_EVENT.FAILED, { type: RESPONSES_EVENT.FAILED, response: { status: "failed", error: { code, message: text } } });
const config = { ...RESPONSES_RECOVERY_CONFIG, enabled: true, primeTimeoutMs: 50 };
const result = (response) => ({ response, url: "https://mock.invalid/v1/responses", headers: {}, transformedBody: null });
let cache;

beforeEach(() => { cache = new ResponsesHistoryCache(config); });
afterEach(() => { vi.useRealTimers(); });

async function remember(input, output, id = "resp_old", apiKey = key) {
  const context = createResponsesHistoryContext({ input }, apiKey, cache);
  const response = new Response(JSON.stringify({ id, status: "completed", output }), { headers: { "content-type": "application/json" } });
  await observeResponsesResponse(response, context).text();
}

async function recover(body, response, execute = vi.fn(async () => result(new Response("ok"))), apiKey = key, customConfig = config) {
  const context = createResponsesHistoryContext(body, apiKey, cache);
  const value = await recoverResponsesUpstream({ result: result(response), body, context, execute, config: customConfig });
  return { value, execute, context };
}

describe("strict backend-change activation", () => {
  const state = { input: [{ type: RESPONSES_ITEM.REASONING, id: "rs_old", encrypted_content: "cipher" }] };
  it.each([HTTP_STATUS.BAD_REQUEST])("recognizes an explicit cross-resource error at %i", (status) => {
    expect(isResponsesBackendChangeError(status, { error: { message: mismatch } }, state)).toBe(true);
  });
  it.each([200, HTTP_STATUS.UNAUTHORIZED, HTTP_STATUS.FORBIDDEN, HTTP_STATUS.RATE_LIMITED, HTTP_STATUS.SERVER_ERROR, HTTP_STATUS.SERVICE_UNAVAILABLE])("rejects mismatched HTTP status %i", (status) => {
    expect(isResponsesBackendChangeError(status, { error: { message: mismatch } }, state)).toBe(false);
  });
  it.each([
    "previous_response_id must be a string", "Model not found", "Invalid input item.id",
    "Exceeded maximum number of images", "Context length exceeded", "Too many requests",
  ])("does not confuse ordinary validation with a backend change: %s", (text) => {
    expect(isResponsesBackendChangeError(HTTP_STATUS.BAD_REQUEST, { error: { message: text } }, state)).toBe(false);
  });
  it("requires a real state-bearing request", () => {
    expect(isResponsesBackendChangeError(HTTP_STATUS.BAD_REQUEST, { error: { message: mismatch } }, { input: "new conversation" })).toBe(false);
  });
  it("requires a known error code on HTTP-200 SSE failures", () => {
    const payload = (code) => ({ response: { status: "failed", error: { code, message: mismatch } } });
    expect(isResponsesBackendChangeError(200, payload("invalid_request_error"), state, "", RESPONSES_EVENT.FAILED)).toBe(true);
    expect(isResponsesBackendChangeError(200, payload("rate_limit_exceeded"), state, "", RESPONSES_EVENT.FAILED)).toBe(false);
    expect(isResponsesBackendChangeError(200, payload(""), state, "", RESPONSES_EVENT.FAILED)).toBe(false);
  });
  it("requires missing-response errors to identify a response reference", () => {
    expect(isResponsesBackendChangeError(404, { error: { message: "No response found with id resp_old" } }, { previous_response_id: "resp_old", input: "next" })).toBe(true);
    expect(isResponsesBackendChangeError(404, { error: { message: "No response found with id resp_old" } }, state)).toBe(false);
  });
  it("only accepts encrypted verification failures with the corresponding error code", () => {
    const error = { message: "The encrypted content could not be verified.", code: "invalid_encrypted_content" };
    expect(isResponsesBackendChangeError(400, { error }, state)).toBe(true);
    expect(isResponsesBackendChangeError(400, { error: { ...error, code: "invalid_request_error" } }, state)).toBe(false);
  });
});

describe("history-preserving recovery", () => {
  it("replays previous messages and correlated tool turns after a backend swap", async () => {
    const first = message(ROLE.USER, "Project: 9router; keep all tests.");
    const assistant = message(ROLE.ASSISTANT, "I will inspect it.", { id: "msg_old", phase: "commentary", status: "completed" });
    const call = { type: RESPONSES_ITEM.FUNCTION_CALL, id: "fc_old", call_id: "call_keep", name: "read_file", arguments: '{"file":"MEMORY.md"}' };
    await remember([first], [assistant, { type: RESPONSES_ITEM.REASONING, id: "rs_old", encrypted_content: "foreign-cipher" }, call]);
    const body = {
      model: "test-model", previous_response_id: "resp_old", reasoning: { effort: "high" },
      input: [{ type: RESPONSES_ITEM.FUNCTION_CALL_OUTPUT, call_id: "call_keep", output: "Project memory", error: false }, message(ROLE.USER, "Continue")],
      tools: [{ type: "function", name: "read_file" }],
    };
    const untouched = structuredClone(body);
    const { value, execute } = await recover(body, new Response(JSON.stringify({ error: { message: mismatch } }), { status: 400 }));
    expect(execute).toHaveBeenCalledTimes(1);
    const replay = execute.mock.calls[0][0];
    expect(replay).not.toHaveProperty("previous_response_id");
    expect(replay.reasoning).toEqual({ effort: "high" });
    expect(replay.input.map((item) => item.type)).toEqual(["message", "message", "function_call", "function_call_output", "message"]);
    expect(replay.input[0]).toEqual(first);
    expect(replay.input[1].phase).toBe("commentary");
    expect(replay.input[2]).toMatchObject({ call_id: "call_keep", name: "read_file", arguments: call.arguments });
    expect(replay.input[3]).toMatchObject({ call_id: "call_keep", output: "Project memory", error: false });
    expect(replay.input.every((item) => !item.id && !item.encrypted_content)).toBe(true);
    expect(body).toEqual(untouched);
    expect(await value.response.text()).toBe("ok");
  });

  it("resolves stored item references instead of dropping referenced messages", async () => {
    const assistant = message(ROLE.ASSISTANT, "Remember this decision", { id: "msg_keep", phase: "final_answer" });
    await remember([message(ROLE.USER, "Decide")], [assistant]);
    const body = { input: [{ type: RESPONSES_ITEM.ITEM_REFERENCE, id: "msg_keep" }, message(ROLE.USER, "Use that decision")] };
    const { execute } = await recover(body, new Response(mismatch, { status: 400 }));
    expect(execute.mock.calls[0][0].input[0]).toEqual({ ...assistant, id: undefined });
  });

  it("does not duplicate a full replay prefix already supplied by the client", async () => {
    const first = message(ROLE.USER, "old question");
    const answer = message(ROLE.ASSISTANT, "old answer", { id: "msg_old", phase: "final_answer", status: "completed" });
    await remember([first], [answer]);
    const body = { previous_response_id: "resp_old", input: [first, { role: ROLE.ASSISTANT, content: "old answer" }, message(ROLE.USER, "next")] };
    const { execute } = await recover(body, new Response(mismatch, { status: 400 }));
    expect(execute.mock.calls[0][0].input).toHaveLength(3);
    expect(execute.mock.calls[0][0].input[1].phase).toBe("final_answer");
  });

  it("uses a self-contained client replay when the parent snapshot was lost", async () => {
    const first = message(ROLE.USER, "old question");
    const answer = message(ROLE.ASSISTANT, "old answer", { id: "msg_foreign", phase: "final_answer", status: "completed" });
    const body = { previous_response_id: "resp_before_restart", input: [first, answer, message(ROLE.USER, "continue")] };
    const { execute } = await recover(body, new Response(mismatch, { status: 400 }));
    expect(execute).toHaveBeenCalledTimes(1);
    const replay = execute.mock.calls[0][0];
    expect(replay).not.toHaveProperty("previous_response_id");
    expect(replay.input).toHaveLength(3);
    expect(replay.input[1]).toMatchObject({ role: ROLE.ASSISTANT, phase: "final_answer" });
    expect(replay.input[1]).not.toHaveProperty("id");
    expect(replay.input[1]).not.toHaveProperty("status");
  });

  it("retains media and custom-tool correlation while dropping foreign reasoning", async () => {
    const image = { type: RESPONSES_ITEM.INPUT_IMAGE, image_url: "data:image/png;base64,AAAA" };
    const file = { type: "input_file", file_data: "data:application/pdf;base64,BBBB" };
    const body = { input: [
      { type: RESPONSES_ITEM.MESSAGE, role: ROLE.USER, content: [image, file] },
      { type: RESPONSES_ITEM.REASONING, id: "rs_bad", encrypted_content: "foreign" },
      { type: RESPONSES_ITEM.CUSTOM_TOOL_CALL, id: "ctc_old", call_id: "custom_keep", name: "apply_patch", input: "patch" },
      { type: RESPONSES_ITEM.CUSTOM_TOOL_CALL_OUTPUT, call_id: "custom_keep", output: "done" },
    ] };
    const { execute } = await recover(body, new Response(mismatch, { status: 400 }));
    const input = execute.mock.calls[0][0].input;
    expect(input[0].content).toEqual([image, file]);
    expect(input[1].call_id).toBe(input[2].call_id);
    expect(input).toHaveLength(3);
  });

  it.each([
    { previous_response_id: "uncached", input: "next" },
    { input: [{ type: RESPONSES_ITEM.ITEM_REFERENCE, id: "unknown" }] },
    { input: [{ type: RESPONSES_ITEM.FUNCTION_CALL_OUTPUT, id: "out_old", call_id: "orphan", output: "data" }] },
    { conversation: "conv_uncached", input: [{ type: RESPONSES_ITEM.REASONING, id: "rs_old" }] },
  ])("preserves the original error when history cannot be recovered: %j", async (body) => {
    const { execute, value } = await recover(body, new Response(mismatch, { status: 400, headers: { "x-request-id": "keep" } }));
    expect(execute).not.toHaveBeenCalled();
    expect(value.response.status).toBe(400);
    expect(value.response.headers.get("x-request-id")).toBe("keep");
    expect(await value.response.text()).toBe(mismatch);
  });

  it("isolates history by API key across accounts/backends", async () => {
    await remember([message(ROLE.USER, "private project")], [message(ROLE.ASSISTANT, "private answer")]);
    const { execute } = await recover({ previous_response_id: "resp_old", input: "next" }, new Response(mismatch, { status: 400 }), undefined, "different-key");
    expect(execute).not.toHaveBeenCalled();
  });

  it("leaves ordinary failures and successful stateful requests unchanged", async () => {
    const body = { input: [{ type: RESPONSES_ITEM.REASONING, id: "rs_old", encrypted_content: "keep" }], store: false };
    for (const [status, text] of [[400, "Context length exceeded"], [429, "Too many requests"], [200, '{"id":"resp_ok","output":[]}']]) {
      const { execute, value } = await recover(body, new Response(text, { status, headers: { "x-upstream": "unchanged" } }));
      expect(execute).not.toHaveBeenCalled();
      expect(value.response.status).toBe(status);
      expect(await value.response.text()).toBe(text);
      expect(body.input[0].encrypted_content).toBe("keep");
    }
  });

  it("can be disabled and only retries once per request", async () => {
    const body = { input: [{ type: RESPONSES_ITEM.REASONING, id: "rs_old", encrypted_content: "old" }] };
    const disabled = await recover(body, new Response(mismatch, { status: 400 }), undefined, key, { ...config, enabled: false });
    expect(disabled.execute).not.toHaveBeenCalled();
    const execute = vi.fn(async () => result(new Response(mismatch, { status: 400 })));
    const { value, context } = await recover(body, new Response(mismatch, { status: 400 }), execute);
    expect(execute).toHaveBeenCalledTimes(1);
    const again = await recoverResponsesUpstream({ result: value, body, context, execute, config });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(again.response.status).toBe(400);
  });
});

describe("pre-commit SSE inspection", () => {
  const state = { input: [{ type: RESPONSES_ITEM.REASONING, id: "rs_bad", encrypted_content: "bad" }, message(ROLE.USER, "Keep this message")] };
  it("detects a bare JSON error mislabeled as an SSE response", async () => {
    const raw = JSON.stringify({ error: { message: mismatch, type: "invalid_request_error" } });
    const inspected = await inspectResponsesBackendError(new Response(raw, {
      status: 400, headers: { "content-type": "text/event-stream" },
    }), state);
    expect(inspected.error).toBe(true);
    expect(await inspected.response.text()).toBe(raw);
  });

  it("recovers fragmented SSE failures without exposing the failed setup frames", async () => {
    const raw = sse(RESPONSES_EVENT.CREATED, { response: { id: "resp_bad" } }) + failed();
    let offset = 0;
    const response = new Response(new ReadableStream({ pull(controller) {
      if (offset >= raw.length) { controller.close(); return; }
      controller.enqueue(encoder.encode(raw.slice(offset, offset += 9)));
    } }), { headers: { "content-type": "text/event-stream" } });
    const execute = vi.fn(async () => result(new Response(sse(RESPONSES_EVENT.COMPLETED, { response: { id: "resp_good", status: "completed", output: [] } }), { headers: { "content-type": "text/event-stream" } })));
    const { value } = await recover(state, response, execute);
    expect(execute).toHaveBeenCalledTimes(1);
    const text = await value.response.text();
    expect(text).toContain("resp_good");
    expect(text).not.toContain("resp_bad");
    expect(text).not.toContain(mismatch);
  });

  it("does not retry other SSE errors or replay after meaningful output", async () => {
    const cases = [failed("Too many requests", "rate_limit_exceeded"), failed(mismatch, "rate_limit_exceeded"),
      sse(RESPONSES_EVENT.OUTPUT_TEXT_DELTA, { type: RESPONSES_EVENT.OUTPUT_TEXT_DELTA, delta: "already delivered" }) + failed()];
    for (const raw of cases) {
      const { execute, value } = await recover(state, new Response(raw, { headers: { "content-type": "text/event-stream" } }));
      expect(execute).not.toHaveBeenCalled();
      expect(await value.response.text()).toBe(raw);
    }
  });

  it("replays a pending read after the deadline without dropping Unicode or events", async () => {
    const first = sse(RESPONSES_EVENT.CREATED, { response: { id: "resp_slow" } });
    const later = sse(RESPONSES_EVENT.OUTPUT_TEXT_DELTA, { delta: "Tiếng Việt ✓" });
    let emitted = false;
    const stream = new ReadableStream({ async pull(controller) {
      if (!emitted) { emitted = true; controller.enqueue(encoder.encode(first)); return; }
      await new Promise((resolve) => setTimeout(resolve, 25));
      controller.enqueue(encoder.encode(later));
      controller.close();
    } });
    const inspected = await inspectResponsesBackendError(new Response(stream, { headers: { "content-type": "text/event-stream" } }), state, { timeoutMs: 5 });
    expect(inspected.error).toBe(false);
    expect(await inspected.response.text()).toBe(first + later);
  });

  it("stops inspection at the byte cap and propagates cancellation to the one upstream reader", async () => {
    const bytes = encoder.encode(sse(RESPONSES_EVENT.CREATED, { padding: "x".repeat(1000) }));
    const canceled = vi.fn();
    const stream = new ReadableStream({ start(controller) { controller.enqueue(bytes); }, cancel: canceled });
    const inspected = await inspectResponsesBackendError(new Response(stream, { headers: { "content-type": "text/event-stream" } }), state, { maxBytes: 64 });
    expect(inspected.error).toBe(false);
    await inspected.response.body.cancel("client left");
    expect(canceled).toHaveBeenCalledTimes(1);
  });

  it("honors an abort while waiting for the first frame", async () => {
    const canceled = vi.fn();
    const abort = new AbortController();
    const promise = inspectResponsesBackendError(new Response(new ReadableStream({ cancel: canceled }), { headers: { "content-type": "text/event-stream" } }), state, { signal: abort.signal });
    abort.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(canceled).toHaveBeenCalledTimes(1);
  });
});

describe("bounded conversation snapshots", () => {
  it("captures successful SSE output items and keeps the response bytes unchanged", async () => {
    const context = createResponsesHistoryContext({ input: "question" }, key, cache);
    const item = message(ROLE.ASSISTANT, "answer", { id: "msg_saved", phase: "final_answer" });
    const raw = sse(RESPONSES_EVENT.CREATED, { response: { id: "resp_saved" } })
      + sse(RESPONSES_EVENT.OUTPUT_ITEM_DONE, { output_index: 0, item })
      + sse(RESPONSES_EVENT.COMPLETED, { response: { id: "resp_saved", status: "completed", output: [] } });
    expect(await observeResponsesResponse(new Response(raw, { headers: { "content-type": "text/event-stream" } }), context).text()).toBe(raw);
    const stored = cache.get(context.scope, "resp_saved");
    expect(stored.complete).toBe(true);
    expect(stored.history[1]).toEqual(item);
  });

  it("marks unknown ancestor history incomplete instead of silently starting a new thread", async () => {
    const context = createResponsesHistoryContext({ previous_response_id: "unobserved", input: "next" }, key, cache);
    await observeResponsesResponse(new Response(JSON.stringify({ id: "resp_partial", status: "completed", output: [message(ROLE.ASSISTANT, "answer")] }), { headers: { "content-type": "application/json" } }), context).text();
    expect(cache.get(context.scope, "resp_partial").complete).toBe(false);
    const { execute } = await recover({ previous_response_id: "resp_partial", input: "third" }, new Response(mismatch, { status: 400 }));
    expect(execute).not.toHaveBeenCalled();
  });

  it("expires and evicts whole histories, and refuses oversized snapshots", () => {
    let now = 0;
    const limited = new ResponsesHistoryCache({ ...config, historyTtlMs: 10, historyMaxEntries: 1, historyMaxEntryBytes: 200, historyMaxBytes: 200 }, () => now);
    const snapshot = { complete: true, history: [message(ROLE.USER, "small")] };
    expect(limited.set("scope", "first", snapshot)).toBe(true);
    limited.set("scope", "second", snapshot);
    expect(limited.get("scope", "first")).toBe(null);
    expect(limited.set("scope", "too-big", { complete: true, history: [message(ROLE.USER, "x".repeat(1000))] })).toBe(false);
    expect(limited.get("scope", "second")).toEqual(snapshot);
    now = 11;
    expect(limited.get("scope", "second")).toBe(null);
    expect(limited.bytes).toBe(0);
  });
});
