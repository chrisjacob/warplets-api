import { Hono } from "hono";
import { SPEC_VERSION, type SnapFunction } from "@farcaster/snap";
import { registerSnapHandler } from "@farcaster/snap-hono";

interface Env {
  SNAP_PUBLIC_BASE_URL?: string;
}

let workerEnv: Env | undefined;

function publicBase(request: Request, env?: Env): string {
  const configured = env?.SNAP_PUBLIC_BASE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return new URL(request.url).origin;
}

const archiveSnap: SnapFunction = async (ctx) => {
  const base = publicBase(ctx.request, workerEnv);
  return {
    version: SPEC_VERSION,
    theme: { accent: "green" },
    ui: {
      root: "page",
      elements: {
        page: {
          type: "stack",
          props: { gap: "md" },
          children: ["title", "image", "status", "history", "search"],
        },
        title: {
          type: "text",
          props: {
            content: "10X Warplets — Private 10K NFT Drop Archive",
            weight: "bold",
            size: "lg",
          },
        },
        image: {
          type: "image",
          props: {
            url: "https://warplets.10x.meme/3081.png",
            aspect: "1:1",
            alt: "10X Warplet #3081",
          },
        },
        status: {
          type: "text",
          props: {
            content: "The private-drop period has ended. Distribution changed to a free 10,000-wallet Farcaster airdrop.",
          },
        },
        history: {
          type: "text",
          props: {
            content: "This read-only archive preserves the original experience for posterity. Claims and poll votes are closed.",
          },
        },
        search: {
          type: "button",
          props: { label: "Open 10X Warplets", variant: "primary" },
          on: {
            press: {
              action: "open_mini_app",
              params: { target: "https://warplet.10x.meme" },
            },
          },
        },
      },
    },
  };
};

const app = new Hono();

app.use("*", async (c, next) => {
  workerEnv = (c as unknown as { env: Env }).env;
  await next();
});

app.get("/", (c) => c.redirect(`${publicBase(c.req.raw, workerEnv)}/drop`, 302));

for (const path of ["/drop", "/drop/poll", "/drop/claim"] as const) {
  registerSnapHandler(app, archiveSnap, {
    path,
    og: false,
    openGraph: {
      title: "10X Warplets — Private Drop Archive",
      description: "The private-drop period has ended and distribution changed to a free airdrop.",
    },
  });
}

export { app };

export default {
  fetch: app.fetch,
};
