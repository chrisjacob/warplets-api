import { createECDH } from "node:crypto";

const key = createECDH("prime256v1");
key.generateKeys();

console.log("# Copy and run these commands in the same PowerShell window that will start warplet-local:");
console.log(`$env:VAPID_PUBLIC_KEY="${key.getPublicKey().toString("base64url")}"`);
console.log(`$env:VAPID_PRIVATE_KEY="${key.getPrivateKey().toString("base64url")}"`);
console.log('$env:VAPID_SUBJECT="mailto:notifications@10x.meme"');
console.log("pnpm --dir app local:tunnel:warplet");
