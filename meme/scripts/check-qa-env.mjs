import { loadEnv } from "vite";
import { resolve } from "node:path";

const env = loadEnv("production", resolve(import.meta.dirname, ".."), "VITE_");
if (!/^[a-f0-9]{32}$/i.test(env.VITE_WALLETCONNECT_PROJECT_ID?.trim() ?? "")) {
  throw new Error(
    "QA requires VITE_WALLETCONNECT_PROJECT_ID. Copy meme/.env.example to meme/.env and set the existing public project identifier before building.",
  );
}
console.log("QA WalletConnect configuration is present.");
