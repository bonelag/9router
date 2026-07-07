"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Button, Badge, Input, Modal, Select, Toggle } from "@/shared/components";

export default function EditCompatibleNodeModal({ isOpen, node, onSave, onClose, isAnthropic }) {
  const [formData, setFormData] = useState({
    name: "",
    prefix: "",
    apiType: "chat",
    baseUrl: "https://api.openai.com/v1",
    headersEnabled: false,
    customHeaders: [{ key: "", value: "" }],
  });
  const [saving, setSaving] = useState(false);
  const [checkKey, setCheckKey] = useState("");
  const [checkModelId, setCheckModelId] = useState("");
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);

  useEffect(() => {
    if (node) {
      setFormData({
        name: node.name || "",
        prefix: node.prefix || "",
        apiType: node.apiType || "chat",
        baseUrl: node.baseUrl || (isAnthropic ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1"),
        headersEnabled: node.headersEnabled || false,
        customHeaders: node.customHeaders && node.customHeaders.length > 0
          ? node.customHeaders.map(h => ({ ...h }))
          : [{ key: "", value: "" }],
      });
    }
  }, [node, isAnthropic]);

  const apiTypeOptions = [
    { value: "chat", label: "Chat Completions" },
    { value: "responses", label: "Responses API" },
  ];

  const handleSubmit = async () => {
    if (!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim()) return;
    setSaving(true);
    try {
      const headersEnabled = formData.headersEnabled === true;
      const customHeaders = headersEnabled && Array.isArray(formData.customHeaders)
        ? formData.customHeaders.filter((h) => h.key && h.key.trim())
        : [];

      const payload = {
        name: formData.name,
        prefix: formData.prefix,
        baseUrl: formData.baseUrl,
        headersEnabled,
        customHeaders,
      };
      if (!isAnthropic) {
        payload.apiType = formData.apiType;
      }
      await onSave(payload);
    } finally {
      setSaving(false);
    }
  };

  const handleValidate = async () => {
    setValidating(true);
    try {
      const headersEnabled = formData.headersEnabled === true;
      const customHeaders = headersEnabled && Array.isArray(formData.customHeaders)
        ? formData.customHeaders.filter((h) => h.key && h.key.trim())
        : [];

      const res = await fetch("/api/provider-nodes/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: formData.baseUrl,
          apiKey: checkKey,
          type: isAnthropic ? "anthropic-compatible" : "openai-compatible",
          modelId: checkModelId.trim() || undefined,
          headersEnabled,
          customHeaders,
        }),
      });
      const data = await res.json();
      setValidationResult(data.valid ? "success" : "failed");
    } catch {
      setValidationResult("failed");
    } finally {
      setValidating(false);
    }
  };

  if (!node) return null;

  return (
    <Modal isOpen={isOpen} title={`Edit ${isAnthropic ? "Anthropic" : "OpenAI"} Compatible`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Input
          label="Name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder={`${isAnthropic ? "Anthropic" : "OpenAI"} Compatible (Prod)`}
          hint="Required. A friendly label for this node."
        />
        <Input
          label="Prefix"
          value={formData.prefix}
          onChange={(e) => setFormData({ ...formData, prefix: e.target.value })}
          placeholder={isAnthropic ? "ac-prod" : "oc-prod"}
          hint="Required. Used as the provider prefix for model IDs."
        />
        {!isAnthropic && (
          <Select
            label="API Type"
            options={apiTypeOptions}
            value={formData.apiType}
            onChange={(e) => setFormData({ ...formData, apiType: e.target.value })}
          />
        )}
        <Input
          label="Base URL"
          value={formData.baseUrl}
          onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
          placeholder={isAnthropic ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1"}
          hint={`Use the base URL (ending in /v1) for your ${isAnthropic ? "Anthropic" : "OpenAI"}-compatible API.`}
        />
        <div className="flex flex-col gap-3 py-1">
          <Toggle
            label="Custom Headers"
            description="Add one or more custom HTTP headers sent to this provider"
            checked={formData.headersEnabled}
            onChange={(val) => setFormData({ ...formData, headersEnabled: val })}
          />
          {formData.headersEnabled && (
            <div className="flex flex-col gap-2 p-3 bg-surface-2 rounded-xl border border-border">
              {formData.customHeaders.map((header, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <Input
                    placeholder="Key (e.g. X-Header)"
                    value={header.key}
                    onChange={(e) => {
                      const newHeaders = [...formData.customHeaders];
                      newHeaders[idx].key = e.target.value;
                      setFormData({ ...formData, customHeaders: newHeaders });
                    }}
                    className="flex-1"
                  />
                  <Input
                    placeholder="Value"
                    value={header.value}
                    onChange={(e) => {
                      const newHeaders = [...formData.customHeaders];
                      newHeaders[idx].value = e.target.value;
                      setFormData({ ...formData, customHeaders: newHeaders });
                    }}
                    className="flex-1"
                  />
                  <Button
                    variant="ghost"
                    icon="delete"
                    onClick={() => {
                      const newHeaders = formData.customHeaders.filter((_, i) => i !== idx);
                      setFormData({ ...formData, customHeaders: newHeaders });
                    }}
                    className="text-red-500 hover:text-red-600 p-2 mt-1"
                  />
                </div>
              ))}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setFormData({
                    ...formData,
                    customHeaders: [...formData.customHeaders, { key: "", value: "" }],
                  });
                }}
                className="mt-1 self-start"
              >
                + Add Header
              </Button>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Input
            label="API Key (for Check)"
            type="password"
            value={checkKey}
            onChange={(e) => setCheckKey(e.target.value)}
            className="flex-1"
          />
          <div className="pt-6">
            <Button onClick={handleValidate} disabled={!checkKey || validating || !formData.baseUrl.trim()} variant="secondary">
              {validating ? "Checking..." : "Check"}
            </Button>
          </div>
        </div>
        <Input
          label="Model ID (optional)"
          value={checkModelId}
          onChange={(e) => setCheckModelId(e.target.value)}
          placeholder="e.g. my-model-id"
          hint="If provider lacks /models endpoint, enter a model ID to validate via chat/completions instead."
        />
        {validationResult && (
          <Badge variant={validationResult === "success" ? "success" : "error"}>
            {validationResult === "success" ? "Valid" : "Invalid"}
          </Badge>
        )}
        <div className="flex gap-2">
          <Button onClick={handleSubmit} fullWidth disabled={!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim() || saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

EditCompatibleNodeModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  node: PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    prefix: PropTypes.string,
    apiType: PropTypes.string,
    baseUrl: PropTypes.string,
    headersEnabled: PropTypes.bool,
    customHeaders: PropTypes.arrayOf(PropTypes.shape({
      key: PropTypes.string,
      value: PropTypes.string,
    })),
  }),
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
  isAnthropic: PropTypes.bool,
};

