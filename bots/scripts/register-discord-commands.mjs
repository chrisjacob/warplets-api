const applicationId = process.env.DISCORD_APPLICATION_ID;
const botToken = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;
if (!applicationId || !botToken) throw new Error("DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN are required");

const integerToken = { name: "token", description: "Warplet token ID (0-9999)", type: 4, required: true, min_value: 0, max_value: 9999 };
const commands = [
  { name: "help", description: "Show 10X Warplets commands" },
  { name: "search", description: "Search Warplets", options: [{ name: "terms", description: "Name, trait, wallet or token ID", type: 3, required: true }] },
  { name: "random", description: "Show a random Warplet" },
  { name: "item", description: "Show one Warplet", options: [integerToken] },
  { name: "stats", description: "Show collection stats", options: [{ name: "view", description: "Stats view", type: 3, required: false, choices: ["overview", "market", "activity", "holders"].map((value) => ({ name: value, value })) }] },
  { name: "favourites", description: "List your linked-wallet favourites" },
  { name: "favourite", description: "Change a favourite", options: [
    { name: "add", description: "Add a favourite", type: 1, options: [integerToken] },
    { name: "remove", description: "Remove a favourite", type: 1, options: [integerToken] },
  ] },
  { name: "alerts", description: "View or change alert preferences", options: [
    { name: "enable", description: "Enable a topic", type: 1, options: [{ name: "topic", description: "Alert topic", type: 3, required: true }] },
    { name: "disable", description: "Disable a topic", type: 1, options: [{ name: "topic", description: "Alert topic", type: 3, required: true }] },
  ] },
  { name: "link", description: "Link a verified wallet to your Discord account" },
  { name: "ask", description: "Ask a grounded read-only Warplets question", options: [{ name: "question", description: "Your question", type: 3, required: true }] },
].map((command) => ({ ...command, integration_types: [0, 1], contexts: [0, 1, 2] }));

const route = guildId
  ? `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`
  : `https://discord.com/api/v10/applications/${applicationId}/commands`;
const response = await fetch(route, {
  method: "PUT",
  headers: { authorization: `Bot ${botToken}`, "content-type": "application/json" },
  body: JSON.stringify(commands),
});
const payload = await response.json();
if (!response.ok) throw new Error(`Discord command registration failed: ${JSON.stringify(payload)}`);
console.log(`Registered ${payload.length} Discord commands${guildId ? ` in guild ${guildId}` : " globally"}.`);
