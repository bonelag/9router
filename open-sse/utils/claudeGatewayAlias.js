/**
 * Gateway model-discovery alias generator and resolver for Claude Code.
 *
 * Claude Code CLI (/model picker and gateway discovery) filters models:
 *   filter((Q) => /(claude|anthropic)/i.test(Q.id))
 * Models whose IDs do not contain "claude" or "anthropic" (e.g. DeepSeek, GLM,
 * GPT, Qwen, Gemini, combos, etc.) are discarded by Claude Code.
 *
 * We expose routed non-Claude model IDs under the alias:
 *   9r-claude-<provider>--<model>  (or 9r-claude2- with ~s/~t escape for models with slashes)
 * The alias contains "claude" so Claude Code's discovery accepts it, but does not
 * start with "claude-" (Claude Code treats bare "claude-*" as first-party models).
 *
 * Incoming requests to /v1/messages, /v1/chat/completions, /v1/responses resolve
 * the alias back to the original provider/model or combo name.
 */

const PREFIX_9R = "9r-claude-";
const PREFIX_9R_V2 = "9r-claude2-";
const PREFIX_OCX = "ocx-claude-";
const PREFIX_OCX_V2 = "ocx-claude2-";
const PREFIX_LEGACY_1 = "claude-ocx-";
const PREFIX_LEGACY_2 = "claude-ocx2-";
const PREFIX_LEGACY_3 = "claude-9r-";
const PREFIX_LEGACY_4 = "claude-9r2-";

function encodePart(str) {
  return str.replaceAll("~", "~t").replaceAll("/", "~s");
}

function decodePart(str) {
  let out = "";
  for (let i = 0; i < str.length; i++) {
    if (str[i] === "~" && i + 1 < str.length) {
      if (str[i + 1] === "s") {
        out += "/";
        i++;
        continue;
      }
      if (str[i + 1] === "t") {
        out += "~";
        i++;
        continue;
      }
    }
    out += str[i];
  }
  return out;
}

/**
 * Check if a model ID already passes Claude Code's native discovery filter.
 */
export function isClaudeCodeCompatibleId(id) {
  return /(claude|anthropic)/i.test(String(id || ""));
}

/**
 * Generate a Claude Code-compatible alias for a model if needed.
 * Models already containing "claude" or "anthropic" keep their original ID.
 */
export function toClaudeGatewayAlias(modelId) {
  if (!modelId || typeof modelId !== "string") return modelId;
  const trimmed = modelId.trim();

  // Already matches Claude Code filter
  if (isClaudeCodeCompatibleId(trimmed)) {
    return trimmed;
  }

  // Split provider and model
  let provider = "combo";
  let rest = trimmed;
  const slashIdx = trimmed.indexOf("/");
  if (slashIdx > 0) {
    provider = trimmed.slice(0, slashIdx);
    rest = trimmed.slice(slashIdx + 1);
  }

  if (rest.includes("/") || rest.includes("~")) {
    return `${PREFIX_9R_V2}${provider}--${encodePart(rest)}`;
  }
  return `${PREFIX_9R}${provider}--${rest}`;
}

/**
 * Resolve an aliased model ID back to the canonical 9router model ID.
 * Returns the unaliased ID (or the original ID if it is not an alias).
 */
export function resolveClaudeGatewayAlias(modelId) {
  if (!modelId || typeof modelId !== "string") return modelId;
  const trimmed = modelId.trim();

  // Check v2 escape prefixes first
  for (const prefix of [PREFIX_9R_V2, PREFIX_OCX_V2, PREFIX_LEGACY_2, PREFIX_LEGACY_4]) {
    if (trimmed.startsWith(prefix)) {
      const rest = trimmed.slice(prefix.length);
      const sep = rest.indexOf("--");
      if (sep <= 0) return trimmed;
      const provider = rest.slice(0, sep);
      const encodedModel = rest.slice(sep + 2);
      const rawModel = decodePart(encodedModel);
      if (provider === "combo" || provider === "native") {
        return rawModel;
      }
      return `${provider}/${rawModel}`;
    }
  }

  // Check plain prefixes
  for (const prefix of [PREFIX_9R, PREFIX_OCX, PREFIX_LEGACY_1, PREFIX_LEGACY_3]) {
    if (trimmed.startsWith(prefix)) {
      const rest = trimmed.slice(prefix.length);
      const sep = rest.indexOf("--");
      if (sep <= 0) return trimmed;
      const provider = rest.slice(0, sep);
      const rawModel = rest.slice(sep + 2);
      if (provider === "combo" || provider === "native") {
        return rawModel;
      }
      return `${provider}/${rawModel}`;
    }
  }

  return trimmed;
}
