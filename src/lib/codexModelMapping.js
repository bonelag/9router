export const CODEX_STANDARD_MODELS = [
  { id: "gpt-6.1-sol", name: "GPT 6.1 Sol" },
  { id: "gpt-6.1-terra", name: "GPT 6.1 Terra" },
  { id: "gpt-6-astra", name: "GPT 6.0 Astra" },
  { id: "gpt-6-sol", name: "GPT 6.0 Sol" },
  { id: "gpt-6-luna", name: "GPT 6.0 Luna" },
  { id: "gpt-5.6-sol", name: "GPT 5.6 Sol" },
  { id: "gpt-5.6-terra", name: "GPT 5.6 Terra" },
  { id: "gpt-5.6-luna", name: "GPT 5.6 Luna" },
  { id: "gpt-daybreak-blue-latest", name: "GPT Daybreak Blue" },
  { id: "gpt-reserve", name: "GPT Reserve" },
  { id: "codex-auto-review", name: "Codex Auto Review" },
];

/**
 * Applies Codex model mapping to redirect incoming Codex standard models
 * to configured target models on 9Router.
 *
 * @param {string} model - Requested model ID
 * @param {Record<string, string>} mapping - Mapping configuration { [sourceId]: targetId }
 * @returns {string} - Mapped target model ID, or original model ID if unmapped
 */
export function applyCodexModelMapping(model, mapping) {
  if (!model || typeof model !== "string" || !mapping || typeof mapping !== "object") {
    return model;
  }

  // 1. Direct match (exact key in mapping)
  if (typeof mapping[model] === "string" && mapping[model].trim()) {
    return mapping[model].trim();
  }

  // 2. Strip provider prefix if present (codex/ or cx/)
  let bare = model.trim();
  if (bare.startsWith("codex/")) {
    bare = bare.slice(6);
  } else if (bare.startsWith("cx/")) {
    bare = bare.slice(3);
  }

  if (typeof mapping[bare] === "string" && mapping[bare].trim()) {
    return mapping[bare].trim();
  }

  // 3. Strip context marker suffix e.g. [1m]
  const bracketIndex = bare.indexOf("[");
  if (bracketIndex > 0 && bare.endsWith("]")) {
    const withoutMarker = bare.slice(0, bracketIndex);
    if (typeof mapping[withoutMarker] === "string" && mapping[withoutMarker].trim()) {
      return mapping[withoutMarker].trim();
    }
  }

  return model;
}

