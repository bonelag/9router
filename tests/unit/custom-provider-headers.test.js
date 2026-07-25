/**
 * Contract: when a custom compatible node has headersEnabled + customHeaders,
 * every outbound path must apply those headers (case-insensitive), and User-Agent
 * must not be lost to Next.js fetch overrides.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  applyCustomHeaders,
  withCustomHeaders,
  hasCustomHeaders,
  customHeadersFrom,
  customProviderFetch,
} from "open-sse/utils/customHeaders.js";
import { DefaultExecutor } from "open-sse/executors/default.js";
import createOpenAIEmbeddingAdapter from "open-sse/handlers/embeddingProviders/openai.js";

// openaiCompatNode is the default export of the module
import openaiCompatNode from "open-sse/handlers/embeddingProviders/openaiCompatNode.js";

const PSD = {
  headersEnabled: true,
  customHeaders: [
    { key: "User-Agent", value: "MyCustomClient/1.0" },
    { key: "X-Custom-Gate", value: "secret-token" },
  ],
  baseUrl: "https://custom.example.com/v1",
};

describe("customHeaders helpers", () => {
  it("hasCustomHeaders detects enabled non-empty headers", () => {
    expect(hasCustomHeaders(PSD)).toBe(true);
    expect(hasCustomHeaders({ headersEnabled: false, customHeaders: PSD.customHeaders })).toBe(false);
    expect(hasCustomHeaders({ headersEnabled: true, customHeaders: [] })).toBe(false);
    expect(hasCustomHeaders(null)).toBe(false);
  });

  it("applyCustomHeaders wins case-insensitively over existing keys", () => {
    const headers = {
      "User-Agent": "node",
      Authorization: "Bearer sk-x",
      "Content-Type": "application/json",
    };
    applyCustomHeaders(headers, PSD);
    expect(headers["user-agent"]).toBe("MyCustomClient/1.0");
    expect(headers["User-Agent"]).toBeUndefined();
    expect(headers["x-custom-gate"]).toBe("secret-token");
    expect(headers.Authorization).toBe("Bearer sk-x");
  });

  it("withCustomHeaders does not mutate the input object", () => {
    const base = { Authorization: "Bearer sk-x" };
    const out = withCustomHeaders(base, PSD);
    expect(out["user-agent"]).toBe("MyCustomClient/1.0");
    expect(base["user-agent"]).toBeUndefined();
    expect(base.Authorization).toBe("Bearer sk-x");
  });

  it("customHeadersFrom reads node fields and nested providerSpecificData", () => {
    expect(customHeadersFrom({ headersEnabled: true, customHeaders: PSD.customHeaders })).toEqual({
      headersEnabled: true,
      customHeaders: PSD.customHeaders,
    });
    expect(customHeadersFrom({ providerSpecificData: PSD })).toEqual({
      headersEnabled: true,
      customHeaders: PSD.customHeaders,
    });
  });
});

describe("DefaultExecutor.buildHeaders — custom headers always last", () => {
  it("openai-compatible applies User-Agent and extra gate headers", () => {
    const executor = new DefaultExecutor("openai-compatible-test");
    const headers = executor.buildHeaders(
      { apiKey: "sk-test", providerSpecificData: PSD },
      false
    );
    expect(headers["user-agent"]).toBe("MyCustomClient/1.0");
    expect(headers["x-custom-gate"]).toBe("secret-token");
    expect(headers.Authorization || headers.authorization).toMatch(/Bearer sk-test/);
  });

  it("anthropic-compatible applies custom headers after auth setup", () => {
    const executor = new DefaultExecutor("anthropic-compatible-test");
    const headers = executor.buildHeaders(
      {
        apiKey: "sk-ant",
        providerSpecificData: {
          ...PSD,
          baseUrl: "https://third-party.example.com/v1",
        },
      },
      false
    );
    expect(headers["user-agent"]).toBe("MyCustomClient/1.0");
    expect(headers["x-custom-gate"]).toBe("secret-token");
    expect(headers["x-api-key"] || headers["X-Api-Key"]).toBe("sk-ant");
  });

  it("does not apply headers when headersEnabled is false", () => {
    const executor = new DefaultExecutor("openai-compatible-test");
    const headers = executor.buildHeaders(
      {
        apiKey: "sk-test",
        providerSpecificData: { ...PSD, headersEnabled: false },
      },
      false
    );
    expect(headers["user-agent"]).toBeUndefined();
    expect(headers["x-custom-gate"]).toBeUndefined();
  });
});

describe("openaiCompatNode.buildHeaders — embeddings path", () => {
  it("applies custom headers for openai-compatible embedding nodes", () => {
    const headers = openaiCompatNode.buildHeaders({
      apiKey: "sk-embed",
      providerSpecificData: PSD,
    });
    expect(headers["user-agent"]).toBe("MyCustomClient/1.0");
    expect(headers["x-custom-gate"]).toBe("secret-token");
    expect(headers.Authorization).toBe("Bearer sk-embed");
  });

  it("stock openai adapter does not invent custom headers", () => {
    const stock = createOpenAIEmbeddingAdapter("openai");
    const headers = stock.buildHeaders({ apiKey: "sk-x", providerSpecificData: PSD });
    // stock adapter ignores providerSpecificData custom headers — only compat node applies them
    expect(headers["user-agent"]).toBeUndefined();
  });
});

describe("customProviderFetch", () => {
  let proxyAwareFetch;

  beforeEach(async () => {
    vi.resetModules();
    proxyAwareFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.doMock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch }));
  });

  afterEach(() => {
    vi.doUnmock("open-sse/utils/proxyFetch.js");
    vi.restoreAllMocks();
  });

  it("forwards custom headers and always sets bypassNextjsFetch", async () => {
    // Re-import so the dynamic import inside customProviderFetch picks up the mock
    const { customProviderFetch: fetchFn } = await import("open-sse/utils/customHeaders.js");
    // dynamic import of proxyFetch happens inside; mock via vi.spyOn on the real module
    const proxyMod = await import("open-sse/utils/proxyFetch.js");
    const spy = vi.spyOn(proxyMod, "proxyAwareFetch").mockResolvedValue({ ok: true, status: 200 });

    await fetchFn("https://custom.example.com/v1/models", {
      method: "GET",
      headers: { Authorization: "Bearer sk-x" },
      providerSpecificData: PSD,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, opts] = spy.mock.calls[0];
    expect(url).toBe("https://custom.example.com/v1/models");
    expect(opts.bypassNextjsFetch).toBe(true);
    expect(opts.headers["user-agent"]).toBe("MyCustomClient/1.0");
    expect(opts.headers["x-custom-gate"]).toBe("secret-token");
    expect(opts.headers.Authorization).toBe("Bearer sk-x");
    spy.mockRestore();
  });
});
