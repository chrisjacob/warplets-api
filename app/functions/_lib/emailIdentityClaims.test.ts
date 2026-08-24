import { describe, expect, it } from "vitest";
import { emailAudienceMutationsEnabled } from "./emailIdentityClaims.js";

describe("email audience environment guard", () => {
  it("keeps production-compatible behavior unless explicitly disabled", () => {
    expect(emailAudienceMutationsEnabled({})).toBe(true);
    expect(emailAudienceMutationsEnabled({ EMAIL_AUDIENCE_MUTATIONS_ENABLED: "true" })).toBe(true);
  });

  it("blocks local audience mutations when explicitly disabled", () => {
    expect(emailAudienceMutationsEnabled({ EMAIL_AUDIENCE_MUTATIONS_ENABLED: " false " })).toBe(false);
  });
});
