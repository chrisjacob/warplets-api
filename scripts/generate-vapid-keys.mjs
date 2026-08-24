import { createECDH } from "node:crypto";

const target = (process.argv[2] || "app").trim().toLowerCase();
const localTunnelCommands = {
  app: "pnpm --dir app local:tunnel:app",
  warplet: "pnpm --dir app local:tunnel:warplet",
};

if (target !== "production" && !(target in localTunnelCommands)) {
  throw new Error("Target must be app, warplet, or production.");
}

const key = createECDH("prime256v1");
key.generateKeys();
const publicKey = key.getPublicKey().toString("base64url");
const privateKey = key.getPrivateKey().toString("base64url");
const subject = "mailto:notifications@10x.meme";

if (target === "production") {
  console.log("# Store this one-time production key pair in your password manager.");
  console.log("# Paste each value only into the matching interactive Wrangler secret prompt.");
  console.log(`VAPID_PUBLIC_KEY: ${publicKey}`);
  console.log(`VAPID_PRIVATE_KEY: ${privateKey}`);
  console.log(`VAPID_SUBJECT: ${subject}`);
  console.log("");
  console.log("pnpm --dir app exec wrangler pages secret put VAPID_PUBLIC_KEY --project-name 10x-app");
  console.log("pnpm --dir app exec wrangler pages secret put VAPID_PRIVATE_KEY --project-name 10x-app");
  console.log("pnpm --dir app exec wrangler pages secret put VAPID_SUBJECT --project-name 10x-app");
} else {
  console.log(`# Copy and run these commands in the same PowerShell window that will start ${target}-local:`);
  console.log(`$env:VAPID_PUBLIC_KEY="${publicKey}"`);
  console.log(`$env:VAPID_PRIVATE_KEY="${privateKey}"`);
  console.log(`$env:VAPID_SUBJECT="${subject}"`);
  console.log(localTunnelCommands[target]);
}
