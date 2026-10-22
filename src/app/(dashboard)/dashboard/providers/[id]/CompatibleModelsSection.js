"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Button, Toggle } from "@/shared/components";
import { getProviderCustomModelRows } from "@/shared/utils/providerCustomModels";

function CompatibleModelRow({ modelId, fullModel, copied, onCopy, onDeleteAlias, onTest, testStatus, isTesting, isEnabled = true, onToggle, onEdit, hasOverride = false }) {
  const borderColor = testStatus === "ok"
    ? "border-green-500/40"
    : testStatus === "error"
    ? "border-red-500/40"
    : "border-border";

  const iconColor = testStatus === "ok"
    ? "#22c55e"
    : testStatus === "error"
    ? "#ef4444"
    : undefined;

  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border ${borderColor} hover:bg-sidebar/50 transition-opacity ${!isEnabled ? "opacity-60" : ""}`}>
      <span
        className="material-symbols-outlined text-base text-text-muted shrink-0"
        style={iconColor ? { color: iconColor } : undefined}
      >
        {testStatus === "ok" ? "check_circle" : testStatus === "error" ? "cancel" : "smart_toy"}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{modelId}</p>
        <div className="flex items-center gap-1 mt-1">
          <code className="text-xs text-text-muted font-mono bg-sidebar px-1.5 py-0.5 rounded">{fullModel}</code>
          <div className="relative group/btn">
            <button
              onClick={() => onCopy(fullModel, `model-${modelId}`)}
              className="p-0.5 hover:bg-sidebar rounded text-text-muted hover:text-primary"
            >
              <span className="material-symbols-outlined text-sm">
                {copied === `model-${modelId}` ? "check" : "content_copy"}
              </span>
            </button>
            <span className="pointer-events-none absolute top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
              {copied === `model-${modelId}` ? "Copied!" : "Copy"}
            </span>
          </div>
          {onEdit && (
            <div className="relative group/btn">
              <button
                onClick={onEdit}
                className={`p-0.5 hover:bg-sidebar rounded transition-colors ${hasOverride ? "text-primary" : "text-text-muted hover:text-primary"}`}
                title="Edit model settings"
              >
                <span className="material-symbols-outlined text-sm">edit</span>
              </button>
              <span className="pointer-events-none absolute top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
                Edit settings
              </span>
            </div>
          )}
          {onTest && (
            <div className="relative group/btn">
              <button
                onClick={onTest}
                disabled={isTesting}
                className="p-0.5 hover:bg-sidebar rounded text-text-muted hover:text-primary transition-colors"
              >
                <span className="material-symbols-outlined text-sm" style={isTesting ? { animation: "spin 1s linear infinite" } : undefined}>
                  {isTesting ? "progress_activity" : "science"}
                </span>
              </button>
              <span className="pointer-events-none absolute top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
                {isTesting ? "Testing..." : "Test"}
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {onToggle && (
          <Toggle
            size="sm"
            checked={isEnabled}
            onChange={onToggle}
            className="shrink-0"
          />
        )}
        <button
          onClick={onDeleteAlias}
          className="p-1 hover:bg-red-50 dark:hover:bg-red-500/10 rounded text-red-500 transition-colors shrink-0"
          title="Remove model"
        >
          <span className="material-symbols-outlined text-sm">delete</span>
        </button>
      </div>
    </div>
  );
}

CompatibleModelRow.propTypes = {
  modelId: PropTypes.string.isRequired,
  fullModel: PropTypes.string.isRequired,
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  onDeleteAlias: PropTypes.func.isRequired,
  onTest: PropTypes.func,
  testStatus: PropTypes.oneOf(["ok", "error"]),
  isTesting: PropTypes.bool,
  isEnabled: PropTypes.bool,
  onToggle: PropTypes.func,
  onEdit: PropTypes.func,
  hasOverride: PropTypes.bool,
};

export default function CompatibleModelsSection({
  providerStorageAlias,
  providerDisplayAlias,
  modelAliases,
  customModels,
  copied,
  onCopy,
  onDeleteAlias,
  onAddCustomModel,
  onDeleteCustomModel,
  disabledModelIds = [],
  onEnableModel,
  onDisableModel,
  onDisableAll,
  onEnableAll,
  onDeleteAll,
  onEditModel,
  modelOverrides = {},
  connections,
  isAnthropic
}) {
  const [newModel, setNewModel] = useState("");
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [testingModelId, setTestingModelId] = useState(null);
  const [modelTestResults, setModelTestResults] = useState({});

  const disabledSet = new Set(disabledModelIds || []);

  const handleTestModel = async (modelId) => {
    if (testingModelId) return;
    setTestingModelId(modelId);
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${providerStorageAlias}/${modelId}` }),
      });
      const data = await res.json();
      setModelTestResults((prev) => ({ ...prev, [modelId]: data.ok ? "ok" : "error" }));
    } catch {
      setModelTestResults((prev) => ({ ...prev, [modelId]: "error" }));
    } finally {
      setTestingModelId(null);
    }
  };

  const allModels = getProviderCustomModelRows({
    customModels,
    modelAliases,
    providerAlias: providerStorageAlias,
    type: "llm",
  });

  const trimmedInput = newModel.trim();
  const searchLower = trimmedInput.toLowerCase();
  const filteredModels = searchLower
    ? allModels.filter((m) => {
        const idMatch = m.id?.toLowerCase().includes(searchLower);
        const nameMatch = m.name?.toLowerCase().includes(searchLower);
        const aliasMatch = m.alias?.toLowerCase().includes(searchLower);
        return idMatch || nameMatch || aliasMatch;
      })
    : allModels;

  const modelAlreadyExists = allModels.some(
    (m) => m.id.toLowerCase() === trimmedInput.toLowerCase()
  );

  const visibleIds = filteredModels.map((model) => model.id);
  const visibleActiveIds = visibleIds.filter((id) => !disabledSet.has(id));

  const handleAdd = async () => {
    if (!trimmedInput || adding) return;
    if (modelAlreadyExists) {
      alert("Model already exists for this provider.");
      return;
    }

    setAdding(true);
    try {
      await onAddCustomModel(trimmedInput);
      setNewModel("");
    } catch (error) {
      console.log("Error adding model:", error);
    } finally {
      setAdding(false);
    }
  };

  const handleImport = async () => {
    if (importing) return;
    const activeConnection = connections.find((conn) => conn.isActive !== false);
    if (!activeConnection) return;

    setImporting(true);
    try {
      const res = await fetch(`/api/providers/${activeConnection.id}/models`);
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to import models");
        return;
      }
      const models = data.models || [];
      if (models.length === 0) {
        alert("No models returned from /models.");
        return;
      }
      let importedCount = 0;
      for (const model of models) {
        const modelId = model.id || model.name || model.model;
        if (!modelId) continue;
        if (allModels.some((entry) => entry.id === modelId)) continue;
        await onAddCustomModel(modelId);
        importedCount += 1;
      }
      if (importedCount === 0) {
        alert("No new models were added.");
      }
    } catch (error) {
      console.log("Error importing models:", error);
    } finally {
      setImporting(false);
    }
  };

  const canImport = connections.some((conn) => conn.isActive !== false);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">
        Add {isAnthropic ? "Anthropic" : "OpenAI"}-compatible models manually or import them from the /models endpoint.
      </p>

      <div className="flex items-end gap-2 flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <div className="flex items-center justify-between mb-1">
            <label htmlFor="new-compatible-model-input" className="text-xs text-text-muted">
              Model ID
            </label>
            {trimmedInput && (
              <span className="text-[11px] text-text-muted">
                {filteredModels.length} / {allModels.length}
              </span>
            )}
          </div>
          <div className="relative">
            <input
              id="new-compatible-model-input"
              type="text"
              value={newModel}
              onChange={(e) => setNewModel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              placeholder={isAnthropic ? "claude-3-opus-20240229" : "gpt-4o"}
              className="w-full pl-10 pr-8 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
            />
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-text-muted pointer-events-none">
              search
            </span>
            {newModel && (
              <button
                type="button"
                onClick={() => setNewModel("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-main p-0.5 rounded"
                title="Clear"
              >
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            )}
          </div>
        </div>
        <Button
          size="sm"
          icon="add"
          onClick={handleAdd}
          disabled={!trimmedInput || adding || modelAlreadyExists}
          title={modelAlreadyExists ? "Model already exists in list" : "Add model"}
        >
          {adding ? "Adding..." : "Add"}
        </Button>
        <Button size="sm" variant="secondary" icon="download" onClick={handleImport} disabled={!canImport || importing}>
          {importing ? "Importing..." : "Import from /models"}
        </Button>
      </div>

      {!canImport && (
        <p className="text-xs text-text-muted">
          Add a connection to enable importing models.
        </p>
      )}

      {allModels.length > 0 && (
        <div className="flex items-center justify-between gap-2 flex-wrap pt-2 border-t border-border/40">
          <p className="text-xs text-text-muted">
            {trimmedInput
              ? `Showing ${filteredModels.length}/${allModels.length} models`
              : `${allModels.length} model${allModels.length > 1 ? "s" : ""}`}
          </p>
          <div className="flex items-center gap-2">
            {visibleActiveIds.length > 0 && (
              <Button
                size="sm"
                variant="secondary"
                icon="block"
                onClick={() => onDisableAll?.(visibleActiveIds)}
              >
                Disable All
              </Button>
            )}
            {disabledModelIds.length > 0 && (
              <Button
                size="sm"
                variant="secondary"
                icon="restart_alt"
                onClick={onEnableAll}
              >
                Active All
              </Button>
            )}
            <Button
              size="sm"
              variant="danger"
              icon="delete"
              onClick={() => onDeleteAll?.(filteredModels)}
            >
              Delete All
            </Button>
          </div>
        </div>
      )}

      {allModels.length > 0 && (
        <div className="flex flex-col gap-3">
          {filteredModels.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-4 text-center">
              <p className="text-xs text-text-muted mb-2">
                No models found
              </p>
              <Button size="sm" icon="add" onClick={handleAdd} disabled={adding}>
                Add
              </Button>
            </div>
          ) : (
            filteredModels.map(({ id, alias, source }) => {
              const isEnabled = !disabledSet.has(id);
              return (
                <CompatibleModelRow
                  key={`${source}-${providerStorageAlias}/${id}`}
                  modelId={id}
                  fullModel={`${providerDisplayAlias}/${id}`}
                  copied={copied}
                  onCopy={onCopy}
                  onDeleteAlias={() => source === "custom" ? onDeleteCustomModel(id) : onDeleteAlias(alias)}
                  onTest={connections.length > 0 ? () => handleTestModel(id) : undefined}
                  testStatus={modelTestResults[id]}
                  isTesting={testingModelId === id}
                  isEnabled={isEnabled}
                  onToggle={(checked) => (checked ? onEnableModel?.(id) : onDisableModel?.(id))}
                  onEdit={onEditModel ? () => onEditModel(id) : undefined}
                  hasOverride={!!modelOverrides[id]}
                />
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

CompatibleModelsSection.propTypes = {
  providerStorageAlias: PropTypes.string.isRequired,
  providerDisplayAlias: PropTypes.string.isRequired,
  modelAliases: PropTypes.object.isRequired,
  customModels: PropTypes.arrayOf(PropTypes.object),
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  onDeleteAlias: PropTypes.func.isRequired,
  onAddCustomModel: PropTypes.func.isRequired,
  onDeleteCustomModel: PropTypes.func.isRequired,
  disabledModelIds: PropTypes.arrayOf(PropTypes.string),
  onEnableModel: PropTypes.func,
  onDisableModel: PropTypes.func,
  onDisableAll: PropTypes.func,
  onEnableAll: PropTypes.func,
  onDeleteAll: PropTypes.func,
  onEditModel: PropTypes.func,
  modelOverrides: PropTypes.object,
  connections: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    isActive: PropTypes.bool,
  })).isRequired,
  isAnthropic: PropTypes.bool,
};

