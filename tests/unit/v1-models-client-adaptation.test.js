import { describe, expect, it } from "vitest";
import {
  detectModelsClient,
  adaptModelsResponse,
  adaptSingleModelResponse,
  isFixedEffortModel,
  CLIENT_TYPES,
} from "../../src/app/api/v1/models/clientAdapters.js";

const sampleModels = [
  {
    id: "anthropic/claude-3-7-sonnet",
    object: "model",
    owned_by: "anthropic",
    capabilities: {
      vision: true,
      pdf: true,
      tools: true,
      reasoning: true,
      thinkingFormat: "claude-adaptive",
      contextWindow: 200000,
      maxOutput: 64000,
    },
    context_length: 200000,
    max_completion_tokens: 64000,
  },
  {
    id: "openai/gpt-5.6",
    object: "model",
    owned_by: "openai",
    capabilities: {
      vision: true,
      pdf: false,
      tools: true,
      reasoning: true,
      contextWindow: 1050000,
      maxOutput: 128000,
    },
    context_length: 1050000,
    max_completion_tokens: 128000,
  },
  {
    id: "openai/gpt-4o-mini",
    object: "model",
    owned_by: "openai",
    capabilities: {
      vision: true,
      pdf: false,
      tools: true,
      reasoning: false,
      contextWindow: 128000,
      maxOutput: 16384,
    },
    context_length: 128000,
    max_completion_tokens: 16384,
  },
  {
    id: "google/gemini-3.8-flash-high",
    object: "model",
    owned_by: "google",
    capabilities: {
      vision: true,
      pdf: true,
      tools: true,
      reasoning: true,
      contextWindow: 1000000,
      maxOutput: 65536,
    },
    context_length: 1000000,
    max_completion_tokens: 65536,
  },
];

describe("isFixedEffortModel", () => {
  it("detects models with explicit effort suffixes (-high, -medium, -low, etc.)", () => {
    expect(isFixedEffortModel("gemini-3.8-flash-high")).toBe(true);
    expect(isFixedEffortModel("google/gemini-3.8-flash-high")).toBe(true);
    expect(isFixedEffortModel("gemini-3.8-flash-medium")).toBe(true);
    expect(isFixedEffortModel("gemini-3.8-flash-low")).toBe(true);
    expect(isFixedEffortModel("gemini-3.5-flash-extra-low")).toBe(true);
    expect(isFixedEffortModel("gpt-5.5-xhigh")).toBe(true);
    expect(isFixedEffortModel("gpt-5.5-high-fast")).toBe(true);
    expect(isFixedEffortModel("claude-opus-4.7-high")).toBe(true);
    expect(isFixedEffortModel("claude-opus-4.7-max")).toBe(true);
    expect(isFixedEffortModel("claude-opus-4.7(high)")).toBe(true);
    expect(isFixedEffortModel("claude-4.5-opus-high-thinking")).toBe(true);
    expect(isFixedEffortModel("deepseek-v4-pro-none")).toBe(true);
  });

  it("does not match base models or non-effort model names", () => {
    expect(isFixedEffortModel("gemini-3.8-flash")).toBe(false);
    expect(isFixedEffortModel("gpt-5.6")).toBe(false);
    expect(isFixedEffortModel("claude-3-7-sonnet")).toBe(false);
    expect(isFixedEffortModel("qwen3.7-max")).toBe(false);
    expect(isFixedEffortModel("qwen3-max")).toBe(false);
    expect(isFixedEffortModel("mistral-medium")).toBe(false);
    expect(isFixedEffortModel("kimi-for-coding-highspeed")).toBe(false);
  });
});

describe("v1/models client detection", () => {
  it("detects Anthropic / Claude Code from anthropic-version header", () => {
    const req = new Request("https://router.test/v1/models", {
      headers: { "anthropic-version": "2023-06-01" },
    });
    expect(detectModelsClient(req)).toBe(CLIENT_TYPES.ANTHROPIC);
  });

  it("detects Anthropic / Claude Code from claude-code user-agent", () => {
    const req = new Request("https://router.test/v1/models", {
      headers: { "user-agent": "claude-code/2.1.207" },
    });
    expect(detectModelsClient(req)).toBe(CLIENT_TYPES.ANTHROPIC);
  });

  it("detects Anthropic / Claude Code from @anthropic-ai/sdk user-agent", () => {
    const req = new Request("https://router.test/v1/models", {
      headers: { "user-agent": "@anthropic-ai/sdk/0.38.0" },
    });
    expect(detectModelsClient(req)).toBe(CLIENT_TYPES.ANTHROPIC);
  });

  it("detects Cursor from User-Agent", () => {
    const req = new Request("https://router.test/v1/models", {
      headers: { "user-agent": "Cursor/0.45.11 (darwin-arm64)" },
    });
    expect(detectModelsClient(req)).toBe(CLIENT_TYPES.CURSOR);
  });

  it("detects Cursor from x-cursor-client header", () => {
    const req = new Request("https://router.test/v1/models", {
      headers: { "x-cursor-client": "1" },
    });
    expect(detectModelsClient(req)).toBe(CLIENT_TYPES.CURSOR);
  });

  it("detects Grok Build from User-Agent", () => {
    const req = new Request("https://router.test/v1/models", {
      headers: { "user-agent": "grok-build/1.0.0" },
    });
    expect(detectModelsClient(req)).toBe(CLIENT_TYPES.GROK);
  });

  it("detects Grok Build from x-opencodex-grok header", () => {
    const req = new Request("https://router.test/v1/models", {
      headers: { "x-opencodex-grok": "1" },
    });
    expect(detectModelsClient(req)).toBe(CLIENT_TYPES.GROK);
  });

  it("detects Codex from client_version query parameter", () => {
    const req = new Request("https://router.test/v1/models?client_version=0.1.0");
    expect(detectModelsClient(req)).toBe(CLIENT_TYPES.CODEX);
  });

  it("detects Codex from codex-tui User-Agent", () => {
    const req = new Request("https://router.test/v1/models", {
      headers: { "user-agent": "codex-tui/0.5.0" },
    });
    expect(detectModelsClient(req)).toBe(CLIENT_TYPES.CODEX);
  });

  it("falls back to OpenAI for unknown clients (Cline, Continue, OpenAI Python SDK)", () => {
    const req = new Request("https://router.test/v1/models", {
      headers: { "user-agent": "openai-python/1.30.0" },
    });
    expect(detectModelsClient(req)).toBe(CLIENT_TYPES.OPENAI);
  });
});

describe("Claude Code / Anthropic client formatting", () => {
  it("formats response as Anthropic ModelInfo list with capabilities", () => {
    const req = new Request("https://router.test/v1/models", {
      headers: { "anthropic-version": "2023-06-01" },
    });
    const result = adaptModelsResponse(sampleModels, req);

    expect(result).toHaveProperty("data");
    expect(result.object).toBeUndefined(); // Anthropic does not use object: "list"

    const sonnet = result.data.find((m) => m.id === "anthropic/claude-3-7-sonnet");
    expect(sonnet).toBeDefined();
    expect(sonnet.type).toBe("model");
    expect(sonnet.display_name).toBeDefined();
    expect(sonnet.created_at).toBe("2026-01-01T00:00:00Z");
    expect(sonnet.max_input_tokens).toBe(200000);
    expect(sonnet.max_tokens).toBeNull();

    // Anthropic capabilities for base model
    expect(sonnet.capabilities.effort.supported).toBe(true);
    expect(sonnet.capabilities.effort.low.supported).toBe(true);
    expect(sonnet.capabilities.effort.medium.supported).toBe(true);
    expect(sonnet.capabilities.effort.high.supported).toBe(true);
    expect(sonnet.capabilities.image_input.supported).toBe(true);
    expect(sonnet.capabilities.pdf_input.supported).toBe(true);
    expect(sonnet.capabilities.thinking.supported).toBe(true);

    // Fixed effort model (gemini-3.8-flash-high) does NOT declare thinking effort
    const flashHigh = result.data.find((m) => m.id === "google/gemini-3.8-flash-high");
    expect(flashHigh).toBeDefined();
    expect(flashHigh.capabilities.effort.supported).toBe(false);
    expect(flashHigh.capabilities.thinking.supported).toBe(false);

    // Non-reasoning model
    const gpt4oMini = result.data.find((m) => m.id === "openai/gpt-4o-mini");
    expect(gpt4oMini).toBeDefined();
    expect(gpt4oMini.capabilities.effort.supported).toBe(false);
    expect(gpt4oMini.capabilities.thinking.supported).toBe(false);
  });

  it("emits the [1m] variant for models with >= 1,000,000 context window", () => {
    const req = new Request("https://router.test/v1/models", {
      headers: { "anthropic-version": "2023-06-01" },
    });
    const result = adaptModelsResponse(sampleModels, req);

    const gpt561m = result.data.find((m) => m.id === "openai/gpt-5.6[1m]");
    expect(gpt561m).toBeDefined();
    expect(gpt561m.display_name).toContain("1M");
    expect(gpt561m.max_input_tokens).toBe(1000000);

    // 200k model should NOT have [1m] variant
    const sonnet1m = result.data.find((m) => m.id === "anthropic/claude-3-7-sonnet[1m]");
    expect(sonnet1m).toBeUndefined();
  });

  it("formats single model lookup for Anthropic", () => {
    const req = new Request("https://router.test/v1/models/anthropic/claude-3-7-sonnet", {
      headers: { "user-agent": "claude-code/2.1.207" },
    });
    const single = adaptSingleModelResponse(sampleModels[0], req);

    expect(single.id).toBe("anthropic/claude-3-7-sonnet");
    expect(single.type).toBe("model");
    expect(single.capabilities.thinking.supported).toBe(true);
  });
});

describe("Cursor client formatting", () => {
  it("formats response for Cursor with required api_types and capabilities", () => {
    const req = new Request("https://router.test/v1/models", {
      headers: { "user-agent": "Cursor/0.45.11" },
    });
    const result = adaptModelsResponse(sampleModels, req);

    expect(result.object).toBe("list");
    expect(Array.isArray(result.data)).toBe(true);

    const gpt56 = result.data.find((m) => m.id === "openai/gpt-5.6");
    expect(gpt56).toBeDefined();
    expect(gpt56.api_types).toEqual(["chat_completions", "responses", "anthropic_messages"]);

    // Cursor extended capabilities on base reasoning model
    expect(gpt56.capabilities.output_modalities).toEqual(["text"]);
    expect(gpt56.capabilities.input_modalities).toContain("text");
    expect(gpt56.capabilities.input_modalities).toContain("image");
    expect(gpt56.capabilities.supports_tool_use).toBe(true);
    expect(gpt56.capabilities.supports_streaming).toBe(true);
    expect(gpt56.capabilities.supports_reasoning).toBe(true);
    expect(gpt56.capabilities.supports_vision).toBe(true);
    expect(Array.isArray(gpt56.capabilities.reasoning_effort)).toBe(true);

    // Fixed effort model (gemini-3.8-flash-high) suppresses effort controls
    const flashHigh = result.data.find((m) => m.id === "google/gemini-3.8-flash-high");
    expect(flashHigh).toBeDefined();
    expect(flashHigh.capabilities.reasoning_effort).toBeUndefined();
    expect(flashHigh.capabilities.supports_reasoning).toBe(false);
    expect(flashHigh.supports_reasoning_effort).toBeUndefined();

    // Context metrics
    expect(gpt56.context_window).toBe(1050000);
    expect(gpt56.context_length).toBe(1050000);
    expect(gpt56.max_output_tokens).toBe(128000);
  });
});

describe("Grok Build client formatting", () => {
  it("formats response with supports_reasoning_effort and reasoning_efforts ladder", () => {
    const req = new Request("https://router.test/v1/models", {
      headers: { "user-agent": "grok-build/1.0.0" },
    });
    const result = adaptModelsResponse(sampleModels, req);

    expect(result.object).toBe("list");

    const sonnet = result.data.find((m) => m.id === "anthropic/claude-3-7-sonnet");
    expect(sonnet.supports_reasoning_effort).toBe(true);
    expect(sonnet.reasoning_effort).toBeDefined();
    expect(Array.isArray(sonnet.reasoning_efforts)).toBe(true);
    expect(sonnet.reasoning_efforts.some((e) => e.value === "medium" && e.default === true)).toBe(true);

    // Fixed effort model does NOT declare supports_reasoning_effort or reasoning_efforts
    const flashHigh = result.data.find((m) => m.id === "google/gemini-3.8-flash-high");
    expect(flashHigh).toBeDefined();
    expect(flashHigh.supports_reasoning_effort).toBeUndefined();
    expect(flashHigh.reasoning_efforts).toBeUndefined();

    // Non-reasoning model does not have reasoning effort
    const mini = result.data.find((m) => m.id === "openai/gpt-4o-mini");
    expect(mini.supports_reasoning_effort).toBeUndefined();
  });
});

describe("Codex client formatting", () => {
  it("returns { models: [...] } catalog shape when client_version query parameter is provided", () => {
    const req = new Request("https://router.test/v1/models?client_version=0.1.0");
    const result = adaptModelsResponse(sampleModels, req);

    expect(result.models).toBeDefined();
    expect(result.object).toBeUndefined();
    expect(result.models.length).toBe(sampleModels.length);
  });

  it("returns standard list when client_version is not provided", () => {
    const req = new Request("https://router.test/v1/models", {
      headers: { "user-agent": "codex-tui" },
    });
    const result = adaptModelsResponse(sampleModels, req);

    expect(result.object).toBe("list");
    expect(Array.isArray(result.data)).toBe(true);
  });
});

describe("Route integration GET /v1/models", () => {
  it("GET adapts response for Claude Code request", async () => {
    const { GET } = await import("../../src/app/api/v1/models/route.js");
    const req = new Request("https://router.test/v1/models", {
      headers: { "user-agent": "claude-code/2.1.207" },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty("data");
    expect(json.object).toBeUndefined();
    expect(json.data.length).toBeGreaterThan(0);
    expect(json.data[0].type).toBe("model");
  });

  it("GET adapts response for Cursor request", async () => {
    const { GET } = await import("../../src/app/api/v1/models/route.js");
    const req = new Request("https://router.test/v1/models", {
      headers: { "user-agent": "Cursor/0.45.11" },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.object).toBe("list");
    expect(json.data.length).toBeGreaterThan(0);
    const firstWithReasoning = json.data.find((m) => m.capabilities?.supports_reasoning);
    if (firstWithReasoning) {
      expect(firstWithReasoning.api_types).toBeDefined();
      expect(firstWithReasoning.capabilities.output_modalities).toEqual(["text"]);
    }
  });

  it("GET adapts response for Grok Build request", async () => {
    const { GET } = await import("../../src/app/api/v1/models/route.js");
    const req = new Request("https://router.test/v1/models", {
      headers: { "user-agent": "grok-build/1.0" },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.object).toBe("list");
    const reasoningModel = json.data.find((m) => m.supports_reasoning_effort === true);
    if (reasoningModel) {
      expect(Array.isArray(reasoningModel.reasoning_efforts)).toBe(true);
      expect(reasoningModel.reasoning_efforts.length).toBeGreaterThan(0);
    }
  });
});
