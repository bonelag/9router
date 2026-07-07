/**
 * Merge user-defined custom headers (from a compatible provider node) into an
 * outgoing header object, in place. Custom headers win over anything already set
 * — matching is case-insensitive, so an existing "User-Agent" is replaced by a
 * custom "user-agent" instead of both being sent.
 *
 * Shared by every code path that builds upstream headers for dynamic compatible
 * providers (executors + connection tests) so the behaviour stays identical.
 *
 * @param {Record<string,string>} headers - header object mutated in place
 * @param {object} providerSpecificData - connection.providerSpecificData
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
