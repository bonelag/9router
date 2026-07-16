"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button } from "@/shared/components";
import { getModelsByProviderId } from "@/shared/constants/models";
import { AI_PROVIDERS, isAnthropicCompatibleProvider, isOpenAICompatibleProvider } from "@/shared/constants/providers";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { getModelType, PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";
import { marked } from "marked";
import DOMPurify from "dompurify";
import hljs from "highlight.js";
import "highlight.js/styles/atom-one-dark.css";

const renderer = new marked.Renderer();
renderer.code = function({ text, lang }) {
  const language = (lang || "").match(/\S*/)[0];
  let highlighted = text;
  let finalLang = language;
  
  const escapeHtml = (str) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  
  if (language && hljs.getLanguage(language)) {
    try {
      highlighted = hljs.highlight(text, { language }).value;
    } catch (err) {
      highlighted = escapeHtml(text);
    }
  } else {
    try {
      const result = hljs.highlightAuto(text);
      highlighted = result.value;
      finalLang = result.language || language;
    } catch (err) {
      highlighted = escapeHtml(text);
    }
  }

  const rawCodeAttr = encodeURIComponent(text);

  return `
    <div class="code-block-wrapper relative my-4 rounded-xl border border-white/10 bg-[#141414] shadow-lg">
      <div class="code-block-header sticky -top-4 z-10 flex items-center justify-between px-4 py-2 bg-[#1e1e1e] border-b border-white/5 text-xs text-white/70 rounded-t-xl">
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-[16px]">code</span>
          <span class="font-medium capitalize">${finalLang || 'Code'}</span>
        </div>
        <button type="button" class="copy-btn hover:text-white transition flex items-center gap-1" aria-label="Copy code" data-code="${rawCodeAttr}">
          <span class="copy-icon flex items-center"><span class="material-symbols-outlined text-[16px]">content_copy</span></span>
          <span class="check-icon hidden items-center gap-1 text-green-400"><span class="material-symbols-outlined text-[16px]">check</span> <span class="text-xs">Copied!</span></span>
        </button>
      </div>
      <div class="code-block-content p-4 overflow-x-auto custom-scrollbar">
        <pre class="!m-0 !p-0 !bg-transparent !border-0"><code class="hljs language-${finalLang || ''} !bg-transparent !p-0">${highlighted}</code></pre>
      </div>
    </div>
  `;
};

marked.setOptions({ gfm: true, breaks: true, renderer });

// Render untrusted model output (message content + reasoning) to sanitized HTML.
// marked passes raw HTML through by default, so model output could inject
// <script>/<img onerror> etc. — DOMPurify strips it. SSR has no DOM (DOMPurify
// no-ops without window); messages are client-only (localStorage) so returning ""
// on the server is safe and the client re-renders sanitized after hydration.
function renderMarkdown(src) {
  const html = marked.parse(src || "");
  if (typeof window === "undefined") return "";
  return DOMPurify.sanitize(html);
}

const STORAGE_KEYS = {
  sessions: "basic-chat.sessions",
  activeSessionId: "basic-chat.activeSessionId",
  activeProviderId: "basic-chat.activeProviderId",
  draft: "basic-chat.draft",
  thinkingLevel: "basic-chat.thinkingLevel",
  mode: "basic-chat.mode",
};

// Regex fallback for image-generation model ids not covered by capabilities/registry.
const IMAGE_MODEL_RE = /image|imagen|flux|sdxl|dall|stable-diffusion|nanobanana|nano-banana|recraft/i;

// Detect whether a model produces images (image-generation), so the UI can route
// it to /v1/images/generations instead of /v1/chat/completions. Client-side, mirrors
// chatCore's isImageGenModel check but broadened for model-name patterns.
function detectImageGen(providerId, requestModel) {
  const bareId = String(requestModel || "");
  const bare = bareId.includes("/") ? bareId.slice(bareId.indexOf("/") + 1) : bareId;
  try {
    const caps = getCapabilitiesForModel(providerId, bare);
    if (caps?.imageOutput) return true;
  } catch {
    // capabilities lookup failed — fall through to registry/name checks
  }
  try {
    if (getModelType(providerId, bare) === "image") return true;
  } catch {
    // registry lookup failed — fall through to name check
  }
  return IMAGE_MODEL_RE.test(bare);
}

// Thinking levels shown in the input toolbar. `value` is sent as `reasoning_effort`
// ("none" disables thinking); the gateway maps it to each provider's native format.
// Always displayed regardless of whether the active model supports reasoning.
const THINKING_LEVELS = [
  { value: "none", label: "No thinking", icon: "block" },
  { value: "low", label: "Low", icon: "bolt" },
  { value: "medium", label: "Medium", icon: "psychology" },
  { value: "high", label: "High", icon: "neurology" },
  { value: "xhigh", label: "Extra high", icon: "auto_awesome" },
  { value: "max", label: "Max", icon: "hotel_class" },
];

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `chat_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function safeParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function textValue(value) {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join(" ");
  if (typeof value === "object") {
    if (typeof value.message === "string") return value.message;
    if (typeof value.error === "string") return value.error;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function humanize(value = "") {
  return String(value)
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim() || "Unknown";
}

function formatRelativeTime(value) {
  if (!value) return "Now";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "Now";
  const diffMinutes = Math.max(1, Math.round((Date.now() - time) / 60000));
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;
  return `${Math.round(diffHours / 24)}d`;
}

function makeSessionTitle(text = "") {
  const normalized = textValue(text).replace(/\s+/g, " ").trim();
  if (!normalized) return "New chat";
  return normalized.length > 52 ? `${normalized.slice(0, 52).trimEnd()}…` : normalized;
}

function buildUserContent(message) {
  const text = textValue(message.content).trim();
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];

  if (attachments.length === 0) return text;

  const content = [];
  if (text) content.push({ type: "text", text });

  for (const attachment of attachments) {
    if (attachment?.dataUrl) {
      content.push({ type: "image_url", image_url: { url: attachment.dataUrl } });
    }
  }

  return content.length > 0 ? content : text;
}

function readAssistantText(chunk) {
  if (!chunk || typeof chunk !== "object") return "";
  const choice = chunk.choices?.[0];
  const delta = choice?.delta || {};
  const pieces = [delta.content, choice?.message?.content, chunk.output_text, chunk.text]
    .map(textValue)
    .filter(Boolean);
  return pieces[0] || "";
}

// Extract a reasoning/thinking delta from an OpenAI-format SSE chunk. Providers expose
// this under different keys (reasoning_content, reasoning, reasoning_details[].text).
function readReasoningText(chunk) {
  if (!chunk || typeof chunk !== "object") return "";
  const choice = chunk.choices?.[0];
  const delta = choice?.delta || {};
  const message = choice?.message || {};
  const details = delta.reasoning_details || message.reasoning_details;
  const detailText = Array.isArray(details)
    ? details.map((d) => textValue(d?.text || d?.content)).filter(Boolean).join("")
    : "";
  const pieces = [
    delta.reasoning_content,
    typeof delta.reasoning === "string" ? delta.reasoning : delta.reasoning?.content,
    message.reasoning_content,
    detailText,
  ].map(textValue).filter(Boolean);
  return pieces[0] || "";
}

// Claude Messages SSE that may leak through without OpenAI translation (or when a
// third-party anthropic-compatible gateway streams native Anthropic events).
function readClaudeNativeParts(chunk) {
  if (!chunk || typeof chunk !== "object" || typeof chunk.type !== "string") {
    return { content: "", reasoning: "" };
  }

  if (chunk.type === "content_block_delta") {
    const delta = chunk.delta || {};
    if (delta.type === "thinking_delta" && delta.thinking) {
      return { content: "", reasoning: textValue(delta.thinking) };
    }
    if (delta.type === "text_delta" && delta.text) {
      return { content: textValue(delta.text), reasoning: "" };
    }
    return { content: "", reasoning: "" };
  }

  if (chunk.type === "content_block_start") {
    const block = chunk.content_block;
    if (block?.type === "thinking" && block.thinking) {
      return { content: "", reasoning: textValue(block.thinking) };
    }
    if (block?.type === "text" && block.text) {
      return { content: textValue(block.text), reasoning: "" };
    }
    return { content: "", reasoning: "" };
  }

  // Non-streaming Claude message body
  if ((chunk.type === "message" || Array.isArray(chunk.content)) && Array.isArray(chunk.content)) {
    let content = "";
    let reasoning = "";
    for (const block of chunk.content) {
      if (block?.type === "thinking" && block.thinking) reasoning += textValue(block.thinking);
      else if (block?.type === "text" && block.text) content += textValue(block.text);
    }
    return { content, reasoning };
  }

  return { content: "", reasoning: "" };
}

// Streaming-safe splitter for <think>...</think> embedded in content.
// claude-to-openai emits those tags as content wrappers; some gateways put the
// entire thinking body inside the tags with no reasoning_content field.
function createThinkTagSplitter() {
  let inThink = false;
  let carry = "";

  return function feed(chunk) {
    if (!chunk) return { content: "", reasoning: "" };
    let s = carry + chunk;
    carry = "";
    let content = "";
    let reasoning = "";

    while (s.length > 0) {
      if (!inThink) {
        const open = s.indexOf("<think>");
        if (open === -1) {
          // Hold a possible partial open-tag suffix so we don't leak "<thi" into content.
          let hold = 0;
          for (let k = Math.min(6, s.length); k >= 1; k -= 1) {
            if ("<think>".startsWith(s.slice(-k))) {
              hold = k;
              break;
            }
          }
          content += s.slice(0, s.length - hold);
          carry = s.slice(s.length - hold);
          break;
        }
        content += s.slice(0, open);
        s = s.slice(open + "<think>".length);
        inThink = true;
      } else {
        const close = s.indexOf("</think>");
        if (close === -1) {
          let hold = 0;
          for (let k = Math.min(8, s.length); k >= 1; k -= 1) {
            if ("</think>".startsWith(s.slice(-k))) {
              hold = k;
              break;
            }
          }
          reasoning += s.slice(0, s.length - hold);
          carry = s.slice(s.length - hold);
          break;
        }
        reasoning += s.slice(0, close);
        s = s.slice(close + "</think>".length);
        inThink = false;
      }
    }

    return { content, reasoning };
  };
}

// Unified stream-chunk reader: OpenAI fields + Claude native + <think> tags.
function extractStreamParts(chunk, thinkSplitter) {
  let reasoning = readReasoningText(chunk);
  let text = readAssistantText(chunk);

  if (!reasoning && !text) {
    const claude = readClaudeNativeParts(chunk);
    reasoning = claude.reasoning;
    text = claude.content;
  }

  let content = "";
  if (text) {
    const split = thinkSplitter(text);
    content = split.content;
    if (split.reasoning) reasoning = `${reasoning || ""}${split.reasoning}`;
  }

  return { content, reasoning: reasoning || "" };
}

async function fileToDataUrl(file) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

// Force-download an image. The <a download> attribute is ignored for cross-origin
// URLs (remote provider images), so fetch → blob → object URL to make it work for
// both data: URLs and remote http(s) results. Falls back to opening in a new tab.
async function downloadImage(src, filename) {
  try {
    const response = await fetch(src);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename || "image.png";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  } catch {
    globalThis.open?.(src, "_blank", "noopener");
  }
}

function cloneSession(session) {
  return {
    ...session,
    messages: Array.isArray(session.messages) ? session.messages.map((message) => ({ ...message })) : [],
  };
}

function getProviderLabel(connection) {
  return connection?.name || humanize(connection?.provider || connection?.id || "provider");
}

// Display name for a *provider group* header in the model picker.
// Prefer the registry's provider name (e.g. "OpenAI Codex"); for dynamic
// compatible nodes fall back to the node's own name, never the raw account name.
function getProviderDisplayName(providerId, connection) {
  const registryName = AI_PROVIDERS[providerId]?.name;
  if (registryName) return registryName;
  if (isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId)) {
    return connection?.providerSpecificData?.nodeName || connection?.name || humanize(providerId);
  }
  return humanize(providerId);
}

function normalizeStaticModel(model, connection) {
  if (!model?.id) return null;
  const requestModel = `${connection.provider}/${model.id}`;
  return {
    id: requestModel,
    requestModel,
    name: model.name || model.id,
    providerId: connection.provider,
    providerName: getProviderLabel(connection),
    source: "static",
    isImageGen: detectImageGen(connection.provider, model.id),
  };
}

function normalizeLiveModel(model, connection) {
  const rawId = typeof model === "string" ? model : model?.id || model?.name || model?.model || "";
  if (!rawId) return null;

  const displayName = typeof model === "string"
    ? model
    : model?.name || model?.displayName || rawId;

  let requestModel = rawId;
  // Prefix "provider/" when the live id has no slash, so the gateway routes to the
  // right provider. Without it, a bare id (e.g. "grok-4.5") falls through parseModel's
  // prefix inference and defaults to "openai" → "No active credentials" error.
  if (!rawId.includes("/")) {
    requestModel = `${connection.provider}/${rawId}`;
  }

  return {
    id: requestModel,
    requestModel,
    name: displayName,
    providerId: connection.provider,
    providerName: getProviderLabel(connection),
    source: "live",
    isImageGen: detectImageGen(connection.provider, rawId),
  };
}

function parseProviderModelsPayload(data) {
  if (Array.isArray(data?.models)) return data.models;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data)) return data;
  return [];
}

// Build a model entry from a user-defined alias ("alias" → "provider/model").
// Custom (anthropic/openai-compatible) nodes have NO static models and their live
// /models fetch is usually empty, so their models only surface via aliases + custom
// models — same source ModelSelectModal reads. Without this, custom-claude never shows.
function normalizeAliasModel(aliasName, fullModel, connection) {
  const providerId = connection.provider;
  const prefixes = [providerId, PROVIDER_ID_TO_ALIAS[providerId]].filter(Boolean);
  const prefix = prefixes.find((p) => fullModel.startsWith(`${p}/`));
  if (!prefix) return null;
  const bareId = fullModel.slice(prefix.length + 1);
  if (!bareId) return null;
  // Route by "nodeId/model": getModelInfo resolves provider=nodeId (credential key).
  const requestModel = `${providerId}/${bareId}`;
  return {
    id: requestModel,
    requestModel,
    name: aliasName || bareId,
    providerId,
    providerName: getProviderLabel(connection),
    source: "alias",
    isImageGen: detectImageGen(providerId, bareId),
  };
}

// Build a model entry from a custom model registered via /api/models/custom.
function normalizeCustomModel(model, connection) {
  const bareId = model?.id;
  if (!bareId) return null;
  const providerId = connection.provider;
  const requestModel = `${providerId}/${bareId}`;
  return {
    id: requestModel,
    requestModel,
    name: model.name || bareId,
    providerId,
    providerName: getProviderLabel(connection),
    source: "custom",
    isImageGen: model.type === "image" || detectImageGen(providerId, bareId),
  };
}

function dedupeModels(models, providerId) {
  const map = new Map();
  // Same model can arrive twice per provider: as a static entry ("codex/gpt-5.5")
  // and a live /models entry (bare "gpt-5.5"). Collapse by the bare model id so the
  // prefixed variant (pushed first → the one that actually routes) wins.
  const bareKey = (model) => {
    const raw = String(model.requestModel || model.id || "");
    const stripped = providerId && raw.startsWith(`${providerId}/`) ? raw.slice(providerId.length + 1) : raw;
    return stripped.toLowerCase();
  };
  for (const model of models) {
    if (!model?.id) continue;
    const key = bareKey(model);
    if (!map.has(key)) map.set(key, model);
  }
  return Array.from(map.values());
}

export default function BasicChatPageClient() {
  const [providerGroups, setProviderGroups] = useState([]);
  const [loadingData, setLoadingData] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [sessions, setSessions] = useState(() => {
    if (typeof window === "undefined") return [];
    try {
      const saved = safeParse(globalThis.localStorage.getItem(STORAGE_KEYS.sessions), []);
      return Array.isArray(saved) ? saved.map((session) => ({
        ...session,
        messages: Array.isArray(session.messages) ? session.messages : [],
      })) : [];
    } catch { return []; }
  });
  const [activeSessionId, setActiveSessionId] = useState(() => {
    if (typeof window === "undefined") return "";
    return globalThis.localStorage.getItem(STORAGE_KEYS.activeSessionId) || "";
  });
  const [activeProviderId, setActiveProviderId] = useState(() => {
    if (typeof window === "undefined") return "";
    return globalThis.localStorage.getItem(STORAGE_KEYS.activeProviderId) || "";
  });
  const [activeModelId, setActiveModelId] = useState("");
  const [draft, setDraft] = useState(() => {
    if (typeof window === "undefined") return "";
    return globalThis.localStorage.getItem(STORAGE_KEYS.draft) || "";
  });
  const [attachments, setAttachments] = useState([]);
  const [previewImage, setPreviewImage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [streamingReasoning, setStreamingReasoning] = useState("");
  const [expandedReasoning, setExpandedReasoning] = useState({});
  const [isHydrated, setIsHydrated] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [thinkingLevel, setThinkingLevel] = useState(() => {
    if (typeof window === "undefined") return "medium";
    return globalThis.localStorage.getItem(STORAGE_KEYS.thinkingLevel) || "medium";
  });
  const [thinkingMenuOpen, setThinkingMenuOpen] = useState(false);
  const [mode, setMode] = useState(() => {
    if (typeof window === "undefined") return "chat";
    return globalThis.localStorage.getItem(STORAGE_KEYS.mode) || "chat";
  });
  // True when the user picks the mode manually — suppresses auto-switch on model change.
  const modeManualRef = useRef(false);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);
  const abortRef = useRef(null);
  const initializedRef = useRef(false);
  const modelMenuRef = useRef(null);
  const historyMenuRef = useRef(null);
  const thinkingMenuRef = useRef(null);

  useEffect(() => {
    setIsHydrated(true);

    const handleCopyClick = async (e) => {
      const btn = e.target.closest('.copy-btn');
      if (!btn) return;
      
      const rawCode = btn.getAttribute('data-code');
      if (rawCode == null) return;
      
      try {
        await navigator.clipboard.writeText(decodeURIComponent(rawCode));
        const copyIcon = btn.querySelector('.copy-icon');
        const checkIcon = btn.querySelector('.check-icon');
        if (copyIcon) copyIcon.style.display = 'none';
        if (checkIcon) checkIcon.style.display = 'flex';
        setTimeout(() => {
          if (copyIcon) copyIcon.style.display = 'flex';
          if (checkIcon) checkIcon.style.display = 'none';
        }, 2000);
      } catch (err) {
        console.error('Failed to copy', err);
      }
    };
    
    document.addEventListener('click', handleCopyClick);
    return () => document.removeEventListener('click', handleCopyClick);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoadingData(true);
      setLoadError("");

      try {
        const providersRes = await fetch("/api/providers", { cache: "no-store" });
        const providersData = await providersRes.json().catch(() => ({}));
        const connections = Array.isArray(providersData.connections)
          ? providersData.connections.filter((connection) => connection?.isActive !== false)
          : [];

        if (connections.length === 0) {
          if (!cancelled) {
            setProviderGroups([]);
            setLoadError("No providers connected yet.");
          }
          return;
        }

        // User-defined aliases + custom models are the ONLY model source for custom
        // (anthropic/openai-compatible) nodes — they have no static models and their
        // live /models fetch is usually empty. Fetch both so custom-claude shows up.
        const [aliasData, customData] = await Promise.all([
          fetch("/api/models/alias", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
          fetch("/api/models/custom", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
        ]);
        const modelAliases = aliasData?.aliases && typeof aliasData.aliases === "object" ? aliasData.aliases : {};
        const customModels = Array.isArray(customData?.models) ? customData.models : [];

        const providerMap = new Map();

        for (const connection of connections) {
          const providerId = connection.provider || connection.id;
          const providerName = getProviderDisplayName(providerId, connection);
          const providerType = isOpenAICompatibleProvider(providerId)
            ? "openai-compatible"
            : isAnthropicCompatibleProvider(providerId)
              ? "anthropic-compatible"
              : providerId;

          if (!providerMap.has(providerId)) {
            providerMap.set(providerId, {
              providerId,
              providerName,
              providerType,
              connections: [],
              models: [],
            });
          }

          const group = providerMap.get(providerId);
          group.providerName = group.providerName || providerName;
          group.providerType = group.providerType || providerType;
          group.connections.push(connection);

          const staticModels = getModelsByProviderId(providerId)
            .map((model) => normalizeStaticModel(model, connection))
            .filter(Boolean);
          group.models.push(...staticModels);
        }

        // Alias + custom models are per-provider, not per-connection — add them once per
        // group (a provider with N accounts would otherwise re-scan/duplicate them N times).
        for (const group of providerMap.values()) {
          const { providerId } = group;
          const connection = group.connections[0];
          if (!connection) continue;

          // Aliases stored as "providerId/model" or "alias/model".
          const aliasModels = Object.entries(modelAliases)
            .map(([aliasName, fullModel]) =>
              typeof fullModel === "string" ? normalizeAliasModel(aliasName, fullModel, connection) : null
            )
            .filter(Boolean);
          group.models.push(...aliasModels);

          // Custom models registered via "Add Model" (providerAlias = raw providerId).
          const providerAlias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
          const customForProvider = customModels
            .filter((model) => model?.providerAlias === providerId || model?.providerAlias === providerAlias)
            .map((model) => normalizeCustomModel(model, connection))
            .filter(Boolean);
          group.models.push(...customForProvider);
        }

        const liveResults = await Promise.all(
          connections.map(async (connection) => {
            try {
              const response = await fetch(`/api/providers/${connection.id}/models`, { cache: "no-store" });
              const data = await response.json().catch(() => ({}));
              if (!response.ok) return { connection, models: [] };
              const models = parseProviderModelsPayload(data)
                .map((model) => normalizeLiveModel(model, connection))
                .filter(Boolean);
              return { connection, models };
            } catch {
              return { connection, models: [] };
            }
          })
        );

        for (const result of liveResults) {
          const providerId = result.connection.provider || result.connection.id;
          const group = providerMap.get(providerId);
          if (!group) continue;
          group.models.push(...result.models);
        }

        const normalized = Array.from(providerMap.values())
          .map((group) => ({
            ...group,
            models: dedupeModels(group.models, group.providerId).sort((a, b) => a.name.localeCompare(b.name)),
          }))
          .filter((group) => group.models.length > 0)
          .sort((a, b) => a.providerName.localeCompare(b.providerName));

        if (!cancelled) {
          setProviderGroups(normalized);
          if (normalized.length === 0) {
            setLoadError("Providers connected but no models available.");
          }
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(textValue(error?.message) || "Failed to load providers/models.");
          setProviderGroups([]);
        }
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    }

    loadData();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(event.target)) {
        setModelMenuOpen(false);
        setModelSearch("");
      }
      if (historyMenuRef.current && !historyMenuRef.current.contains(event.target)) {
        setHistoryOpen(false);
      }
      if (thinkingMenuRef.current && !thinkingMenuRef.current.contains(event.target)) {
        setThinkingMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Esc closes the image lightbox.
  useEffect(() => {
    if (!previewImage) return;
    const onKey = (event) => {
      if (event.key === "Escape") setPreviewImage("");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [previewImage]);

  // Auto-grow the input: height follows content, capped at ~3.5 lines (leading-6 = 24px
  // → 84px) after which it scrolls. Runs on every draft change (incl. clear-on-send).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 84)}px`;
  }, [draft]);

  const modelIndex = useMemo(() => {
    const map = new Map();
    for (const group of providerGroups) {
      for (const model of group.models) {
        map.set(model.id, {
          ...model,
          providerId: group.providerId,
          providerName: group.providerName,
        });
      }
    }
    return map;
  }, [providerGroups]);

  const activeProviderGroup = useMemo(() => {
    return providerGroups.find((group) => group.providerId === activeProviderId) || providerGroups[0] || null;
  }, [providerGroups, activeProviderId]);

  const activeModel = useMemo(() => {
    if (activeModelId && modelIndex.has(activeModelId)) return modelIndex.get(activeModelId);
    if (activeSessionId) {
      const session = sessions.find((item) => item.id === activeSessionId);
      if (session?.modelId && modelIndex.has(session.modelId)) return modelIndex.get(session.modelId);
    }
    return activeProviderGroup?.models?.[0] || null;
  }, [activeModelId, modelIndex, activeProviderGroup, sessions, activeSessionId]);

  const currentSession = useMemo(() => sessions.find((session) => session.id === activeSessionId) || null, [sessions, activeSessionId]);
  const currentMessages = currentSession?.messages || [];

  // Auto-switch mode to match the selected model's kind, unless the user picked a mode
  // manually this session. Image-gen models → "image"; everything else → "chat".
  useEffect(() => {
    if (!activeModel || modeManualRef.current) return;
    const next = activeModel.isImageGen ? "image" : "chat";
    setMode((prev) => (prev === next ? prev : next));
  }, [activeModel]);

  const filteredProviderGroups = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    if (!query) return providerGroups;
    return providerGroups
      .map((group) => {
        const providerMatches = group.providerName.toLowerCase().includes(query);
        const models = providerMatches
          ? group.models
          : group.models.filter((model) =>
              model.name.toLowerCase().includes(query) ||
              String(model.requestModel || model.id).toLowerCase().includes(query));
        return { ...group, models };
      })
      .filter((group) => group.models.length > 0);
  }, [providerGroups, modelSearch]);

  const sessionItems = useMemo(() => [...sessions].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()), [sessions]);
  const canSend = !isSending && !!activeModel && (mode === "image"
    ? draft.trim().length > 0
    : (draft.trim().length > 0 || attachments.length > 0));

  useEffect(() => {
    if (!isHydrated) return;
    try {
      globalThis.localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify(sessions));
      globalThis.localStorage.setItem(STORAGE_KEYS.activeSessionId, activeSessionId);
      globalThis.localStorage.setItem(STORAGE_KEYS.activeProviderId, activeProviderId);
      globalThis.localStorage.setItem(STORAGE_KEYS.draft, draft);
      globalThis.localStorage.setItem(STORAGE_KEYS.thinkingLevel, thinkingLevel);
      globalThis.localStorage.setItem(STORAGE_KEYS.mode, mode);
    } catch {
      // Ignore storage errors.
    }
  }, [isHydrated, sessions, activeSessionId, activeProviderId, draft, thinkingLevel, mode]);

  useEffect(() => {
    if (!isHydrated || loadingData || initializedRef.current) return;
    if (providerGroups.length === 0) return;

    const savedProvider = providerGroups.find((group) => group.providerId === activeProviderId) || providerGroups[0];
    const savedModel = activeModelId && modelIndex.has(activeModelId)
      ? modelIndex.get(activeModelId)
      : savedProvider.models[0];

    if (sessions.length > 0) {
      const session = sessions.find((item) => item.id === activeSessionId) || sessions[0];
      const sessionModel = session?.modelId && modelIndex.has(session.modelId)
        ? modelIndex.get(session.modelId)
        : savedModel;
      initializedRef.current = true;
      setActiveSessionId(session.id);
      setActiveProviderId(sessionModel?.providerId || savedProvider.providerId);
      setActiveModelId(sessionModel?.id || savedModel.id);
      return;
    }

    const session = {
      id: createId(),
      title: "New chat",
      providerId: savedProvider.providerId,
      providerName: savedProvider.providerName,
      modelId: savedModel.id,
      modelName: savedModel.name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    };

    initializedRef.current = true;
    setSessions([session]);
    setActiveSessionId(session.id);
    setActiveProviderId(savedProvider.providerId);
    setActiveModelId(savedModel.id);
  }, [isHydrated, loadingData, providerGroups, modelIndex, sessions, activeSessionId, activeProviderId, activeModelId]);

  const updateSession = (sessionId, updater) => {
    setSessions((prev) => prev.map((session) => (session.id === sessionId ? updater(cloneSession(session)) : session)));
  };

  const ensureSessionForModel = (model) => {
    if (!model) return null;
    return {
      id: createId(),
      title: "New chat",
      providerId: model.providerId,
      providerName: model.providerName,
      modelId: model.id,
      modelName: model.name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    };
  };

  const handleNewChat = () => {
    if (!activeModel) return;
    const session = ensureSessionForModel(activeModel);
    if (!session) return;
    setSessions((prev) => [session, ...prev]);
    setActiveSessionId(session.id);
    setActiveProviderId(session.providerId);
    setActiveModelId(session.modelId);
    setDraft("");
    setAttachments([]);
    setStreamingMessageId("");
    setStreamingText("");
  };

  const handleSelectSession = (sessionId) => {
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) return;
    setActiveSessionId(sessionId);
    setActiveProviderId(session.providerId || activeProviderId);
    setActiveModelId(session.modelId || activeModelId);
    setHistoryOpen(false);
  };

  // Delete a specific session from the history list. Keeps the active chat stable
  // unless the deleted one *was* active, in which case fall back to the newest.
  const handleDeleteSession = (sessionId) => {
    const nextSessions = sessions.filter((session) => session.id !== sessionId);
    setSessions(nextSessions);
    if (sessionId !== activeSessionId) return;
    const fallback = nextSessions[0] || null;
    if (fallback) {
      setActiveSessionId(fallback.id);
      setActiveProviderId(fallback.providerId);
      setActiveModelId(fallback.modelId);
    } else {
      setActiveSessionId("");
      setActiveProviderId("");
      setActiveModelId("");
    }
  };

  const handleSelectProvider = (providerId) => {
    const group = providerGroups.find((item) => item.providerId === providerId);
    if (!group || group.models.length === 0) return;
    const nextModel = group.models[0];

    const current = sessions.find((session) => session.id === activeSessionId);
    if (current && current.messages.length > 0) {
      const session = ensureSessionForModel(nextModel);
      if (!session) return;
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(session.id);
    } else if (current) {
      setSessions((prev) => prev.map((item) => (item.id === current.id ? {
        ...item,
        providerId: group.providerId,
        providerName: group.providerName,
        modelId: nextModel.id,
        modelName: nextModel.name,
      } : item)));
      setActiveSessionId(current.id);
    }

    setActiveProviderId(group.providerId);
    setActiveModelId(nextModel.id);
    setModelMenuOpen(false);
    setModelSearch("");
  };

  const handleSelectModel = (modelId) => {
    const model = modelIndex.get(modelId);
    if (!model) return;

    const current = sessions.find((session) => session.id === activeSessionId);
    if (current && current.messages.length > 0) {
      const session = ensureSessionForModel(model);
      if (!session) return;
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(session.id);
    } else if (current) {
      setSessions((prev) => prev.map((item) => (item.id === current.id ? {
        ...item,
        providerId: model.providerId,
        providerName: model.providerName,
        modelId: model.id,
        modelName: model.name,
      } : item)));
      setActiveSessionId(current.id);
    } else {
      const session = ensureSessionForModel(model);
      if (!session) return;
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(session.id);
    }

    setActiveProviderId(model.providerId);
    setActiveModelId(model.id);
    setModelMenuOpen(false);
    setModelSearch("");
  };

  const handleAttachFiles = async (event) => {
    await addImageFiles(event.target.files);
    event.target.value = "";
  };

  // Convert image files (from file picker or clipboard paste) into attachments.
  // Non-image files are ignored. Returns the number of images added.
  const addImageFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) return 0;

    const converted = await Promise.all(images.map(async (file) => ({
      id: createId(),
      name: file.name || `pasted-${Date.now()}.${(file.type.split("/")[1] || "png")}`,
      type: file.type,
      size: file.size,
      dataUrl: await fileToDataUrl(file),
    })));

    setAttachments((prev) => [...prev, ...converted]);
    return converted.length;
  };

  // Ctrl/Cmd+V: pull image files off the clipboard and attach them (chat + image modes).
  const handlePaste = async (event) => {
    const items = event.clipboardData?.items;
    if (!items) return;

    const files = [];
    for (const item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length === 0) return;

    // Keep the pasted image out of the text box; only attach it.
    event.preventDefault();
    await addImageFiles(files);
  };

  const removeAttachment = (attachmentId) => {
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== attachmentId));
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const finalizeSessionTitle = (sessionId, titleSeed) => {
    const title = makeSessionTitle(titleSeed);
    updateSession(sessionId, (session) => ({
      ...session,
      title: session.title === "New chat" ? title : session.title,
      updatedAt: new Date().toISOString(),
    }));
  };

  const sendMessage = async () => {
    const model = activeModel || activeProviderGroup?.models?.[0] || null;
    if (!model) return;

    const userText = draft.trim();
    if (!userText && attachments.length === 0) return;

    let sessionId = activeSessionId;
    let session = sessions.find((item) => item.id === sessionId);
    if (!session) {
      session = ensureSessionForModel(model);
      if (!session) return;
      sessionId = session.id;
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(sessionId);
    }

    const userMessage = {
      id: createId(),
      role: "user",
      content: userText,
      attachments: attachments.map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        type: attachment.type,
        dataUrl: attachment.dataUrl,
      })),
      createdAt: new Date().toISOString(),
    };

    const assistantMessageId = createId();
    const assistantMessage = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      status: "streaming",
    };

    const nextMessages = [...(session.messages || []), userMessage, assistantMessage];
    setSessions((prev) => prev.map((item) => (item.id === sessionId ? {
      ...item,
      providerId: model.providerId,
      providerName: model.providerName,
      modelId: model.id,
      modelName: model.name,
      messages: nextMessages,
      updatedAt: new Date().toISOString(),
      title: item.title === "New chat" ? makeSessionTitle(userText) : item.title,
    } : item)));
    setDraft("");
    setAttachments([]);
    setIsSending(true);
    setStreamingMessageId(assistantMessageId);
    setStreamingText("");
    setStreamingReasoning("");
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    const requestMessages = nextMessages
      .filter((message) => !(message.role === "assistant" && message.id === assistantMessageId))
      .map((message) => ({
        role: message.role,
        content: message.role === "user" ? buildUserContent(message) : message.content,
      }));

    // Image-generation mode: single JSON call to /v1/images/generations, render the image.
    if (mode === "image") {
      try {
        const imageBody = {
          model: model.requestModel || model.id,
          prompt: userText,
          n: 1,
        };

        const response = await fetch("/api/v1/images/generations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(imageBody),
          signal: abortRef.current.signal,
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(textValue(data.error || data.message || `Request failed (${response.status})`));
        }

        const images = (Array.isArray(data?.data) ? data.data : [])
          .map((item) => (item?.b64_json ? `data:image/png;base64,${item.b64_json}` : item?.url))
          .filter(Boolean);

        if (images.length === 0) throw new Error("No image returned");

        updateSession(sessionId, (currentSession) => ({
          ...currentSession,
          messages: currentSession.messages.map((message) => (message.id === assistantMessageId ? { ...message, images, status: "done" } : message)),
          updatedAt: new Date().toISOString(),
        }));
        finalizeSessionTitle(sessionId, userText);
      } catch (error) {
        if (error.name !== "AbortError") {
          const errorText = textValue(error?.message || error);
          updateSession(sessionId, (currentSession) => ({
            ...currentSession,
            messages: currentSession.messages.map((message) => (message.id === assistantMessageId ? { ...message, content: `Error: ${errorText}`, status: "error" } : message)),
            updatedAt: new Date().toISOString(),
          }));
          setLoadError(errorText || "Failed to generate image.");
        }
      } finally {
        setIsSending(false);
        setStreamingMessageId("");
        setStreamingText("");
        setStreamingReasoning("");
        abortRef.current = null;
      }
      return;
    }

    try {
      const response = await fetch("/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          model: model.requestModel || model.id,
          messages: requestMessages,
          stream: true,
          reasoning_effort: thinkingLevel,
        }),
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(textValue(errorData.error || errorData.message || `Request failed (${response.status})`));
      }

      const reader = response.body?.getReader();
      if (!reader) {
        const data = await response.json().catch(() => ({}));
        const msg = data?.choices?.[0]?.message || {};
        const rawContent = textValue(msg.content || data?.output_text || data?.error || data?.message || "");
        const rawReasoning = textValue(
          msg.reasoning_content
          || (typeof msg.reasoning === "string" ? msg.reasoning : msg.reasoning?.content)
          || ""
        );
        // Non-streaming fallback: still split <think> tags / Claude content blocks.
        const splitter = createThinkTagSplitter();
        const claude = readClaudeNativeParts(data);
        const split = splitter(rawContent);
        const fallbackReasoning = rawReasoning || claude.reasoning || split.reasoning || "";
        const fallbackText = split.content || claude.content || rawContent;
        updateSession(sessionId, (currentSession) => ({
          ...currentSession,
          messages: currentSession.messages.map((message) => (
            message.id === assistantMessageId
              ? { ...message, content: fallbackText, reasoning: fallbackReasoning, status: "done" }
              : message
          )),
          updatedAt: new Date().toISOString(),
        }));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let assistantText = "";
      let reasoningText = "";
      // Stateful <think> splitter — survives across SSE chunks.
      const thinkSplitter = createThinkTagSplitter();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;

          const payload = trimmed.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;

          try {
            const chunk = JSON.parse(payload);
            const { content, reasoning } = extractStreamParts(chunk, thinkSplitter);
            if (!content && !reasoning) continue;

            if (reasoning) {
              reasoningText += reasoning;
              setStreamingReasoning(reasoningText);
            }
            if (content) {
              assistantText += content;
              setStreamingText(assistantText);
            }

            updateSession(sessionId, (currentSession) => ({
              ...currentSession,
              messages: currentSession.messages.map((message) => (
                message.id === assistantMessageId
                  ? {
                      ...message,
                      content: assistantText || message.content,
                      reasoning: reasoningText || message.reasoning,
                      status: "streaming",
                    }
                  : message
              )),
              updatedAt: new Date().toISOString(),
            }));
          } catch {
            // Ignore malformed chunks.
          }
        }
      }

      updateSession(sessionId, (currentSession) => ({
        ...currentSession,
        messages: currentSession.messages.map((message) => (message.id === assistantMessageId ? { ...message, content: assistantText || message.content, reasoning: reasoningText || message.reasoning, status: "done" } : message)),
        updatedAt: new Date().toISOString(),
      }));
      finalizeSessionTitle(sessionId, userText);
    } catch (error) {
      if (error.name !== "AbortError") {
        const errorText = textValue(error?.message || error);
        updateSession(sessionId, (currentSession) => ({
          ...currentSession,
          messages: currentSession.messages.map((message) => (message.id === assistantMessageId ? { ...message, content: message.content || `Error: ${errorText}`, status: "error" } : message)),
          updatedAt: new Date().toISOString(),
        }));
        setLoadError(errorText || "Failed to send message.");
      }
    } finally {
      setIsSending(false);
      setStreamingMessageId("");
      setStreamingText("");
      setStreamingReasoning("");
      abortRef.current = null;
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSend) sendMessage();
    }
  };

  const modelLabel = activeModel ? `${activeModel.name}` : "Select model";
  const modelSubLabel = activeModel ? activeModel.requestModel : "Choose from connected providers";
  const activeThinkingLevel = THINKING_LEVELS.find((level) => level.value === thinkingLevel) || THINKING_LEVELS[2];
  const isImageMode = mode === "image";
  const selectMode = (nextMode) => {
    modeManualRef.current = true;
    setMode(nextMode);
  };

  return (
    <div className="relative flex-1 flex flex-col h-full min-h-0 min-w-0 bg-[#212121] text-white overflow-hidden">
      <style dangerouslySetInnerHTML={{ __html: `
        .chat-markdown { word-break: break-word; }
        .chat-markdown p { margin-bottom: 0.75em; }
        .chat-markdown p:last-child { margin-bottom: 0; }
        .chat-markdown pre { background: #1a1a1a; padding: 1rem; border-radius: 0.75rem; overflow-x: auto; margin-top: 0.5em; margin-bottom: 0.75em; border: 1px solid rgba(255,255,255,0.1); }
        .chat-markdown code { font-family: ui-monospace, monospace; font-size: 0.875em; }
        .chat-markdown pre code { background: transparent; padding: 0; color: #e5e5e5; }
        .chat-markdown :not(pre) > code { background: rgba(255,255,255,0.1); padding: 0.15rem 0.3rem; border-radius: 0.3rem; }
        .chat-markdown ul { list-style-type: disc; padding-left: 1.5em; margin-bottom: 0.75em; }
        .chat-markdown ol { list-style-type: decimal; padding-left: 1.5em; margin-bottom: 0.75em; }
        .chat-markdown li { margin-bottom: 0.25em; }
        .chat-markdown a { color: #60a5fa; text-decoration: underline; text-underline-offset: 2px; }
        .chat-markdown h1, .chat-markdown h2, .chat-markdown h3, .chat-markdown h4 { font-weight: 600; margin-top: 1.5em; margin-bottom: 0.5em; line-height: 1.3; }
        .chat-markdown h1 { font-size: 1.5em; }
        .chat-markdown h2 { font-size: 1.3em; }
        .chat-markdown h3 { font-size: 1.1em; }
        .chat-markdown blockquote { border-left: 3px solid rgba(255,255,255,0.2); padding-left: 1em; color: rgba(255,255,255,0.7); margin-bottom: 0.75em; }
      `}} />
      <div className="relative flex flex-1 h-full min-h-0 w-full flex-col">
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 lg:px-8">
          <div ref={modelMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setModelMenuOpen((value) => {
                if (value) setModelSearch("");
                return !value;
              })}
              className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left transition hover:bg-white/8"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">{modelLabel}</span>
                  <span className="material-symbols-outlined text-[18px] text-white/70">expand_more</span>
                </div>
                <p className="truncate text-xs text-white/55">{modelSubLabel}</p>
              </div>
            </button>

            {modelMenuOpen ? (
              <div className="absolute left-0 top-[calc(100%+10px)] z-30 w-[min(560px,calc(100vw-2rem))] overflow-hidden rounded-[20px] border border-white/10 bg-[#262626] shadow-2xl shadow-black/50">
                <div className="border-b border-white/10 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.22em] text-white/45">Models</p>
                  <p className="text-sm text-white/75">Only from connected providers</p>
                </div>
                <div className="border-b border-white/10 p-3">
                  <div className="flex items-center gap-2 rounded-[14px] border border-white/10 bg-black/30 px-3 py-2 focus-within:border-white/25">
                    <span className="material-symbols-outlined text-[18px] text-white/40">search</span>
                    <input
                      autoFocus
                      value={modelSearch}
                      onChange={(event) => setModelSearch(event.target.value)}
                      placeholder="Search model or provider…"
                      className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/35"
                    />
                    {modelSearch ? (
                      <button
                        type="button"
                        onClick={() => setModelSearch("")}
                        className="text-white/40 hover:text-white"
                        aria-label="Clear search"
                      >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="max-h-[60vh] overflow-y-auto p-2 custom-scrollbar">
                  {filteredProviderGroups.length === 0 ? (
                    <div className="rounded-[16px] border border-dashed border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-white/50">
                      No models match “{modelSearch}”.
                    </div>
                  ) : filteredProviderGroups.map((group) => (
                    <div key={group.providerId} className="mb-2 rounded-[16px] border border-white/10 bg-black/20 p-2">
                      <div className="flex items-center justify-between px-2 py-2">
                        <p className="text-sm font-semibold text-white">{group.providerName}</p>
                        <Badge size="sm" variant="default">{group.models.length}</Badge>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {group.models.map((model) => {
                          const isActive = model.id === activeModelId;
                          return (
                            <button
                              key={model.id}
                              type="button"
                              onClick={() => handleSelectModel(model.id)}
                              className={`rounded-[14px] border px-3 py-3 text-left transition ${isActive ? "border-blue-400/40 bg-blue-500/15" : "border-white/10 bg-white/5 hover:bg-white/8"}`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-white">{model.name}</p>
                                  <p className="truncate text-[11px] text-white/45">{model.requestModel}</p>
                                </div>
                                {isActive ? <span className="material-symbols-outlined text-[18px] text-blue-300">check_circle</span> : null}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setHistoryOpen((value) => !value)}
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/80 transition hover:bg-white/8"
            >
              History
            </button>
            <Button variant="ghost" size="sm" icon="add" onClick={handleNewChat} disabled={!activeModel}>
              New chat
            </Button>
          </div>
        </div>

        {historyOpen ? (
          <div ref={historyMenuRef} className="absolute right-4 top-[72px] z-20 w-[min(360px,calc(100vw-2rem))] rounded-[20px] border border-white/10 bg-[#262626] p-2 shadow-2xl shadow-black/50 lg:right-8">
            <div className="px-3 py-2">
              <p className="text-xs uppercase tracking-[0.22em] text-white/45">Recent chats</p>
            </div>
            <div className="max-h-[48vh] space-y-2 overflow-y-auto p-1 custom-scrollbar">
              {sessionItems.length === 0 ? (
                <div className="rounded-[16px] border border-dashed border-white/10 bg-white/5 p-4 text-sm text-white/55">
                  No conversations yet.
                </div>
              ) : sessionItems.map((session) => {
                const isActive = session.id === activeSessionId;
                const latestMessage = [...(session.messages || [])].reverse().find((message) => message.role === "user") || session.messages?.[0];
                return (
                  <div
                    key={session.id}
                    className={`group flex items-center gap-2 rounded-[16px] border px-2 transition ${isActive ? "border-blue-400/40 bg-blue-500/15" : "border-white/10 bg-white/5 hover:bg-white/8"}`}
                  >
                    <button
                      type="button"
                      onClick={() => handleSelectSession(session.id)}
                      className="min-w-0 flex-1 py-3 pl-1 text-left"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-white">{session.title}</p>
                          <p className="mt-1 truncate text-xs text-white/50">{textValue(latestMessage?.content) || "Empty chat"}</p>
                        </div>
                        <span className="text-[10px] text-white/40 shrink-0">{formatRelativeTime(session.updatedAt)}</span>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteSession(session.id)}
                      className="flex size-8 shrink-0 items-center justify-center rounded-full text-white/40 opacity-0 transition hover:bg-white/10 hover:text-rose-300 group-hover:opacity-100"
                      aria-label="Delete conversation"
                    >
                      <span className="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {loadError ? (
          <div className="mx-4 mt-4 rounded-[18px] border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-rose-100 lg:mx-8">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-[20px]">error</span>
              <p className="text-sm leading-6">{loadError}</p>
            </div>
          </div>
        ) : null}

        <div className="flex flex-1 flex-col min-h-0">
          <div className="flex-1 overflow-y-auto py-4 custom-scrollbar">
            {currentMessages.length === 0 ? (
              <div className="flex min-h-[50vh] items-center justify-center px-4 text-center">
                <div className="max-w-xl space-y-4">
                  <div className="mx-auto flex size-16 items-center justify-center rounded-[20px] border border-white/10 bg-white/5 text-white/80">
                    <span className="material-symbols-outlined text-[30px]">chat</span>
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-2xl font-semibold text-white">Start a conversation</h2>
                    <p className="text-sm leading-6 text-white/60">
                      Simple chat interface to interact with any AI model from connected providers. Select a model and start chatting!
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4">
              {currentMessages.map((message) => {
                const isUser = message.role === "user";
                const isAssistant = message.role === "assistant";
                const isStreaming = isAssistant && message.id === streamingMessageId && message.status === "streaming";
                const content = textValue(message.content) || (isAssistant ? streamingText : "");
                const reasoning = isAssistant
                  ? (textValue(message.reasoning) || (message.id === streamingMessageId ? streamingReasoning : ""))
                  : "";
                const reasoningOpen = expandedReasoning[message.id] ?? isStreaming;

                return (
                  <div key={message.id} className={`flex w-full ${isUser ? "justify-end" : "justify-start"} mb-6`}>
                    <div className={`max-w-[min(92%,60rem)] ${isUser ? "rounded-3xl bg-[#2f2f2f] px-5 py-3.5 text-white" : "text-white/90"}`}>
                      <div className="mb-1 flex items-center justify-between gap-3">
                        <span className="text-xs font-semibold">{isUser ? "You" : activeModel?.name || "Assistant"}</span>
                      </div>

                      {message.attachments?.length ? (
                        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 mt-2">
                          {message.attachments.map((attachment) => (
                            <button
                              key={attachment.id}
                              type="button"
                              onClick={() => setPreviewImage(attachment.dataUrl)}
                              className="overflow-hidden rounded-[18px] border border-white/10 bg-black/20 transition hover:border-white/25"
                            >
                              <img src={attachment.dataUrl} alt={attachment.name} className="h-28 w-full object-cover" />
                            </button>
                          ))}
                        </div>
                      ) : null}

                      {reasoning ? (
                        <div className="mb-2 overflow-hidden rounded-[14px] border border-white/10 bg-white/5">
                          <button
                            type="button"
                            onClick={() => setExpandedReasoning((prev) => ({ ...prev, [message.id]: !reasoningOpen }))}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-white/70 transition hover:bg-white/5"
                          >
                            <span className="material-symbols-outlined text-[16px] text-white/50">psychology</span>
                            <span>{isStreaming ? "Thinking…" : "Thinking"}</span>
                            <span className={`material-symbols-outlined ml-auto text-[18px] text-white/40 transition-transform ${reasoningOpen ? "rotate-180" : ""}`}>expand_more</span>
                          </button>
                          {reasoningOpen ? (
                            <div className="chat-markdown border-t border-white/10 px-3 py-2 text-[13px] leading-6 text-white/60">
                              <div dangerouslySetInnerHTML={{ __html: renderMarkdown(reasoning) }} />
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      <div className="chat-markdown text-[15px] leading-7">
                        <div dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
                        {isAssistant && isStreaming && !streamingText && !message.images?.length ? <span className="inline-block animate-pulse mt-2">▋</span> : null}
                      </div>

                      {isAssistant && isStreaming && !message.images?.length && message.status !== "error" && mode === "image" ? (
                        <div className="mt-1 flex items-center gap-2 text-xs text-white/50">
                          <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                          <span>Generating image…</span>
                        </div>
                      ) : null}

                      {message.images?.length ? (
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          {message.images.map((src, index) => (
                            <div key={index} className="overflow-hidden rounded-[18px] border border-white/10 bg-black/20">
                              <button type="button" onClick={() => setPreviewImage(src)} className="block w-full transition hover:opacity-90">
                                <img src={src} alt={`Generated ${index + 1}`} className="w-full object-contain" />
                              </button>
                              <div className="flex items-center justify-end border-t border-white/10 px-2 py-1.5">
                                <button
                                  type="button"
                                  onClick={() => downloadImage(src, `image-${index + 1}.png`)}
                                  className="inline-flex items-center gap-1 text-[11px] text-white/60 transition hover:text-white"
                                >
                                  <span className="material-symbols-outlined text-[14px]">download</span>
                                  Download
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="shrink-0 pt-2">
            <div className="mx-auto w-full max-w-5xl px-4 pb-2">
              <div className="rounded-[26px] bg-[#2f2f2f] px-3 pt-3 pb-2 shadow-[0_0_15px_rgba(0,0,0,0.10)] ring-1 ring-white/5">
                {attachments.length > 0 ? (
                  <div className="mb-2 flex flex-wrap gap-2 px-1">
                    {attachments.map((attachment) => (
                      <div key={attachment.id} className="group relative overflow-hidden rounded-[14px] border border-white/10 bg-white/5">
                        <button type="button" onClick={() => setPreviewImage(attachment.dataUrl)} className="block">
                          <img src={attachment.dataUrl} alt={attachment.name} className="h-16 w-16 object-cover transition group-hover:opacity-80" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeAttachment(attachment.id)}
                          className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/60 text-white/80 opacity-0 transition hover:bg-black/80 hover:text-white group-hover:opacity-100"
                          aria-label="Remove attachment"
                        >
                          <span className="material-symbols-outlined text-[14px]">close</span>
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}

                <textarea
                  ref={textareaRef}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  placeholder={isImageMode ? "Describe an image to generate" : "Message AI"}
                  rows={1}
                  className="w-full resize-none bg-transparent px-2 text-[15px] leading-6 text-white outline-none placeholder:text-white/40 custom-scrollbar overflow-y-auto"
                />

                <div className="mt-2 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => fileInputRef.current?.click()} disabled={!activeModel || loadingData} className="p-2 text-white/50 hover:text-white transition rounded-full hover:bg-white/5">
                      <span className="material-symbols-outlined text-[20px]">attach_file</span>
                    </button>
                    <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleAttachFiles} />

                    <div className="flex items-center gap-0.5 rounded-full border border-white/10 bg-white/5 p-0.5">
                      <button
                        type="button"
                        onClick={() => selectMode("chat")}
                        className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition ${!isImageMode ? "bg-white/15 text-white" : "text-white/50 hover:text-white"}`}
                        title="Chat mode"
                      >
                        <span className="material-symbols-outlined text-[16px]">chat</span>
                        <span>Chat</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => selectMode("image")}
                        className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition ${isImageMode ? "bg-white/15 text-white" : "text-white/50 hover:text-white"}`}
                        title="Image generation mode"
                      >
                        <span className="material-symbols-outlined text-[16px]">image</span>
                        <span>Image</span>
                      </button>
                    </div>

                    {!isImageMode ? (
                    <div ref={thinkingMenuRef} className="relative">
                      <button
                        type="button"
                        onClick={() => setThinkingMenuOpen((value) => !value)}
                        className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/70 transition hover:bg-white/10 hover:text-white"
                        title="Thinking effort"
                      >
                        <span className="material-symbols-outlined text-[16px]">{activeThinkingLevel.icon}</span>
                        <span className="font-medium">{activeThinkingLevel.label}</span>
                        <span className="material-symbols-outlined text-[16px] text-white/50">expand_less</span>
                      </button>

                      {thinkingMenuOpen ? (
                        <div className="absolute bottom-[calc(100%+8px)] left-0 z-30 w-52 overflow-hidden rounded-[16px] border border-white/10 bg-[#262626] p-1.5 shadow-2xl shadow-black/50">
                          <p className="px-3 py-2 text-[10px] uppercase tracking-[0.22em] text-white/40">Thinking effort</p>
                          {THINKING_LEVELS.map((level) => {
                            const isActive = level.value === thinkingLevel;
                            return (
                              <button
                                key={level.value}
                                type="button"
                                onClick={() => {
                                  setThinkingLevel(level.value);
                                  setThinkingMenuOpen(false);
                                }}
                                className={`flex w-full items-center gap-2.5 rounded-[12px] px-3 py-2 text-left text-sm transition ${isActive ? "bg-blue-500/15 text-white" : "text-white/75 hover:bg-white/8"}`}
                              >
                                <span className="material-symbols-outlined text-[18px]">{level.icon}</span>
                                <span className="flex-1 font-medium">{level.label}</span>
                                {isActive ? <span className="material-symbols-outlined text-[18px] text-blue-300">check</span> : null}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                    ) : null}

                    <span className="text-xs font-medium text-white/30 truncate max-w-[120px]">{activeModel ? activeModel.name : "No model"}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    {isSending ? (
                      <button type="button" onClick={handleStop} className="p-2 text-white bg-white/10 hover:bg-white/20 transition rounded-full h-8 w-8 flex items-center justify-center">
                        <span className="material-symbols-outlined text-[16px]">stop</span>
                      </button>
                    ) : null}
                    <button onClick={sendMessage} disabled={!canSend} className={`h-8 w-8 rounded-full flex items-center justify-center transition ${canSend ? 'bg-white text-black hover:opacity-90' : 'bg-white/10 text-white/30 cursor-not-allowed'}`}>
                      <span className="material-symbols-outlined text-[16px]">arrow_upward</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <p className="mx-auto mt-2 max-w-5xl px-4 pb-4 text-center text-[11px] text-white/30">
            Model list is filtered from connected providers.
          </p>
        </div>
      </div>

      {previewImage ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setPreviewImage("")}
        >
          <button
            type="button"
            onClick={() => setPreviewImage("")}
            className="absolute right-4 top-4 flex size-10 items-center justify-center rounded-full bg-white/10 text-white/80 transition hover:bg-white/20 hover:text-white"
            aria-label="Close preview"
          >
            <span className="material-symbols-outlined text-[22px]">close</span>
          </button>
          <img
            src={previewImage}
            alt="Preview"
            onClick={(event) => event.stopPropagation()}
            className="max-h-[92vh] max-w-[92vw] rounded-[18px] object-contain shadow-2xl shadow-black/60"
          />
          <a
            href={previewImage}
            download="image.png"
            onClick={(event) => event.stopPropagation()}
            className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-xs text-white/80 transition hover:bg-white/20 hover:text-white"
          >
            <span className="material-symbols-outlined text-[16px]">download</span>
            Download
          </a>
        </div>
      ) : null}
    </div>
  );
}
