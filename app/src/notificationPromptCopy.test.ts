import { describe, expect, it } from "vitest";
import { getNotificationPromptConfirmLabel, getNotificationPromptText } from "./notificationPromptCopy";

describe("notification prompt copy", () => {
  it("explains Base Save and Bookmarks requirements", () => {
    const copy = getNotificationPromptText({
      appName: "10X Warplets",
      notificationsOnlyPrompt: true,
      baseAppContext: true,
    });

    expect(copy).toContain('tap "Save"');
    expect(copy).toContain("Bookmarks");
    expect(copy).toContain("receive notifications");
    expect(getNotificationPromptConfirmLabel(true)).toBe("I've saved it");
  });

  it("keeps the existing non-Base notification message", () => {
    expect(getNotificationPromptText({
      appName: "10X Warplets",
      notificationsOnlyPrompt: true,
      baseAppContext: false,
    })).toContain("turn on notifications");
    expect(getNotificationPromptConfirmLabel(false)).toBe("Ok, let's go!");
  });
});
