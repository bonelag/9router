import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOKEN_RATE_LIMIT_RETRY_CONFIG } from "../../open-sse/config/runtimeConfig.js";
import {
  inspectTokenRateLimitResponse,
  matchTokenRateLimitError,
} from "../../open-sse/services/tokenRateLimitRetry.js";

const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

const { BaseExecutor } = await import("../../open-sse/executors/base.js");

const endpoint = "https://agentrouter.test/v1/responses?api-version=2026-11-13";
const model = "gpt-6.1-sol";
const region = "eastus2";
const rawMessage = `[Error] Your requests to ${model} for ${model} in ${region} have exceeded token rate limit. [trace_id=test]`;
const errorResponse = (headers = {}) => new Response(JSON.stringify({ error: { message: rawMessage } }), {
  status: 429,
  headers: { "content-type": "application/json", "retry-after": "600", ...headers },
});
const successResponse = () => new Response(JSON.stringify({ id: "ok" }), {
  status: 200,
  headers: { "content-type": "application/json" },
});

const fullContext = {
  model,
  input: [
    { type: "message", role: "user", content: [{ type: "input_text", text: "inspect" }] },
    { type: "reasoning", id: "rs_keep", encrypted_content: "cipher" },
    { type: "function_call", id: "fc_keep", call_id: "call_keep", name: "read_file", arguments: "{}" },
    { type: "function_call_output", call_id: "call_keep", output: "data" },
    { type: "message", role: "assistant", phase: "commentary", content: [{ type: "output_text", text: "continuing" }] },
  ],
  stream: true,
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-13T00:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("dynamic token-rate-limit detection", () => {
  it("captures arbitrary repeated model and region values", () => {
    expect(matchTokenRateLimitError(rawMessage)).toMatchObject({ model, region, rawMessage });
    expect(matchTokenRateLimitError("Your requests to model-a for model-b in eastus2 have exceeded token rate limit.")).toBe(null);
  });

  it("detects the message in a standard HTTP error body regardless of status", async () => {
    const response = new Response(JSON.stringify({ error: { message: rawMessage } }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
    const inspected = await inspectTokenRateLimitResponse(response);
    expect(inspected.matched).toMatchObject({ model, region, rawMessage });
    expect(await inspected.response.json()).toEqual({ error: { message: rawMessage } });
  });

  it("detects a fragmented error chunk inside an SSE stream", async () => {
    const raw = `event: response.created\ndata: {"type":"response.created"}\n\ndata: ${JSON.stringify({ error: { message: rawMessage } })}\n\n`;
    let offset = 0;
    const response = new Response(new ReadableStream({
      pull(controller) {
        if (offset >= raw.length) { controller.close(); return; }
        controller.enqueue(new TextEncoder().encode(raw.slice(offset, offset += 11)));
      },
    }), { headers: { "content-type": "text/event-stream" } });
    const inspected = await inspectTokenRateLimitResponse(response);
    expect(inspected.matched).toMatchObject({ model, region, rawMessage });
    expect(await inspected.response.text()).toBe(raw);
  });

  it("does not mistake assistant output quoting the sentence for an error chunk", async () => {
    const raw = `data: ${JSON.stringify({ choices: [{ delta: { content: rawMessage }, finish_reason: null }] })}\n\n`;
    const inspected = await inspectTokenRateLimitResponse(new Response(raw, {
      headers: { "content-type": "text/event-stream" },
    }));
    expect(inspected.matched).toBe(null);
    expect(await inspected.response.text()).toBe(raw);
  });
});

describe("BaseExecutor exact-request token-rate-limit retry", () => {
  it("ignores Retry-After and retries the identical request on a 5s linear schedule", async () => {
    let calls = 0;
    fetchMock.mockImplementation(async () => (++calls <= 5 ? errorResponse() : successResponse()));
    const executor = new BaseExecutor("test", { baseUrl: endpoint, retry: { 429: { attempts: 9, delayMs: 1 } } });
    const log = { warn: vi.fn(), debug: vi.fn() };
    const start = Date.now();
    const pending = executor.execute({
      model,
      body: fullContext,
      stream: true,
      credentials: { apiKey: "secret" },
      providerOverrides: { headers: { "x-exact-header": "keep" } },
      log,
    });
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(Date.now() - start).toBe(75_000);
    const firstOptions = fetchMock.mock.calls[0][1];
    for (const [url, options] of fetchMock.mock.calls) {
      expect(url).toBe(endpoint);
      expect(options.headers).toBe(firstOptions.headers);
      expect(options.body).toBe(firstOptions.body);
      expect(JSON.parse(options.body)).toEqual(fullContext);
      expect(options.headers["x-exact-header"]).toBe("keep");
    }
    expect(log.warn).toHaveBeenCalledTimes(5);
    expect(log.warn.mock.calls.map((call) => call[2].attempt)).toEqual(["1/5", "2/5", "3/5", "4/5", "5/5"]);
    expect(log.warn.mock.calls.map((call) => call[2].backoffMs)).toEqual([5_000, 10_000, 15_000, 20_000, 25_000]);
    expect(log.warn.mock.calls[0][2]).toMatchObject({ endpoint, model, region, rawMessage, exhausted: false });
    expect(log.warn.mock.calls[0][2].timestamp).toBe("2026-11-13T00:00:00.000Z");
    expect(TOKEN_RATE_LIMIT_RETRY_CONFIG).toMatchObject({ maxRetries: 5, baseDelayMs: 5_000 });
  });

  it("propagates only after five retries and never falls over to another endpoint", async () => {
    fetchMock.mockImplementation(async () => errorResponse());
    const fallback = "https://other.test/v1/responses";
    const executor = new BaseExecutor("test", {
      baseUrls: [endpoint, fallback],
      retry: { 429: { attempts: 9, delayMs: 1 } },
    });
    const log = { warn: vi.fn(), debug: vi.fn() };
    const pending = executor.execute({ model, body: fullContext, stream: true, credentials: { apiKey: "secret" }, log });
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.response.status).toBe(429);
    expect(await result.response.json()).toEqual({ error: { message: rawMessage } });
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(fetchMock.mock.calls.every(([url]) => url === endpoint)).toBe(true);
    expect(log.warn).toHaveBeenCalledTimes(6);
    expect(log.warn.mock.calls.at(-1)[2]).toMatchObject({ attempt: "5/5", backoffMs: 0, exhausted: true });
  });

  it("swallows an SSE error attempt and exposes only the successful retry stream", async () => {
    const failed = `event: response.in_progress\ndata: {"type":"response.in_progress"}\n\ndata: ${JSON.stringify({ error: { message: rawMessage } })}\n\n`;
    const succeeded = `data: ${JSON.stringify({ choices: [{ delta: { content: "ok" }, finish_reason: null }] })}\n\n`;
    fetchMock
      .mockResolvedValueOnce(new Response(failed, { headers: { "content-type": "text/event-stream" } }))
      .mockResolvedValueOnce(new Response(succeeded, { headers: { "content-type": "text/event-stream" } }));
    const executor = new BaseExecutor("test", { baseUrl: endpoint });
    const log = { warn: vi.fn(), debug: vi.fn() };
    const pending = executor.execute({ model, body: fullContext, stream: true, credentials: { apiKey: "secret" }, log });
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await result.response.text()).toBe(succeeded);
    expect(log.warn.mock.calls[0][2]).toMatchObject({ attempt: "1/5", backoffMs: 5_000 });
  });
});
