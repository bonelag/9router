import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
}));

import { POST } from "../../src/app/api/providers/[id]/reset-session/route.js";
import {
  OPENCODE_SESSION_RE,
  translateSessionId,
} from "../../open-sse/executors/opencode.js";

describe("POST /api/providers/[id]/reset-session", () => {
  it("rejects non-opencode providers with 400", async () => {
    for (const invalid of ["kiro", "kimi", "cursor", "random"]) {
      const res = await POST(new Request("http://localhost"), { params: Promise.resolve({ id: invalid }) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/only supported for OpenCode Free/i);
    }
  });

  it("resets session for opencode, oc, and opencode-free", async () => {
    for (const validId of ["opencode", "oc", "opencode-free", "OPENCODE"]) {
      const before = translateSessionId("conv-route-test", "claude");
      const res = await POST(new Request("http://localhost"), { params: Promise.resolve({ id: validId }) });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.sessionId).toMatch(OPENCODE_SESSION_RE);

      const after = translateSessionId("conv-route-test", "claude");
      expect(after).toMatch(OPENCODE_SESSION_RE);
      expect(after).not.toBe(before);
    }
  });
});
