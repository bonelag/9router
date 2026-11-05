import { describe, it, expect } from "vitest";
import {
  applyCodexModelMapping,
  CODEX_STANDARD_MODELS,
} from "../../src/lib/codexModelMapping.js";
import { mergeWithDefaults } from "../../src/lib/db/repos/settingsRepo.js";

describe("Codex Model Mapping", () => {
  it("exports standard fixed models list", () => {
    expect(Array.isArray(CODEX_STANDARD_MODELS)).toBe(true);
    expect(CODEX_STANDARD_MODELS.length).toBeGreaterThanOrEqual(10);
    expect(CODEX_STANDARD_MODELS.some((m) => m.id === "gpt-6.1-sol")).toBe(true);
    expect(CODEX_STANDARD_MODELS.some((m) => m.id === "gpt-6-astra")).toBe(true);
    expect(CODEX_STANDARD_MODELS.some((m) => m.id === "gpt-5.6-luna")).toBe(true);
  });

  describe("applyCodexModelMapping", () => {
    const mapping = {
      "gpt-6.1-sol": "gemini-3.8-flash",
      "gpt-6-astra": "agr/gpt-5.6-sol",
      "gpt-5.6-luna": "deepseek-chat",
      "gpt-daybreak-blue-latest": "openai/gpt-4o",
    };

    it("returns original model when mapping is empty or invalid", () => {
      expect(applyCodexModelMapping("gpt-6.1-sol", null)).toBe("gpt-6.1-sol");
      expect(applyCodexModelMapping("gpt-6.1-sol", {})).toBe("gpt-6.1-sol");
      expect(applyCodexModelMapping(null, mapping)).toBe(null);
    });

    it("returns original model when no mapping matches", () => {
      expect(applyCodexModelMapping("claude-sonnet-4", mapping)).toBe("claude-sonnet-4");
      expect(applyCodexModelMapping("gpt-4o", mapping)).toBe("gpt-4o");
    });

    it("maps exact standard model ID", () => {
      expect(applyCodexModelMapping("gpt-6.1-sol", mapping)).toBe("gemini-3.8-flash");
      expect(applyCodexModelMapping("gpt-6-astra", mapping)).toBe("agr/gpt-5.6-sol");
      expect(applyCodexModelMapping("gpt-5.6-luna", mapping)).toBe("deepseek-chat");
      expect(applyCodexModelMapping("gpt-daybreak-blue-latest", mapping)).toBe("openai/gpt-4o");
    });

    it("maps model with provider prefix (cx/ or codex/)", () => {
      expect(applyCodexModelMapping("cx/gpt-6.1-sol", mapping)).toBe("gemini-3.8-flash");
      expect(applyCodexModelMapping("codex/gpt-6.1-sol", mapping)).toBe("gemini-3.8-flash");
      expect(applyCodexModelMapping("cx/gpt-6-astra", mapping)).toBe("agr/gpt-5.6-sol");
    });

    it("maps model with context marker suffix ([1m])", () => {
      expect(applyCodexModelMapping("gpt-6.1-sol[1m]", mapping)).toBe("gemini-3.8-flash");
      expect(applyCodexModelMapping("cx/gpt-6.1-sol[1m]", mapping)).toBe("gemini-3.8-flash");
      expect(applyCodexModelMapping("codex/gpt-6-astra[1m]", mapping)).toBe("agr/gpt-5.6-sol");
    });

    it("prioritizes exact match over normalized match", () => {
      const customMapping = {
        "gpt-6.1-sol": "gemini-3.8-flash",
        "gpt-6.1-sol[1m]": "gemini-3.8-pro",
        "cx/gpt-6.1-sol": "gemini-custom",
      };
      expect(applyCodexModelMapping("gpt-6.1-sol", customMapping)).toBe("gemini-3.8-flash");
      expect(applyCodexModelMapping("gpt-6.1-sol[1m]", customMapping)).toBe("gemini-3.8-pro");
      expect(applyCodexModelMapping("cx/gpt-6.1-sol", customMapping)).toBe("gemini-custom");
    });
  });

  describe("settingsRepo default behavior", () => {
    it("provides empty codexModelMapping default", () => {
      const merged = mergeWithDefaults({});
      expect(merged.codexModelMapping).toEqual({});
    });

    it("preserves configured codexModelMapping", () => {
      const merged = mergeWithDefaults({
        codexModelMapping: {
          "gpt-6.1-sol": "gemini-3.8-flash",
        },
      });
      expect(merged.codexModelMapping).toEqual({
        "gpt-6.1-sol": "gemini-3.8-flash",
      });
    });
  });
});

