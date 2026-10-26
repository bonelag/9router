import { describe, expect, it } from "vitest";
import {
  detectModelsClient,
  adaptModelsResponse,
  formatAnthropicModelList,
  isOfficialModel,
  normalizeModelId,
  readClaudeOfficialModelIds,
  CLIENT_TYPES,
} from "../../src/app/api/v1/models/clientAdapters.js";
import {
  toClaudeGatewayAlias,
  resolveClaudeGatewayAlias,
  isClaudeCodeCompatibleId,
} from "../../open-sse/utils/claudeGatewayAlias.js";

describe("CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY settings & adapter", () => {
  it("adapts /v1/models response to Claude Code format only when Claude Code is detected", () => {
    const models = [
      {
        id: "provider/gemini-2.5-pro",
        object: "model",
        owned_by: "provider",
        capabilities: { contextWindow: 2000000 },
        context_length: 2000000,
      },
      {
        id: "provider/claude-3-7-sonnet",
        object: "model",
        owned_by: "provider",
        capabilities: { contextWindow: 200000 },
        context_length: 200000,
      },
    ];

    // 1. OpenAI request (default): remains OpenAI format, no alias or [1m] added
    const openAiReq = new Request("https://router.test/v1/models", {
      headers: { "user-agent": "curl/7.68.0" },
    });
    const openAiRes = adaptModelsResponse(models, openAiReq);
    expect(openAiRes.object).toBe("list");
    expect(openAiRes.data[0].object).toBe("model");
    expect(openAiRes.data[0].id).toBe("provider/gemini-2.5-pro");

    // 2. Claude Code request via anthropic-version: adapted to Claude Code format
    const claudeReq = new Request("https://router.test/v1/models", {
      headers: { "anthropic-version": "2023-06-01" },
    });
    const claudeRes = adaptModelsResponse(models, claudeReq);
    expect(claudeRes.object).toBeUndefined();
    expect(Array.isArray(claudeRes.data)).toBe(true);

    // 2M model has [1m] variant emitted and passes Claude Code filter
    const gemini1m = claudeRes.data.find((m) => m.id === "9r-claude-provider--gemini-2.5-pro[1m]");
    expect(gemini1m).toBeDefined();
    expect(gemini1m.display_name).toContain("[1m]");
    expect(/(claude|anthropic)/i.test(gemini1m.id)).toBe(true);

    // 200k model does NOT have [1m] variant, but is still present in the list
    const sonnet = claudeRes.data.find((m) => m.id === "provider/claude-3-7-sonnet");
    expect(sonnet).toBeDefined();
    expect(sonnet.display_name).not.toContain("[1m]");
    const sonnet1m = claudeRes.data.find((m) => m.id === "provider/claude-3-7-sonnet[1m]");
    expect(sonnet1m).toBeUndefined();
  });

  it("aliases non-Claude models so Claude Code discovery filter /(claude|anthropic)/i passes them all", () => {
    const models = [
      { id: "deepseek/deepseek-v4-flash", capabilities: { contextWindow: 128000 } },
      { id: "z-ai/glm-5.2", capabilities: { contextWindow: 200000 } },
      { id: "openai/gpt-5.5", capabilities: { contextWindow: 1000000 } },
      { id: "smart-router", capabilities: { contextWindow: 200000 } },
      { id: "anthropic/claude-opus-5-5", capabilities: { contextWindow: 200000 } },
    ];

    const res = formatAnthropicModelList(models);

    // Every single model emitted in the list MUST pass Claude Code's discovery filter
    for (const item of res.data) {
      expect(/(claude|anthropic)/i.test(item.id)).toBe(true);
    }

    const ids = res.data.map((m) => m.id);
    expect(ids).toContain("9r-claude-deepseek--deepseek-v4-flash");
    expect(ids).toContain("9r-claude-z-ai--glm-5.2");
    expect(ids).toContain("9r-claude-openai--gpt-5.5");
    expect(ids).toContain("9r-claude-openai--gpt-5.5[1m]");
    expect(ids).toContain("9r-claude-combo--smart-router");
    expect(ids).toContain("anthropic/claude-opus-5-5");
  });

  it("resolves Claude gateway aliases back to original canonical model IDs", () => {
    expect(resolveClaudeGatewayAlias("9r-claude-deepseek--deepseek-v4-flash")).toBe("deepseek/deepseek-v4-flash");
    expect(resolveClaudeGatewayAlias("9r-claude-z-ai--glm-5.2")).toBe("z-ai/glm-5.2");
    expect(resolveClaudeGatewayAlias("9r-claude-combo--smart-router")).toBe("smart-router");
    expect(resolveClaudeGatewayAlias("ocx-claude-deepseek--deepseek-v4-flash")).toBe("deepseek/deepseek-v4-flash");
    expect(resolveClaudeGatewayAlias("claude-ocx-deepseek--deepseek-v4-flash")).toBe("deepseek/deepseek-v4-flash");
    expect(resolveClaudeGatewayAlias("9r-claude2-openrouter--meta-llama~sllama-3.3-70b")).toBe("openrouter/meta-llama/llama-3.3-70b");
    expect(resolveClaudeGatewayAlias("anthropic/claude-3-7-sonnet")).toBe("anthropic/claude-3-7-sonnet");
  });

  it("adds [1m] to model name if context length is >= 300K", () => {
    const models = [
      {
        id: "vendor/large-600k",
        capabilities: { contextWindow: 600000 },
        context_length: 600000,
      },
      {
        id: "vendor/mid-300k",
        capabilities: { contextWindow: 300000 },
        context_length: 300000,
      },
      {
        id: "vendor/small-200k",
        capabilities: { contextWindow: 200000 },
        context_length: 200000,
      },
      {
        id: "vendor/huge-1m",
        capabilities: { contextWindow: 1000000 },
        context_length: 1000000,
      },
    ];

    const res = formatAnthropicModelList(models);
    const ids = res.data.map((m) => m.id);

    // >= 300K -> includes [1m] variant
    expect(ids).toContain("9r-claude-vendor--large-600k[1m]");
    expect(ids).toContain("9r-claude-vendor--mid-300k[1m]");
    expect(ids).toContain("9r-claude-vendor--huge-1m[1m]");

    // Less than 300K -> does not include [1m]
    expect(ids).not.toContain("9r-claude-vendor--small-200k[1m]");
  });

  it("detects Claude Code via various client indicators without overriding default OpenAI", () => {
    // Claude Code Indicators
    expect(detectModelsClient(new Request("https://router.test/v1/models", {
      headers: { "user-agent": "claude-code/1.0.0" },
    }))).toBe(CLIENT_TYPES.ANTHROPIC);

    expect(detectModelsClient(new Request("https://router.test/v1/models", {
      headers: { "user-agent": "claude/2.0.0" },
    }))).toBe(CLIENT_TYPES.ANTHROPIC);

    expect(detectModelsClient(new Request("https://router.test/v1/models", {
      headers: { "user-agent": "@anthropic-ai/claude-code" },
    }))).toBe(CLIENT_TYPES.ANTHROPIC);

    expect(detectModelsClient(new Request("https://router.test/v1/models", {
      headers: { "anthropic-beta": "prompt-caching-2024-07-31" },
    }))).toBe(CLIENT_TYPES.ANTHROPIC);

    expect(detectModelsClient(new Request("https://router.test/v1/models", {
      headers: { "x-app": "cli" },
    }))).toBe(CLIENT_TYPES.ANTHROPIC);

    expect(detectModelsClient(new Request("https://router.test/v1/models?flavor=claude"))).toBe(CLIENT_TYPES.ANTHROPIC);

    // Default / Non-Claude clients stay OpenAI
    expect(detectModelsClient(new Request("https://router.test/v1/models", {
      headers: { "user-agent": "openai/1.0" },
    }))).toBe(CLIENT_TYPES.OPENAI);

    expect(detectModelsClient(new Request("https://router.test/v1/models", {
      headers: { "user-agent": "python-requests/2.28.1" },
    }))).toBe(CLIENT_TYPES.OPENAI);
  });

  describe("Official models exclusion (fable, opus, sonnet, haiku)", () => {
    const officialModels = [
      "ftb/deepseek-v4.1-flash-1017[1m]",
      "ag/gemini-3.8-flash-high[1m]",
      "rv/zai-org/GLM-5.3-Flash[1m]",
      "am/gpt-6.1-sol[1m]",
    ];

    it("normalizes model IDs by stripping [1m] and gateway alias", () => {
      expect(normalizeModelId("ag/gemini-3.8-flash-high[1m]")).toBe("ag/gemini-3.8-flash-high");
      expect(normalizeModelId("9r-claude-ag--gemini-3.8-flash-high[1m]")).toBe("ag/gemini-3.8-flash-high");
      expect(normalizeModelId("9r-claude2-rv--zai-org~sGLM-5.3-Flash[1m]")).toBe("rv/zai-org/glm-5.3-flash");
    });

    it("identifies official model matches for base, 1m, and aliased variants", () => {
      expect(isOfficialModel("ftb/deepseek-v4.1-flash-1017", officialModels)).toBe(true);
      expect(isOfficialModel("ftb/deepseek-v4.1-flash-1017[1m]", officialModels)).toBe(true);
      expect(isOfficialModel("9r-claude-ftb--deepseek-v4.1-flash-1017", officialModels)).toBe(true);
      expect(isOfficialModel("9r-claude-ftb--deepseek-v4.1-flash-1017[1m]", officialModels)).toBe(true);

      expect(isOfficialModel("ag/gemini-3.8-flash-high", officialModels)).toBe(true);
      expect(isOfficialModel("9r-claude-ag--gemini-3.8-flash-high[1m]", officialModels)).toBe(true);

      expect(isOfficialModel("rv/zai-org/GLM-5.3-Flash", officialModels)).toBe(true);
      expect(isOfficialModel("9r-claude2-rv--zai-org~sGLM-5.3-Flash[1m]", officialModels)).toBe(true);

      expect(isOfficialModel("am/gpt-6.1-sol", officialModels)).toBe(true);
      expect(isOfficialModel("9r-claude-am--gpt-6.1-sol[1m]", officialModels)).toBe(true);

      // Models from different providers are NOT matched
      expect(isOfficialModel("lab/deepseek-v4.1-flash-1017", officialModels)).toBe(false);
      expect(isOfficialModel("agr/gpt-6.1-sol", officialModels)).toBe(false);
      expect(isOfficialModel("ag/gemini-3.8-flash-medium", officialModels)).toBe(false);
    });

    it("excludes official models from formatAnthropicModelList (both base and 1m)", () => {
      const allCatalogModels = [
        // Official Opus (ftb)
        { id: "ftb/deepseek-v4.1-flash-1017", capabilities: { contextWindow: 1000000 } },
        // Non-official Deepseek (lab)
        { id: "lab/deepseek-v4.1-flash-1017", capabilities: { contextWindow: 1000000 } },
        // Official Sonnet (ag)
        { id: "ag/gemini-3.8-flash-high", capabilities: { contextWindow: 1000000 } },
        // Non-official Gemini (ag)
        { id: "ag/gemini-3.8-flash-medium", capabilities: { contextWindow: 1000000 } },
        // Official Haiku (rv)
        { id: "rv/zai-org/GLM-5.3-Flash", capabilities: { contextWindow: 1000000 } },
        // Official Fable (am)
        { id: "am/gpt-6.1-sol", capabilities: { contextWindow: 1000000 } },
        // Non-official Sol (agr)
        { id: "agr/gpt-6.1-sol", capabilities: { contextWindow: 1000000 } },
      ];

      const res = formatAnthropicModelList(allCatalogModels, { officialModels });
      const ids = res.data.map((m) => m.id);

      // Official models must NOT be in the extended list (neither base nor [1m])
      expect(ids).not.toContain("9r-claude-ftb--deepseek-v4.1-flash-1017");
      expect(ids).not.toContain("9r-claude-ftb--deepseek-v4.1-flash-1017[1m]");

      expect(ids).not.toContain("9r-claude-ag--gemini-3.8-flash-high");
      expect(ids).not.toContain("9r-claude-ag--gemini-3.8-flash-high[1m]");

      expect(ids).not.toContain("9r-claude2-rv--zai-org~sGLM-5.3-Flash");
      expect(ids).not.toContain("9r-claude2-rv--zai-org~sGLM-5.3-Flash[1m]");

      expect(ids).not.toContain("9r-claude-am--gpt-6.1-sol");
      expect(ids).not.toContain("9r-claude-am--gpt-6.1-sol[1m]");

      // Non-official models MUST remain in the list
      expect(ids).toContain("9r-claude-lab--deepseek-v4.1-flash-1017");
      expect(ids).toContain("9r-claude-lab--deepseek-v4.1-flash-1017[1m]");
      expect(ids).toContain("9r-claude-ag--gemini-3.8-flash-medium");
      expect(ids).toContain("9r-claude-ag--gemini-3.8-flash-medium[1m]");
      expect(ids).toContain("9r-claude-agr--gpt-6.1-sol");
      expect(ids).toContain("9r-claude-agr--gpt-6.1-sol[1m]");
    });
  });
});
