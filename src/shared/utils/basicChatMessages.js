export function getRegenerationContext(messages, assistantMessageId) {
  if (!Array.isArray(messages) || !assistantMessageId) return null;

  const assistantIndex = messages.findIndex(
    (message) => message?.id === assistantMessageId && message?.role === "assistant"
  );
  if (assistantIndex < 0) return null;

  const history = messages.slice(0, assistantIndex);
  let userMessage = null;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index]?.role === "user") {
      userMessage = history[index];
      break;
    }
  }
  if (!userMessage) return null;

  return {
    history,
    userMessage,
    assistantMessage: messages[assistantIndex],
  };
}

function snapshotAssistantVersion(message) {
  return {
    content: message?.content || "",
    reasoning: message?.reasoning || "",
    images: Array.isArray(message?.images) ? [...message.images] : [],
    status: message?.status || "done",
    mode: message?.mode || (message?.images?.length ? "image" : "chat"),
    createdAt: message?.createdAt || new Date().toISOString(),
  };
}

export function getAssistantVersions(message) {
  if (Array.isArray(message?.versions) && message.versions.length > 0) {
    return message.versions;
  }
  return message?.role === "assistant" ? [snapshotAssistantVersion(message)] : [];
}

export function getActiveAssistantVersionIndex(message) {
  const versions = getAssistantVersions(message);
  if (versions.length === 0) return -1;
  const index = Number.isInteger(message?.activeVersionIndex)
    ? message.activeVersionIndex
    : versions.length - 1;
  return Math.min(Math.max(index, 0), versions.length - 1);
}

export function selectAssistantVersion(message, index) {
  const versions = getAssistantVersions(message).map((version) => ({ ...version }));
  if (versions.length === 0) return message;

  const activeVersionIndex = Math.min(Math.max(Number(index) || 0, 0), versions.length - 1);
  const active = versions[activeVersionIndex];
  return {
    ...message,
    content: active.content || "",
    reasoning: active.reasoning || "",
    images: Array.isArray(active.images) ? [...active.images] : [],
    status: active.status || "done",
    mode: active.mode || "chat",
    versions,
    activeVersionIndex,
  };
}

export function appendAssistantVersion(message, version) {
  const versions = [
    ...getAssistantVersions(message).map((item) => ({ ...item })),
    snapshotAssistantVersion(version),
  ];
  return selectAssistantVersion({ ...message, versions }, versions.length - 1);
}

export function patchActiveAssistantVersion(message, patch) {
  if (!Array.isArray(message?.versions) || message.versions.length === 0) {
    return { ...message, ...patch };
  }

  const activeVersionIndex = getActiveAssistantVersionIndex(message);
  const versions = message.versions.map((version, index) => (
    index === activeVersionIndex ? { ...version, ...patch } : { ...version }
  ));
  return selectAssistantVersion({ ...message, versions }, activeVersionIndex);
}
