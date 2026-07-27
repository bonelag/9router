import { describe, expect, it } from "vitest";
import {
  appendAssistantVersion,
  getActiveAssistantVersionIndex,
  getAssistantVersions,
  getRegenerationContext,
  patchActiveAssistantVersion,
  selectAssistantVersion,
} from "@/shared/utils/basicChatMessages";

describe("basic chat regeneration context", () => {
  const messages = [
    { id: "u1", role: "user", content: "First" },
    { id: "a1", role: "assistant", content: "First answer" },
    { id: "u2", role: "user", content: "Second", attachments: [{ id: "image" }] },
    { id: "a2", role: "assistant", content: "Second answer", mode: "chat" },
    { id: "u3", role: "user", content: "Later message" },
  ];

  it("keeps history through the user message before the selected response", () => {
    expect(getRegenerationContext(messages, "a2")).toEqual({
      history: messages.slice(0, 3),
      userMessage: messages[2],
      assistantMessage: messages[3],
    });
  });

  it("returns null for an unknown response", () => {
    expect(getRegenerationContext(messages, "missing")).toBeNull();
  });

  it("does not regenerate an assistant response without a preceding user message", () => {
    expect(getRegenerationContext([
      { id: "a1", role: "assistant", content: "orphan" },
    ], "a1")).toBeNull();
  });

  it("appends a new response version without losing the original", () => {
    const original = messages[1];
    const next = appendAssistantVersion(original, {
      content: "",
      status: "streaming",
      mode: "chat",
      createdAt: "new-version",
    });

    expect(getAssistantVersions(next)).toHaveLength(2);
    expect(getAssistantVersions(next)[0].content).toBe("First answer");
    expect(getActiveAssistantVersionIndex(next)).toBe(1);
    expect(next.content).toBe("");
    expect(next.status).toBe("streaming");
  });

  it("patches only the active version and switches between versions", () => {
    const withRetry = appendAssistantVersion(messages[1], {
      content: "",
      status: "streaming",
      mode: "chat",
    });
    const completed = patchActiveAssistantVersion(withRetry, {
      content: "Regenerated answer",
      status: "done",
    });
    const original = selectAssistantVersion(completed, 0);

    expect(getAssistantVersions(completed)[1].content).toBe("Regenerated answer");
    expect(original.content).toBe("First answer");
    expect(original.activeVersionIndex).toBe(0);
    expect(getAssistantVersions(original)[1].content).toBe("Regenerated answer");
  });
});
