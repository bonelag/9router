import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getSettings: mocks.getSettings,
  getProxyPools: vi.fn(async () => []),
  validateApiKey: vi.fn(),
  updateProviderConnection: mocks.updateProviderConnection,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: async () => ({}),
  pickProxyPoolId: vi.fn(),
}));

vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: {},
  resolveProviderId: (provider) => provider,
}));

vi.mock("@/sse/utils/logger.js", () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

const { getProviderCredentials } = await import("@/sse/services/auth.js");

describe("per-model account allowlist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ fallbackStrategy: "fill-first" });
    mocks.getProviderConnections.mockResolvedValue([
      { id: "acc-a", name: "A", isActive: true },
      { id: "acc-b", name: "B", isActive: true },
      { id: "acc-c", name: "C", isActive: true },
    ]);
  });

  it("uses every active account when no allowlist is configured", async () => {
    const credentials = await getProviderCredentials("openai", null, "gpt-5.2");
    expect(credentials.connectionId).toBe("acc-a");
  });

  it("rotates only within the selected accounts", async () => {
    const credentials = await getProviderCredentials("openai", null, "gpt-5.2", {
      allowedConnectionIds: ["acc-b"],
    });
    expect(credentials.connectionId).toBe("acc-b");
  });

  it("skips excluded accounts inside the allowlist", async () => {
    const credentials = await getProviderCredentials("openai", new Set(["acc-b"]), "gpt-5.2", {
      allowedConnectionIds: ["acc-b", "acc-c"],
    });
    expect(credentials.connectionId).toBe("acc-c");
  });

  it("returns null when none of the selected accounts are active", async () => {
    const credentials = await getProviderCredentials("openai", null, "gpt-5.2", {
      allowedConnectionIds: ["missing-account"],
    });
    expect(credentials).toBeNull();
  });
});
