/**
 * Custom headers for dynamic compatible provider nodes
 * (openai-compatible-* / anthropic-compatible-* / custom-embedding-*).
 *
 * Contract: every outbound HTTP call to such a node MUST apply these helpers
 * so User-Agent and other gate headers always reach the upstream.
 *
 * Custom headers win over anything already set (case-insensitive), so a custom
 * "user-agent" replaces an existing "User-Agent" instead of sending both.
 */

/**
 * @param {object|null|undefined} providerSpecificData
 * @returns {boolean}
 */
export function hasCustomHeaders(providerSpecificData) {
  const psd = providerSpecificData || {};
  if (!psd.headersEnabled || !Array.isArray(psd.customHeaders)) return false;
  return psd.customHeaders.some((h) => h?.key && String(h.key).trim());
}

/**
 * Merge user-defined custom headers into an outgoing header object, in place.
 *
 * @param {Record<string,string>} headers - header object mutated in place
 * @param {object|null|undefined} providerSpecificData - connection.providerSpecificData
 *   or a pseudo-object `{ headersEnabled, customHeaders }`
 * @returns {Record<string,string>} the same headers object
 */
export function applyCustomHeaders(headers, providerSpecificData) {
  const psd = providerSpecificData || {};
  if (!psd.headersEnabled || !Array.isArray(psd.customHeaders)) return headers;

  for (const h of psd.customHeaders) {
    if (h?.key && h.key.trim()) {
      const key = h.key.trim().toLowerCase();
      for (const existingKey of Object.keys(headers)) {
        if (existingKey.toLowerCase() === key) {
          delete headers[existingKey];
        }
      }
      headers[key] = (h.value || "").trim();
    }
  }
  return headers;
}

/**
 * Copy base headers then apply custom headers (non-mutating for the input).
 *
 * @param {Record<string,string>} baseHeaders
 * @param {object|null|undefined} providerSpecificData
 * @returns {Record<string,string>}
 */
export function withCustomHeaders(baseHeaders = {}, providerSpecificData) {
  const headers = { ...(baseHeaders || {}) };
  applyCustomHeaders(headers, providerSpecificData);
  return headers;
}

/**
 * Build providerSpecificData shape from a node or loose fields.
 * Useful when validate routes receive headersEnabled/customHeaders at the top level.
 *
 * @param {object|null|undefined} source
 * @returns {{ headersEnabled: boolean, customHeaders: Array }}
 */
export function customHeadersFrom(source) {
  if (!source || typeof source !== "object") {
    return { headersEnabled: false, customHeaders: [] };
  }
  // Prefer nested providerSpecificData when present
  const nested = source.providerSpecificData;
  if (nested && typeof nested === "object" && ("headersEnabled" in nested || "customHeaders" in nested)) {
    return {
      headersEnabled: nested.headersEnabled === true,
      customHeaders: Array.isArray(nested.customHeaders) ? nested.customHeaders : [],
    };
  }
  return {
    headersEnabled: source.headersEnabled === true,
    customHeaders: Array.isArray(source.customHeaders) ? source.customHeaders : [],
  };
}

/**
 * Outbound fetch for custom compatible providers.
 * Always:
 *  - applies custom headers from providerSpecificData
 *  - bypasses Next.js fetch (it aggressively overwrites User-Agent)
 * Optionally forwards connection proxy options.
 *
 * @param {string} url
 * @param {object} [options]
 * @param {Record<string,string>} [options.headers]
 * @param {object|null} [options.providerSpecificData]
 * @param {string} [options.method]
 * @param {string|undefined} [options.body]
 * @param {AbortSignal|undefined} [options.signal]
 * @param {object|null} [options.proxyOptions]
 * @returns {Promise<Response>}
 */
export async function customProviderFetch(url, options = {}) {
  const {
    headers = {},
    providerSpecificData = null,
    method = "GET",
    body,
    signal,
    proxyOptions = null,
  } = options;

  const { proxyAwareFetch } = await import("./proxyFetch.js");
  const finalHeaders = withCustomHeaders(headers, providerSpecificData);

  return proxyAwareFetch(
    url,
    {
      method,
      headers: finalHeaders,
      body,
      signal,
      bypassNextjsFetch: true,
    },
    proxyOptions
  );
}
