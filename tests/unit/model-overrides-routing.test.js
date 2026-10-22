import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({
    noAuth: true,
    execute: executeMock,
  }),
}));

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
    logError: vi.fn(),
  }),
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

async function runOpenAIRequest({ modelOverride, reasoningEffort = "low" } = {}) {
  const body = {
    model: "gpt-5.2",
    messages: [{ role: "user", content: "hi" }],
    stream: false,
    reasoning_effort: reasoningEffort,
  };

  await handleChatCore({
    body,
    modelInfo: { provider: "openai", model: "gpt-5.2" },
    modelOverride,
    credentials: { accessToken: "test-token", providerSpecificData: {} },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    connectionId: "test-connection",
    rtkEnabled: false,
    headroomEnabled: false,
    cavemanEnabled: false,
    ponytailEnabled: false,
    pxpipeEnabled: false,
    clientRawRequest: {
      endpoint: "/v1/chat/completions",
      body,
      headers: { accept: "application/json", "user-agent": "vitest" },
    },
  });

  return executeMock.mock.calls.at(-1)[0].body;
}

describe("per-model effort override", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeMock.mockResolvedValue({
      response: new Response(JSON.stringify({ choices: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
      url: "https://api.openai.com/v1/chat/completions",
      headers: {},
      transformedBody: null,
    });
  });

  it("wins over the client's reasoning_effort", async () => {
    const body = await runOpenAIRequest({ modelOverride: { effort: "high" } });
    expect(body.reasoning_effort).toBe("high");
  });

  it("can disable thinking even when the client asked for reasoning", async () => {
    const body = await runOpenAIRequest({ modelOverride: { effort: "none" } });
    expect(body.reasoning_effort).toBe("none");
  });

  it("does not change the request when no override is configured", async () => {
    const body = await runOpenAIRequest({ modelOverride: null });
    expect(body.reasoning_effort).toBe("low");
  });
});
