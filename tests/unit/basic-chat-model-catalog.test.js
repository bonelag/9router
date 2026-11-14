import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildBasicChatProviderGroups,
  parseBasicChatModelsPayload,
} from "@/shared/utils/basicChatModelCatalog.js";

const BASIC_CHAT_PAGE = fileURLToPath(new URL(
  "../../src/app/(dashboard)/dashboard/basic-chat/BasicChatPageClient.js",
  import.meta.url,
));

describe("Basic Chat gateway model catalog", () => {
  it("loads models only from the 9Router catalog endpoint", () => {
    const source = readFileSync(BASIC_CHAT_PAGE, "utf8");

    expect(source).toContain('fetch("/v1/models", { cache: "no-store" })');
    expect(source).not.toContain('/api/providers/${connection.id}/models');
    expect(source).not.toContain('fetch("/api/models/alias"');
    expect(source).not.toContain('fetch("/api/models/custom"');
  });

  it("parses the supported /v1/models response shapes", () => {
    const models = [{ id: "qro/claude-haiku-5.5", owned_by: "qro" }];

    expect(parseBasicChatModelsPayload({ data: models })).toBe(models);
    expect(parseBasicChatModelsPayload({ models })).toBe(models);
    expect(parseBasicChatModelsPayload({ results: models })).toBe(models);
    expect(parseBasicChatModelsPayload(models)).toBe(models);
    expect(parseBasicChatModelsPayload({})).toEqual([]);
  });

  it("groups only gateway-published models under connected providers", () => {
    const qronosProviderId = "openai-compatible-chat-qronos";
    const connections = [
      {
        id: "qronos-connection",
        provider: qronosProviderId,
        name: "key",
        providerSpecificData: { prefix: "qro", nodeName: "Qronos" },
      },
      {
        id: "antigravity-connection",
        provider: "antigravity",
        name: "account@example.com",
        providerSpecificData: {},
      },
      {
        id: "inactive-connection",
        provider: "openai-compatible-chat-inactive",
        isActive: false,
        providerSpecificData: { prefix: "off" },
      },
    ];
    const catalogModels = [
      { id: "qro/claude-haiku-5.5", owned_by: "qro" },
      { id: "qro/moonshotai/Kimi-K3.1-Pro", owned_by: "qro" },
      { id: "qro/claude-haiku-5.5", owned_by: "qro" },
      { id: "ag/gemini-4-carbon-low", owned_by: "ag" },
      { id: "gpt-6.1-sol", owned_by: "codex" },
      { id: "off/hidden-model", owned_by: "off" },
    ];

    const groups = buildBasicChatProviderGroups(connections, catalogModels);
    const qronos = groups.find((group) => group.providerId === qronosProviderId);
    const antigravity = groups.find((group) => group.providerId === "antigravity");

    expect(groups).toHaveLength(2);
    expect(qronos.providerName).toBe("Qronos");
    expect(qronos.models.map((model) => model.id)).toEqual([
      "qro/claude-haiku-5.5",
      "qro/moonshotai/Kimi-K3.1-Pro",
    ]);
    expect(qronos.models.map((model) => model.name)).toEqual([
      "claude-haiku-5.5",
      "moonshotai/Kimi-K3.1-Pro",
    ]);
    expect(qronos.models.every((model) => model.source === "gateway")).toBe(true);
    expect(antigravity.models.map((model) => model.requestModel)).toEqual([
      "ag/gemini-4-carbon-low",
    ]);
    expect(groups.flatMap((group) => group.models).some((model) => model.id === "gpt-6.1-sol")).toBe(false);
    expect(groups.flatMap((group) => group.models).some((model) => model.id === "off/hidden-model")).toBe(false);
  });

  it("uses owned_by to attach a bare routable model id to its connected provider", () => {
    const groups = buildBasicChatProviderGroups(
      [{ id: "codex-connection", provider: "codex" }],
      [{ id: "gpt-6.1-sol", owned_by: "codex" }],
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].models[0]).toMatchObject({
      id: "gpt-6.1-sol",
      requestModel: "gpt-6.1-sol",
      displayModel: "gpt-6.1-sol",
    });
  });
});
