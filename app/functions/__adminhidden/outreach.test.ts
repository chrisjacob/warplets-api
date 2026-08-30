import { describe, expect, it } from "vitest";
import { onRequestGet } from "./outreach";

describe("holder outreach admin page", () => {
  it("emits syntactically valid client JavaScript", async () => {
    const response = await onRequestGet({} as never) as Response;
    const html = await response.text();
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];

    expect(script).toBeTruthy();
    expect(() => new Function(script!)).not.toThrow();
    expect(html).toContain("Holder Outreach");
  });
});
