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

  it("renders outreach rows as labeled cards on mobile without a wide table", async () => {
    const response = await onRequestGet({} as never) as Response;
    const html = await response.text();

    expect(html).toContain("@media(max-width:760px)");
    expect(html).toContain(".table-wrap table,.table-wrap tbody{display:block;width:100%;min-width:0}");
    expect(html).toContain(".table-wrap tbody tr{display:block");
    expect(html).toContain("data-label=\"Holder\"");
    expect(html).toContain("data-label=\"Actions\"");
    expect(html).toContain("'accept':'application/json'");
  });
});
