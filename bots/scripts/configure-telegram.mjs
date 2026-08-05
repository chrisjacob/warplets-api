const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const origin = (process.env.BOTS_ORIGIN || "https://bots.10x.meme").replace(/\/$/, "");
if (!token || !secret) throw new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET are required");
if (!/^[A-Za-z0-9_-]{1,256}$/.test(secret)) throw new Error("TELEGRAM_WEBHOOK_SECRET contains unsupported characters");
const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    url: `${origin}/telegram`,
    secret_token: secret,
    allowed_updates: ["message"],
    drop_pending_updates: false,
  }),
});
const payload = await response.json();
if (!response.ok || payload.ok !== true) throw new Error(`Telegram setWebhook failed: ${JSON.stringify(payload)}`);
console.log(`Telegram webhook configured for ${origin}/telegram`);
