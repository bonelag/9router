import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const SCOPE = "modelOverrides";
const OVERRIDE_FIELDS = ["contextWindow", "effort", "accountIds"];

// Model ids may reach runtime with a thinking suffix ("model(high)") — the
// override always belongs to the base model.
export function normalizeOverrideModelId(modelId) {
  return typeof modelId === "string"
    ? modelId.replace(/\([^()]+\)\s*$/, "").trim()
    : "";
}

function normalizeField(key, value) {
  if (key === "contextWindow") {
    if (value === null || value === undefined || value === "") return undefined;
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return Math.floor(n);
  }
  if (key === "effort") {
    if (typeof value !== "string") return undefined;
    const effort = value.trim().toLowerCase();
    return effort || undefined;
  }
  if (key === "accountIds") {
    if (!Array.isArray(value)) return undefined;
    const ids = [...new Set(
      value
        .filter((id) => typeof id === "string")
        .map((id) => id.trim())
        .filter(Boolean)
    )];
    return ids.length ? ids : undefined;
  }
  return undefined;
}

export async function getModelOverrides() {
  const db = await getAdapter();
  const rows = db.all(`SELECT key, value FROM kv WHERE scope = ?`, [SCOPE]);
  const out = {};
  for (const r of rows) out[r.key] = parseJson(r.value, {});
  return out;
}

export async function getOverridesByProvider(providerId) {
  if (!providerId) return {};
  const db = await getAdapter();
  const row = db.get(`SELECT value FROM kv WHERE scope = ? AND key = ?`, [SCOPE, providerId]);
  return row ? (parseJson(row.value, {}) || {}) : {};
}

export async function getModelOverride(providerId, modelId) {
  const id = normalizeOverrideModelId(modelId);
  if (!providerId || !id) return null;
  const overrides = await getOverridesByProvider(providerId);
  return overrides[id] || null;
}

// Atomic read-merge-write inside a transaction (no JS yield mid-transaction).
// A null/empty value clears that field; an override with no fields left is
// removed entirely.
export async function setModelOverride(providerId, modelId, patch = {}) {
  const id = normalizeOverrideModelId(modelId);
  if (!providerId || !id) return null;

  const db = await getAdapter();
  let saved = null;
  db.transaction(() => {
    const row = db.get(`SELECT value FROM kv WHERE scope = ? AND key = ?`, [SCOPE, providerId]);
    const map = row ? (parseJson(row.value, {}) || {}) : {};
    const current = map[id] && typeof map[id] === "object" ? map[id] : {};
    const next = { ...current };

    for (const key of OVERRIDE_FIELDS) {
      if (!Object.hasOwn(patch, key)) continue;
      const normalized = normalizeField(key, patch[key]);
      if (normalized === undefined) delete next[key];
      else next[key] = normalized;
    }

    if (Object.keys(next).length === 0) delete map[id];
    else map[id] = next;

    if (Object.keys(map).length === 0) {
      db.run(`DELETE FROM kv WHERE scope = ? AND key = ?`, [SCOPE, providerId]);
    } else {
      db.run(
        `INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
        [SCOPE, providerId, stringifyJson(map)]
      );
    }
    saved = Object.keys(next).length ? next : null;
  });
  return saved;
}

export async function deleteModelOverride(providerId, modelId) {
  const id = normalizeOverrideModelId(modelId);
  if (!providerId || !id) return false;

  const db = await getAdapter();
  let removed = false;
  db.transaction(() => {
    const row = db.get(`SELECT value FROM kv WHERE scope = ? AND key = ?`, [SCOPE, providerId]);
    if (!row) return;
    const map = parseJson(row.value, {}) || {};
    if (!Object.hasOwn(map, id)) return;

    delete map[id];
    removed = true;
    if (Object.keys(map).length === 0) {
      db.run(`DELETE FROM kv WHERE scope = ? AND key = ?`, [SCOPE, providerId]);
    } else {
      db.run(
        `INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
        [SCOPE, providerId, stringifyJson(map)]
      );
    }
  });
  return removed;
}
