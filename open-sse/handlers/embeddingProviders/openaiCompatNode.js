// Custom node providers (openai-compatible-* / custom-embedding-*) — baseUrl from credentials
import createOpenAIEmbeddingAdapter from "./openai.js";
import { withCustomHeaders } from "../../utils/customHeaders.js";

const baseAdapter = createOpenAIEmbeddingAdapter("openai");

export default {
  ...baseAdapter,
  buildUrl: (_model, creds) => {
    const rawBaseUrl = creds?.providerSpecificData?.baseUrl || "https://api.openai.com/v1";
    const baseUrl = rawBaseUrl.replace(/\/$/, "").replace(/\/embeddings$/, "");
    return `${baseUrl}/embeddings`;
  },
  // Always apply node custom headers (User-Agent, etc.) for custom compatible nodes
  buildHeaders: (creds, ctx) => {
    const base = baseAdapter.buildHeaders(creds, ctx);
    return withCustomHeaders(base, creds?.providerSpecificData);
  },
};
