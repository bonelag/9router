import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHROME_USER_AGENT,
  buildCustomProviderHeaders,
  splitCustomProviderHeaders,
} from "@/shared/utils/customProviderHeaders";

describe("custom provider header form helpers", () => {
  it("uses the default Chrome User-Agent when the dedicated field is blank", () => {
    expect(buildCustomProviderHeaders("   ", [])).toEqual([
      { key: "User-Agent", value: DEFAULT_CHROME_USER_AGENT },
    ]);
  });

  it("keeps a custom User-Agent separate from additional headers", () => {
    expect(buildCustomProviderHeaders(" claude-cli/2.1.199 ", [
      { key: " X-Test ", value: " enabled " },
      { key: "user-agent", value: "duplicate" },
      { key: "   ", value: "ignored" },
    ])).toEqual([
      { key: "User-Agent", value: "claude-cli/2.1.199" },
      { key: "X-Test", value: "enabled" },
    ]);
  });

  it("extracts a legacy User-Agent entry for the edit form", () => {
    expect(splitCustomProviderHeaders([
      { key: "X-Test", value: "enabled" },
      { key: "user-agent", value: "custom-agent" },
    ])).toEqual({
      customUserAgent: "custom-agent",
      customHeaders: [{ key: "X-Test", value: "enabled" }],
    });
  });

  it("shows an empty field when the stored value is the default", () => {
    expect(splitCustomProviderHeaders([
      { key: "User-Agent", value: DEFAULT_CHROME_USER_AGENT },
    ])).toEqual({
      customUserAgent: "",
      customHeaders: [],
    });
  });
});
