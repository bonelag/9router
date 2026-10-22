"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Button, Input, Modal, Select } from "@/shared/components";

const DEFAULT_EFFORT_LEVELS = ["none", "auto", "minimal", "low", "medium", "high", "xhigh", "max"];

function buildEffortOptions(thinkingLevels) {
  const levels = Array.isArray(thinkingLevels) && thinkingLevels.length
    ? thinkingLevels
    : DEFAULT_EFFORT_LEVELS;
  const merged = ["none", "auto", ...levels.map((level) => String(level).toLowerCase())];
  return [...new Set(merged)].map((level) => ({ value: level, label: level }));
}

export default function EditModelModal({
  isOpen,
  onClose,
  model,
  connections = [],
  override,
  defaultContextWindow,
  thinkingLevels,
  onSave,
}) {
  // The parent remounts this modal on every open (key includes isOpen), so
  // initializing from props is enough — no reset effect needed.
  const activeConnections = connections.filter((connection) => connection.isActive !== false);
  const activeConnectionIds = activeConnections.map((connection) => connection.id);

  const [contextWindow, setContextWindow] = useState(() =>
    override?.contextWindow != null ? String(override.contextWindow) : ""
  );
  const [effort, setEffort] = useState(() => override?.effort || "");
  const [accountIds, setAccountIds] = useState(() => {
    const saved = Array.isArray(override?.accountIds)
      ? override.accountIds.filter((id) => activeConnectionIds.includes(id))
      : [];
    return saved.length ? saved : activeConnectionIds;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const allAccounts = activeConnections.length > 0 && accountIds.length === activeConnectionIds.length;
  const effortOptions = buildEffortOptions(thinkingLevels);

  if (!model) return null;

  const toggleAccount = (connectionId) => {
    setAccountIds((prev) => prev.includes(connectionId)
      ? prev.filter((id) => id !== connectionId)
      : [...prev, connectionId]);
  };

  const handleSave = async () => {
    if (saving) return;

    let parsedContextWindow = null;
    if (String(contextWindow).trim() !== "") {
      parsedContextWindow = Number(contextWindow);
      if (!Number.isFinite(parsedContextWindow) || parsedContextWindow <= 0) {
        setError("Context window must be a positive number");
        return;
      }
      parsedContextWindow = Math.floor(parsedContextWindow);
    }

    const selectedAccountIds = accountIds.filter((id) => activeConnectionIds.includes(id));
    if (activeConnections.length > 0 && selectedAccountIds.length === 0) {
      setError("Select at least one account");
      return;
    }
    const accountPatch = activeConnections.length === 0 || selectedAccountIds.length === activeConnectionIds.length
      ? null
      : selectedAccountIds;

    setSaving(true);
    setError("");
    try {
      await onSave(model.id, {
        contextWindow: parsedContextWindow,
        effort: effort || null,
        accountIds: accountPatch,
      });
      onClose();
    } catch (saveError) {
      setError(saveError.message || "Failed to save model settings");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await onSave(model.id, { contextWindow: null, effort: null, accountIds: null });
      onClose();
    } catch (resetError) {
      setError(resetError.message || "Failed to reset model settings");
    } finally {
      setSaving(false);
    }
  };

  const hasOverride = Boolean(
    override?.contextWindow || override?.effort || (Array.isArray(override?.accountIds) && override.accountIds.length)
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Edit Model Settings">
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-xs text-text-muted">Model</p>
          <code className="mt-1 inline-block max-w-full break-all rounded bg-sidebar px-1.5 py-0.5 font-mono text-xs text-text-muted">
            {model.id}
          </code>
        </div>

        <div>
          <Input
            label="Context window"
            type="number"
            min={1}
            step={1}
            value={contextWindow}
            onChange={(event) => setContextWindow(event.target.value)}
            placeholder={defaultContextWindow ? String(defaultContextWindow) : "e.g. 200000"}
            hint={
              defaultContextWindow
                ? `Leave empty to inherit (${Number(defaultContextWindow).toLocaleString("en-US")}).`
                : "Leave empty to inherit the detected context window."
            }
          />
        </div>

        <Select
          label="Effort override"
          value={effort || "__default__"}
          onChange={(event) => setEffort(event.target.value === "__default__" ? "" : event.target.value)}
          placeholder="Default"
          options={[{ value: "__default__", label: "Default (client / model)" }, ...effortOptions]}
          hint="Highest priority — overrides the request, model suffix and provider-level thinking config."
        />

        {activeConnections.length > 1 && (
          <div>
            <p className="text-sm font-medium text-text-main">Accounts</p>
            <p className="mt-0.5 text-xs text-text-muted">
              Requests for this model rotate only through the selected accounts. All active accounts are selected by default.
            </p>
            <div className="mt-2 flex flex-col gap-1.5 rounded-lg border border-border p-2">
              <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-sidebar">
                <input
                  type="checkbox"
                  checked={allAccounts}
                  onChange={(event) => setAccountIds(event.target.checked ? activeConnectionIds : [])}
                  className="accent-primary"
                />
                <span className="font-medium">All active accounts (default)</span>
              </label>
              <div className="my-0.5 h-px bg-border" />
              {activeConnections.map((connection) => {
                const label = connection.displayName || connection.name || connection.email || connection.id;
                const checked = accountIds.includes(connection.id);
                return (
                  <label
                    key={connection.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-sidebar"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleAccount(connection.id)}
                      className="accent-primary"
                    />
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                    <code className="shrink-0 font-mono text-[10px] text-text-muted/70">
                      {connection.id.slice(0, 8)}
                    </code>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {error && (
          <p className="flex items-center gap-1 text-xs text-red-500">
            <span className="material-symbols-outlined text-[14px]">error</span>
            {error}
          </p>
        )}

        <div className="flex gap-2 pt-1">
          {hasOverride && (
            <Button onClick={handleReset} variant="ghost" size="sm" disabled={saving}>
              Reset
            </Button>
          )}
          <div className="flex-1" />
          <Button onClick={onClose} variant="ghost" size="sm" disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} size="sm" loading={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

EditModelModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  model: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string,
  }),
  connections: PropTypes.arrayOf(PropTypes.object),
  override: PropTypes.shape({
    contextWindow: PropTypes.number,
    effort: PropTypes.string,
    accountIds: PropTypes.arrayOf(PropTypes.string),
  }),
  defaultContextWindow: PropTypes.number,
  thinkingLevels: PropTypes.arrayOf(PropTypes.string),
  onSave: PropTypes.func.isRequired,
};
