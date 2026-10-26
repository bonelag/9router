/**
 * Client adaptation for /v1/models.
 * Detects client tool (Claude Code, Cursor, Grok Build, Codex, etc.) via User-Agent / headers
 * and adapts the model list and single model response to match each client's expected shape.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { getThinkingLevels } from "open-sse/providers/thinkingLevels.js";
import { findModelName } from "open-sse/config/providerModels.js";
import { deriveModelName } from "open-sse/providers/models/namePatterns.js";
import { ALIAS_TO_ID } from "@/shared/constants/providers";
import { toClaudeGatewayAlias, resolveClaudeGatewayAlias } from "open-sse/utils/claudeGatewayAlias.js";
import { stripModelContextMarker } from "open-sse/utils/modelMarkers.js";

export const CLIENT_TYPES = {
  ANTHROPIC: "anthropic",
  CURSOR: "cursor",
  GROK: "grok",
  CODEX: "codex",
  OPENAI: "openai",
};

const GROK_KNOWN_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
const ANTHROPIC_EFFORT_RUNGS = new Set(["low", "medium", "high", "xhigh", "max"]);
const ONE_MILLION = 1_000_000;
const CONTEXT_1M_THRESHOLD = 300_000;
const MODEL_INFO_CREATED_AT = "2026-01-01T00:00:00Z";

/**
 * Check if a model ID represents a model with a fixed thinking effort suffix
 * (e.g. -high, -medium, -low, -xhigh, -max, -minimal, -none, etc.).
 * These models already have their thinking effort pre-configured and should not
 * advertise thinking effort options so clients do not try to modify or override thinking.
 */
export function isFixedEffortModel(modelId) {
  if (!modelId || typeof modelId !== "string") return false;
  const base = modelId.includes("/") ? modelId.split("/").pop() : modelId;
  const lower = base.toLowerCase();

  // Exclude known non-effort model names that happen to contain -max or -medium
  if (/^qwen[\d.]*-max(?:-preview)?$/i.test(lower)) return false;
  if (/^mistral-medium(?:-latest)?$/i.test(lower)) return false;
  if (/^sd[\d.]*-medium$/i.test(lower)) return false;
  if (/^flux-.*-max$/i.test(lower)) return false;
  if (/^inworld-tts.*-max$/i.test(lower)) return false;

  const FIXED_EFFORT_REGEX = /(?:[-_](?:extra[-_])?(?:low|medium|high|xhigh|max|minimal|none)|\((?:extra[-_])?(?:low|medium|high|xhigh|max|minimal|none|off)\))(?:-(?:fast|priority|thinking))?$/i;
  return FIXED_EFFORT_REGEX.test(lower);
}

/**
 * Detect client type from request headers, user-agent, or query parameters.
 * @param {Request} request
 * @returns {string} One of CLIENT_TYPES
 */
export function detectModelsClient(request) {
  if (!request) return CLIENT_TYPES.OPENAI;

  const url = new URL(request.url, "http://localhost");
  const headers = request.headers;
  const ua = (headers?.get("user-agent") || "").toLowerCase();
  const anthropicVersion = headers?.get("anthropic-version");
  const anthropicBeta = headers?.get("anthropic-beta");
  const xApp = (headers?.get("x-app") || "").toLowerCase();
  const xClientName = (headers?.get("x-client-name") || "").toLowerCase();
  const flavor = url.searchParams.get("flavor")?.toLowerCase();

  // 1. Anthropic / Claude Code
  if (
    anthropicVersion !== null ||
    anthropicBeta !== null ||
    flavor === "anthropic" ||
    flavor === "claude" ||
    url.searchParams.has("claude") ||
    ua.includes("claude") ||
    ua.includes("@anthropic-ai") ||
    ua.includes("anthropic") ||
    xApp === "cli" ||
    xClientName.includes("claude") ||
    (headers?.get("x-api-key") !== null && headers?.get("authorization") === null)
  ) {
    return CLIENT_TYPES.ANTHROPIC;
  }

  // 2. Cursor
  if (
    flavor === "cursor" ||
    ua.includes("cursor") ||
    headers?.get("x-cursor-client") !== null
  ) {
    return CLIENT_TYPES.CURSOR;
  }

  // 3. Grok Build / Grok CLI
  if (
    flavor === "grok" ||
    ua.includes("grok-build") ||
    ua.includes("grok-cli") ||
    ua.includes("grok") ||
    headers?.get("x-opencodex-grok") === "1"
  ) {
    return CLIENT_TYPES.GROK;
  }

  // 4. Codex CLI / Desktop
  if (
    url.searchParams.has("client_version") ||
    flavor === "codex" ||
    ua.includes("codex-tui") ||
    ua.includes("codex-cli") ||
    ua.includes("codex desktop") ||
    ua.includes("codex_cli_rs")
  ) {
    return CLIENT_TYPES.CODEX;
  }

  // Default: OpenAI compatible
  return CLIENT_TYPES.OPENAI;
}

/**
 * Extract resolved capability metadata for a model entry.
 */
export function resolveModelMeta(model) {
  const modelIdStr = String(model?.id || "");
  const cleanId = modelIdStr.endsWith("[1m]") ? modelIdStr.slice(0, -4) : modelIdStr;
  const unaliased = resolveClaudeGatewayAlias(cleanId);
  let providerAlias = model?.owned_by || "";
  let rawModelId = unaliased;

  if (unaliased.includes("/")) {
    const slashIdx = unaliased.indexOf("/");
    providerAlias = providerAlias || unaliased.slice(0, slashIdx);
    rawModelId = unaliased.slice(slashIdx + 1);
  }

  const providerId = ALIAS_TO_ID[providerAlias] || providerAlias;
  const cleanRawModelId = rawModelId.endsWith("[1m]") ? rawModelId.slice(0, -4) : rawModelId;
  const baseModel = cleanRawModelId.includes("/") ? cleanRawModelId.split("/").pop() : cleanRawModelId;

  // Capabilities: use existing on model if present, otherwise resolve
  const rawCaps = model?.capabilities || (providerId ? (getCapabilitiesForModel(providerId, rawModelId) || getCapabilitiesForModel(providerId, cleanRawModelId)) : null);
  const fallback = providerId ? (getCapabilitiesForModel(providerId, rawModelId) || getCapabilitiesForModel(providerId, cleanRawModelId)) : {};
  const caps = {
    ...fallback,
    ...(rawCaps || {}),
  };

  const contextLength = Number.isFinite(model?.context_length)
    ? model.context_length
    : (Number.isFinite(model?.context_window)
      ? model.context_window
      : (Number.isFinite(caps.contextWindow)
        ? caps.contextWindow
        : (Number.isFinite(fallback.contextWindow) ? fallback.contextWindow : 200000)));

  const maxOutput = Number.isFinite(model?.max_completion_tokens)
    ? model.max_completion_tokens
    : (Number.isFinite(model?.max_output_tokens)
      ? model.max_output_tokens
      : (Number.isFinite(caps.maxOutput)
        ? caps.maxOutput
        : (Number.isFinite(fallback.maxOutput) ? fallback.maxOutput : 8192)));

  // Display name
  const displayName = findModelName(providerAlias, rawModelId) || findModelName(providerAlias, cleanRawModelId) || deriveModelName(rawModelId) || modelIdStr;

  // Check if model already carries a fixed thinking effort suffix (e.g. -high, -medium)
  const isFixedEffort = isFixedEffortModel(modelIdStr);

  // Thinking / Reasoning levels
  let thinkingLevels = providerId ? getThinkingLevels(providerId, rawModelId) : null;
  if (!thinkingLevels && caps.reasoning) {
    thinkingLevels = ["low", "medium", "high"];
  }

  // If model already has a fixed effort suffix, suppress effort ladder/options
  const hasReasoning = Boolean(caps.reasoning && thinkingLevels && thinkingLevels.length > 0);
  const effortLadders = (!isFixedEffort && hasReasoning) ? thinkingLevels.filter((l) => l !== "none") : [];
  const defaultEffort = effortLadders.includes("medium")
    ? "medium"
    : (effortLadders.includes("high") ? "high" : effortLadders[0] || "medium");

  const grokEfforts = (!isFixedEffort && hasReasoning)
    ? thinkingLevels
        .filter((l) => GROK_KNOWN_EFFORTS.includes(l))
        .map((lvl) => ({
          value: lvl,
          label: `${lvl.charAt(0).toUpperCase()}${lvl.slice(1)} Effort`,
          ...(lvl === defaultEffort ? { default: true } : {}),
        }))
    : [];

  return {
    providerAlias,
    providerId,
    rawModelId,
    baseModel,
    displayName,
    caps,
    contextLength,
    maxOutput,
    hasReasoning,
    isFixedEffort,
    effortLadders,
    defaultEffort,
    grokEfforts,
  };
}

/**
 * Format a single model for Anthropic / Claude Code clients.
 */
export function formatAnthropicModel(model) {
  const meta = resolveModelMeta(model);
  const ladder = meta.effortLadders;
  const hasEffort = ladder.length > 0;
  const rungs = new Set(ladder.filter((r) => ANTHROPIC_EFFORT_RUNGS.has(r)));

  const aliasedId = toClaudeGatewayAlias(model.id);
  const providerTag = meta.providerAlias && !meta.displayName.toLowerCase().includes(meta.providerAlias.toLowerCase())
    ? ` (${meta.providerAlias})`
    : "";
  const displayName = `${meta.displayName}${providerTag}`;

  return {
    id: aliasedId,
    display_name: displayName,
    description: `Routed by 9router to ${model.id}`,
    type: "model",
    created_at: MODEL_INFO_CREATED_AT,
    capabilities: {
      batch: { supported: false },
      citations: { supported: false },
      code_execution: { supported: false },
      context_management: {
        supported: false,
        clear_thinking_20251015: null,
        clear_tool_uses_20250919: null,
        compact_20260112: null,
      },
      effort: {
        supported: hasEffort,
        low: { supported: rungs.has("low") || ladder.includes("minimal") },
        medium: { supported: rungs.has("medium") },
        high: { supported: rungs.has("high") },
        max: { supported: rungs.has("max") },
        xhigh: hasEffort ? { supported: rungs.has("xhigh") } : null,
      },
      image_input: { supported: Boolean(meta.caps.vision) },
      pdf_input: { supported: Boolean(meta.caps.pdf) },
      structured_outputs: { supported: false },
      thinking: (meta.hasReasoning && !meta.isFixedEffort)
        ? {
            supported: true,
            types: {
              adaptive: { supported: true },
              enabled: { supported: true },
            },
          }
        : {
            supported: false,
            types: {
              adaptive: { supported: false },
              enabled: { supported: false },
            },
          },
    },
    max_input_tokens: meta.contextLength > 0 ? meta.contextLength : null,
    max_tokens: null,
  };
}

/**
 * Normalize a model ID for comparison by stripping [1m] context marker,
 * decoding any Claude gateway alias (9r-claude-...), trimming, and lowercasing.
 */
export function normalizeModelId(id) {
  if (!id || typeof id !== "string") return "";
  const { model } = stripModelContextMarker(id.trim());
  const unaliased = resolveClaudeGatewayAlias(model);
  const clean = stripModelContextMarker(unaliased).model;
  return clean.trim().toLowerCase();
}

/**
 * Check if a model matches any of the official Claude Code model slots (fable, opus, sonnet, haiku).
 * Matches both base and [1m] versions, as well as aliased IDs (9r-claude-...).
 */
export function isOfficialModel(modelId, officialModels) {
  if (!modelId || !officialModels) return false;
  const list = Array.isArray(officialModels)
    ? officialModels
    : (officialModels instanceof Set ? Array.from(officialModels) : [officialModels]);
  if (list.length === 0) return false;

  const normModel = normalizeModelId(modelId);
  if (!normModel) return false;

  const modelHasSlash = normModel.includes("/");
  const modelBare = modelHasSlash ? normModel.split("/").pop() : normModel;
  const modelWithoutProvider = modelHasSlash ? normModel.slice(normModel.indexOf("/") + 1) : normModel;

  for (const official of list) {
    if (!official) continue;
    const normOfficial = normalizeModelId(official);
    if (!normOfficial) continue;

    // 1. Exact match
    if (normModel === normOfficial) return true;

    const officialHasSlash = normOfficial.includes("/");
    // If BOTH have slashes and they didn't match exactly, do NOT cross-match different providers
    if (modelHasSlash && officialHasSlash) {
      continue;
    }

    // One of them does not have a slash: check if model name matches
    const officialBare = officialHasSlash ? normOfficial.split("/").pop() : normOfficial;
    const officialWithoutProvider = officialHasSlash ? normOfficial.slice(normOfficial.indexOf("/") + 1) : normOfficial;

    if (modelWithoutProvider === normOfficial || officialWithoutProvider === normModel) {
      return true;
    }
    if (modelBare === officialBare) {
      return true;
    }
  }

  return false;
}

export function getClaudeSettingsPath() {
  const custom = process.env.CLAUDE_CONFIG_DIR;
  const configDir = custom && custom.length > 0 ? custom : path.join(os.homedir(), ".claude");
  return path.join(configDir, "settings.json");
}

export function readClaudeOfficialModelIds() {
  try {
    const settingsPath = getClaudeSettingsPath();
    if (!fs.existsSync(settingsPath)) return [];
    const content = fs.readFileSync(settingsPath, "utf-8");
    const stripped = content.replace(/,(\s*[}\]])/g, "$1");
    const parsed = JSON.parse(stripped);
    const env = parsed?.env;
    if (!env || typeof env !== "object") return [];

    const keys = [
      "ANTHROPIC_DEFAULT_OPUS_MODEL",
      "ANTHROPIC_DEFAULT_SONNET_MODEL",
      "ANTHROPIC_DEFAULT_HAIKU_MODEL",
      "ANTHROPIC_DEFAULT_FABLE_MODEL",
    ];
    const results = [];
    for (const key of keys) {
      const val = env[key];
      if (typeof val === "string" && val.trim()) {
        results.push(val.trim());
      }
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * Format models list for Anthropic / Claude Code.
 * Automatically emits [1m] variant for models with context >= 300,000 tokens (Claude Code native convention).
 * Excludes official models (fable, opus, sonnet, haiku) from the extended models list.
 */
export function formatAnthropicModelList(models, options = {}) {
  const officialModels = options?.officialModels !== undefined
    ? options.officialModels
    : readClaudeOfficialModelIds();
  const result = [];
  const seenIds = new Set();

  for (const model of models) {
    if (!model?.id) continue;
    if (isOfficialModel(model.id, officialModels)) continue;

    const anthropicItem = formatAnthropicModel(model);
    if (isOfficialModel(anthropicItem.id, officialModels)) continue;
    if (seenIds.has(anthropicItem.id)) continue;
    seenIds.add(anthropicItem.id);

    result.push(anthropicItem);

    // [1m] variant for models with >= 300K context (Claude Code native convention)
    const meta = resolveModelMeta(model);
    if ((meta.contextLength >= CONTEXT_1M_THRESHOLD || meta.contextLength >= ONE_MILLION) && !anthropicItem.id.includes("[1m]")) {
      const oneMillionId = `${anthropicItem.id}[1m]`;
      if (!isOfficialModel(oneMillionId, officialModels) && !seenIds.has(oneMillionId)) {
        seenIds.add(oneMillionId);
        result.push({
          ...anthropicItem,
          id: oneMillionId,
          display_name: `${anthropicItem.display_name} [1m]`,
          max_input_tokens: meta.contextLength >= ONE_MILLION ? ONE_MILLION : meta.contextLength,
        });
      }
    }
  }

  return { data: result };
}

/**
 * Format a single model for Cursor clients.
 */
export function formatCursorModel(model) {
  const meta = resolveModelMeta(model);
  const supportsVision = Boolean(meta.caps.vision);
  const supportsReasoning = Boolean(meta.hasReasoning && !meta.isFixedEffort);

  const cleanCaps = { ...(meta.caps || {}) };
  if (meta.isFixedEffort) {
    delete cleanCaps.reasoning_effort;
  }

  return {
    id: model.id,
    object: "model",
    created: 0,
    owned_by: model.owned_by || meta.providerAlias || "9router",
    api_types: ["chat_completions", "responses", "anthropic_messages"],
    capabilities: {
      ...cleanCaps,
      context_length: meta.contextLength,
      max_output_tokens: meta.maxOutput,
      output_modalities: ["text"],
      input_modalities: supportsVision ? ["text", "image"] : ["text"],
      supports_tool_use: meta.caps.tools !== false,
      supports_streaming: true,
      supports_reasoning: supportsReasoning,
      supports_vision: supportsVision,
      ...(meta.effortLadders.length > 0 ? { reasoning_effort: meta.effortLadders } : {}),
    },
    context_window: meta.contextLength,
    context_length: meta.contextLength,
    max_output_tokens: meta.maxOutput,
    ...(supportsReasoning && meta.grokEfforts.length > 0
      ? {
          supports_reasoning_effort: true,
          reasoning_effort: meta.defaultEffort,
          reasoning_efforts: meta.grokEfforts,
        }
      : {}),
  };
}

/**
 * Format models list for Cursor clients.
 */
export function formatCursorModelList(models) {
  return {
    object: "list",
    data: models.map(formatCursorModel),
  };
}

/**
 * Format a single model for Grok Build clients.
 */
export function formatGrokModel(model) {
  const meta = resolveModelMeta(model);
  const supportsReasoning = Boolean(meta.hasReasoning && !meta.isFixedEffort);

  const cleanCaps = { ...(meta.caps || {}) };
  if (meta.isFixedEffort) {
    delete cleanCaps.reasoning_effort;
  }

  return {
    id: model.id,
    object: "model",
    created: 0,
    owned_by: model.owned_by || meta.providerAlias || "9router",
    context_window: meta.contextLength,
    context_length: meta.contextLength,
    max_output_tokens: meta.maxOutput,
    capabilities: {
      ...cleanCaps,
      context_length: meta.contextLength,
      max_output_tokens: meta.maxOutput,
      supports_reasoning: supportsReasoning,
    },
    ...(supportsReasoning && meta.grokEfforts.length > 0
      ? {
          supports_reasoning_effort: true,
          reasoning_effort: meta.defaultEffort,
          reasoning_efforts: meta.grokEfforts,
        }
      : {}),
  };
}

/**
 * Format models list for Grok Build clients.
 */
export function formatGrokModelList(models) {
  return {
    object: "list",
    data: models.map(formatGrokModel),
  };
}

/**
 * Format a single model for Codex clients.
 */
export function formatCodexModel(model) {
  return formatGrokModel(model);
}

/**
 * Format models list for Codex clients.
 */
export function formatCodexModelList(models, isClientVersionQuery = false) {
  const formatted = models.map(formatCodexModel);
  if (isClientVersionQuery) {
    return { models: formatted };
  }
  return { object: "list", data: formatted };
}

/**
 * Format a single model for Default OpenAI clients.
 * Combines full compatibility: context window metrics, api_types, and reasoning efforts.
 */
export function formatOpenAIModel(model) {
  const meta = resolveModelMeta(model);
  const supportsVision = Boolean(meta.caps.vision);
  const supportsReasoning = Boolean(meta.hasReasoning && !meta.isFixedEffort);

  const cleanCaps = { ...(meta.caps || {}) };
  if (meta.isFixedEffort) {
    delete cleanCaps.reasoning_effort;
  }

  return {
    id: model.id,
    object: "model",
    created: 0,
    owned_by: model.owned_by || meta.providerAlias || "9router",
    capabilities: {
      ...cleanCaps,
      context_length: meta.contextLength,
      max_output_tokens: meta.maxOutput,
      output_modalities: ["text"],
      input_modalities: supportsVision ? ["text", "image"] : ["text"],
      supports_tool_use: meta.caps.tools !== false,
      supports_streaming: true,
      supports_reasoning: supportsReasoning,
      supports_vision: supportsVision,
      ...(meta.effortLadders.length > 0 ? { reasoning_effort: meta.effortLadders } : {}),
    },
    context_window: meta.contextLength,
    context_length: meta.contextLength,
    max_output_tokens: meta.maxOutput,
    max_completion_tokens: meta.maxOutput,
    api_types: ["chat_completions", "responses", "anthropic_messages"],
    ...(supportsReasoning && meta.grokEfforts.length > 0
      ? {
          supports_reasoning_effort: true,
          reasoning_effort: meta.defaultEffort,
          reasoning_efforts: meta.grokEfforts,
        }
      : {}),
  };
}

/**
 * Format models list for Default OpenAI clients.
 */
export function formatOpenAIModelList(models) {
  return {
    object: "list",
    data: models.map(formatOpenAIModel),
  };
}

/**
 * Main adapter function: adapts raw models list based on client detection.
 * @param {Array} models - Raw models from buildModelsList()
 * @param {Request} request
 * @returns {object} Adapted JSON payload
 */
export function adaptModelsResponse(models, request, options = {}) {
  const clientType = detectModelsClient(request);
  const url = request ? new URL(request.url, "http://localhost") : null;
  const isClientVersionQuery = Boolean(url?.searchParams.has("client_version"));

  switch (clientType) {
    case CLIENT_TYPES.ANTHROPIC:
      return formatAnthropicModelList(models, options);
    case CLIENT_TYPES.CURSOR:
      return formatCursorModelList(models);
    case CLIENT_TYPES.GROK:
      return formatGrokModelList(models);
    case CLIENT_TYPES.CODEX:
      return formatCodexModelList(models, isClientVersionQuery);
    case CLIENT_TYPES.OPENAI:
    default:
      return formatOpenAIModelList(models);
  }
}

/**
 * Main adapter function for single model lookup.
 * @param {object} model - Model object
 * @param {Request} request
 * @returns {object} Adapted JSON payload
 */
export function adaptSingleModelResponse(model, request) {
  const clientType = detectModelsClient(request);

  switch (clientType) {
    case CLIENT_TYPES.ANTHROPIC:
      return formatAnthropicModel(model);
    case CLIENT_TYPES.CURSOR:
      return formatCursorModel(model);
    case CLIENT_TYPES.GROK:
      return formatGrokModel(model);
    case CLIENT_TYPES.CODEX:
      return formatCodexModel(model);
    case CLIENT_TYPES.OPENAI:
    default:
      return formatOpenAIModel(model);
  }
}
