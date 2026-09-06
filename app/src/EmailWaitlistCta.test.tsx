import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import EmailWaitlistCta from "./EmailWaitlistCta";

describe("email signup without a verified Farcaster session", () => {
  it.each([null, 1129138])("lets viewer %s join without waiting for authentication", (viewerFid) => {
    const markup = renderToStaticMarkup(<EmailWaitlistCta actionSessionToken={null} viewerFid={viewerFid} authenticatedSession={false} />);
    expect(markup).toContain("Join Waitlist");
    expect(markup).not.toContain("Connecting...");
    expect(markup).not.toMatch(/<(input|button)[^>]*\sdisabled=/);
  });
});
