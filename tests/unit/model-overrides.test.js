import { describe, expect, it, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Keep this suite away from the real ~/.9router database.
const dataDir = mkdtempSync(join(tmpdir(), "9r-model-overrides-"));
process.env.DATA_DIR = dataDir;

const {
  getModelOverride,
  getOverridesByProvider,
  setModelOverride,
  deleteModelOverride,
} = await import("@/lib/db/repos/modelOverridesRepo.js");

afterAll(() => {
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // Windows may keep the SQLite file open until the worker exits.
  }
});

describe("model overrides repo", () => {
  it("stores, merges and reads overrides by base model id", async () => {
    await setModelOverride("codex", "gpt-5.6-terra", {
      contextWindow: 123456,
      effort: "HIGH",
      accountIds: ["acc-a", "acc-b", "acc-a"],
    });

    expect(await getModelOverride("codex", "gpt-5.6-terra(high)")).toEqual({
      contextWindow: 123456,
      effort: "high",
      accountIds: ["acc-a", "acc-b"],
    });

    await setModelOverride("codex", "gpt-5.6-terra", { effort: null });

    expect(await getModelOverride("codex", "gpt-5.6-terra")).toEqual({
      contextWindow: 123456,
      accountIds: ["acc-a", "acc-b"],
    });
  });

  it("removes the entry when the last field is cleared", async () => {
    await setModelOverride("codex", "gpt-5.6-sol", { effort: "low" });
    expect(await getModelOverride("codex", "gpt-5.6-sol")).toEqual({ effort: "low" });

    await setModelOverride("codex", "gpt-5.6-sol", { effort: "" });
    expect(await getModelOverride("codex", "gpt-5.6-sol")).toBeNull();
    expect(await getOverridesByProvider("codex")).toEqual({
      "gpt-5.6-terra": { contextWindow: 123456, accountIds: ["acc-a", "acc-b"] },
    });
  });

  it("deletes a single override and keeps the rest", async () => {
    expect(await deleteModelOverride("codex", "gpt-5.6-terra")).toBe(true);
    expect(await getOverridesByProvider("codex")).toEqual({});
    expect(await getModelOverride("codex", "gpt-5.6-terra")).toBeNull();
  });
});
