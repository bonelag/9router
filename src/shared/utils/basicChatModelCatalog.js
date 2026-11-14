import {
  AI_PROVIDERS,
  getProviderAlias,
  isAnthropicCompatibleProvider,
  isOpenAICompatibleProvider,
} from "@/shared/constants/providers";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import {
  findModelName,
  getModelType,
  PROVIDER_ID_TO_ALIAS,
} from "open-sse/config/providerModels.js";

const IMAGE_MODEL_RE = /image|imagen|flux|sdxl|dall|stable-diffusion|nanobanana|nano-banana|recraft/i;

function textValue(value) {
  return typeof value === "string" ? value : "";
}

function humanize(value = "") {
  return String(value)
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getProviderDisplayName(providerId, connection) {
  const registryName = AI_PROVIDERS[providerId]?.name;
  if (registryName) return registryName;
  if (isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId)) {
    return connection?.providerSpecificData?.nodeName || connection?.name || humanize(providerId);
  }
  return humanize(providerId);
}

function getProviderType(providerId) {
  if (isOpenAICompatibleProvider(providerId)) return "openai-compatible";
  if (isAnthropicCompatibleProvider(providerId)) return "anthropic-compatible";
  return providerId;
}

function getCatalogAliases(connection, providerId) {
  return Array.from(new Set([
    textValue(connection?.providerSpecificData?.prefix).trim(),
    getProviderAlias(providerId),
    PROVIDER_ID_TO_ALIAS[providerId],
    providerId,
  ].filter(Boolean)));
}

function getRawModelId(model) {
  if (typeof model === "string") return model.trim();
  return textValue(model?.id || model?.model).trim();
}

function getModelOwner(model) {
  if (!model || typeof model === "string") return "";
  return textValue(model.owned_by || model.provider || model.providerId).trim();
}

function stripProviderPrefix(modelId, aliases) {
  const prefix = [...aliases]
    .sort((a, b) => b.length - a.length)
    .find((alias) => modelId.startsWith(`${alias}/`));
  return prefix ? modelId.slice(prefix.length + 1) : modelId;
}

function detectImageGen(providerId, modelId, model) {
  const providerAlias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
  const capabilities = model && typeof model === "object" ? model.capabilities : null;
  const outputModalities = capabilities?.output_modalities || capabilities?.outputModalities;
  if (Array.isArray(outputModalities) && outputModalities.includes("image")) return true;

  try {
    if (getCapabilitiesForModel(providerId, modelId)?.imageOutput) return true;
  } catch {
    // Fall through to registry/name checks.
  }
  try {
    if (getModelType(providerAlias, modelId) === "image") return true;
  } catch {
    // Fall through to the model-name heuristic.
  }
  return IMAGE_MODEL_RE.test(modelId);
}

function normalizeGatewayModel(model, group) {
  const requestModel = getRawModelId(model);
  if (!requestModel) return null;

  const bareId = stripProviderPrefix(requestModel, group.catalogAliases);
  const providerAlias = PROVIDER_ID_TO_ALIAS[group.providerId] || group.providerId;
  const suppliedName = typeof model === "string"
    ? ""
    : textValue(model.display_name || model.displayName || model.name).trim();
  const registryName = findModelName(providerAlias, bareId);
  const name = suppliedName && suppliedName !== requestModel
    ? suppliedName
    : registryName || bareId;

  return {
    id: requestModel,
    requestModel,
    displayModel: requestModel,
    name,
    providerId: group.providerId,
    providerName: group.providerName,
    source: "gateway",
    isImageGen: detectImageGen(group.providerId, bareId, model),
  };
}

export function parseBasicChatModelsPayload(data) {
  if (Array.isArray(data?.models)) return data.models;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data)) return data;
  return [];
}

export function buildBasicChatProviderGroups(connections, catalogModels) {
  const providerMap = new Map();
  const aliasToGroup = new Map();

  for (const connection of Array.isArray(connections) ? connections : []) {
    if (!connection || connection.isActive === false) continue;
    const providerId = connection.provider || connection.id;
    if (!providerId) continue;

    let group = providerMap.get(providerId);
    if (!group) {
      group = {
        providerId,
        providerName: getProviderDisplayName(providerId, connection),
        providerType: getProviderType(providerId),
        connections: [],
        models: [],
        catalogAliases: new Set(),
      };
      providerMap.set(providerId, group);
    }

    group.connections.push(connection);
    for (const alias of getCatalogAliases(connection, providerId)) {
      group.catalogAliases.add(alias);
      if (!aliasToGroup.has(alias)) aliasToGroup.set(alias, group);
    }
  }

  for (const model of Array.isArray(catalogModels) ? catalogModels : []) {
    const modelId = getRawModelId(model);
    if (!modelId) continue;

    const owner = getModelOwner(model);
    const modelPrefix = modelId.includes("/") ? modelId.slice(0, modelId.indexOf("/")) : "";
    const group = aliasToGroup.get(owner) || aliasToGroup.get(modelPrefix);
    if (!group) continue;

    const normalized = normalizeGatewayModel(model, group);
    if (normalized) group.models.push(normalized);
  }

  return Array.from(providerMap.values())
    .map(({ catalogAliases, ...group }) => {
      const uniqueModels = new Map();
      for (const model of group.models) {
        const key = model.requestModel.toLowerCase();
        if (!uniqueModels.has(key)) uniqueModels.set(key, model);
      }
      return {
        ...group,
        models: Array.from(uniqueModels.values()).sort((a, b) => a.name.localeCompare(b.name)),
      };
    })
    .filter((group) => group.models.length > 0)
    .sort((a, b) => a.providerName.localeCompare(b.providerName));
}
