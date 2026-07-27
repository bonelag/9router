export const DEFAULT_CHROME_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

const isUserAgentHeader = (key) =>
  typeof key === "string" && key.trim().toLowerCase() === "user-agent";

export function splitCustomProviderHeaders(headers = []) {
  let customUserAgent = "";
  const customHeaders = [];

  for (const header of Array.isArray(headers) ? headers : []) {
    if (isUserAgentHeader(header?.key)) {
      const value = String(header?.value || "").trim();
      customUserAgent = value === DEFAULT_CHROME_USER_AGENT ? "" : value;
      continue;
    }
    customHeaders.push({ key: header?.key || "", value: header?.value || "" });
  }

  return { customUserAgent, customHeaders };
}

export function buildCustomProviderHeaders(customUserAgent, headers = []) {
  const userAgent = String(customUserAgent || "").trim() || DEFAULT_CHROME_USER_AGENT;
  const customHeaders = (Array.isArray(headers) ? headers : [])
    .filter((header) => header?.key?.trim() && !isUserAgentHeader(header.key))
    .map((header) => ({
      key: header.key.trim(),
      value: String(header.value || "").trim(),
    }));

  return [{ key: "User-Agent", value: userAgent }, ...customHeaders];
}
