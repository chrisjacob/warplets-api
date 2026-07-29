export type PerksSubpage = "memes" | "nfts" | "ai" | "attention" | "access";

export type PerksMetric = {
  label: string;
  value: string;
  detail?: string;
};

export type PerksExplorerRow = {
  filter: string;
  cells: string[];
  progress?: number;
  airdropUsd?: number[];
  imageSrc?: string;
  tools?: string[];
};

export type PerksDefinition = {
  id: PerksSubpage;
  title: string;
  eyebrow: string;
  statsTitle: string;
  summary: string;
  globalMetrics: PerksMetric[];
  averageTitle: string;
  averageMetrics: PerksMetric[];
  explorer: {
    title: string;
    description: string;
    filters: string[];
    columns: string[];
    rows: PerksExplorerRow[];
  };
  leaderboardMetric: string;
  explanation: Array<{ title: string; body: string; callout?: string }>;
};

export const PERKS_MOCK_DATA_VERSION = "perks-demo-v1";
export const PERKS_MOCKUP_NOTICE_DISMISSED_KEY = "warplets-perks-mockup-notice-dismissed-v1";

export const PERKS_DEFINITIONS: Record<PerksSubpage, PerksDefinition> = {
  memes: {
    id: "memes",
    title: "Memes",
    eyebrow: "Attention Tokens",
    statsTitle: "Token Stats",
    summary: "One market-proven memecoin. One community decision. One\u00A0focused launch at a time... 10X Airdrops!",
    globalMetrics: [
      { label: "Attention Tokens", value: "128" },
      { label: "Launch Days Skipped", value: "17" },
      { label: "Launch Liquidity", value: "$128K", detail: "Initial liquidity seeded across 128 Attention Token launches." },
      { label: "Airdrop Value Now", value: "$4.86M" },
      { label: "Airdrop Value at ATH", value: "$18.42M" },
      { label: "Combined Token ATH", value: "$312.6M" },
    ],
    averageTitle: "Average Member",
    averageMetrics: [
      { label: "Highest Level", value: "2X" },
      { label: "Airdrop Boost", value: "4.5X" },
      { label: "Eligible Launches", value: "46" },
      { label: "Airdrop Value Now", value: "$486" },
      { label: "Airdrop Value at ATH", value: "$1,842" },
      { label: "Best Airdrop Gain", value: "+14,600%" },
    ],
    explorer: {
      title: "Airdrop Explorer",
      description: "Attention Tokens community distribution airdrops.",
      filters: ["All", "Base", "BNB", "Solana", "Robinhood"],
      columns: ["Token", "Chain", "Launchpad", "Airdropped", "MCAP", "ATH"],
      rows: [
        { filter: "Base", cells: ["$BULL10X", "Base", "Clanker", "$278,700", "$1.8M", "$8.4M"], progress: 80, airdropUsd: [31000, 32800, 33700, 34600, 35200, 36100, 37200, 38100, 39000, 40100] },
        { filter: "Solana", cells: ["$TRENCH10X", "Solana", "Pump", "$124,500", "$920K", "$6.1M"], progress: 60, airdropUsd: [18200, 19400, 20100, 21300, 22400, 23100, 24200, 25100, 26300, 27100] },
        { filter: "BNB", cells: ["$BYTE10X", "BNB", "Four", "$178,400", "$2.3M", "$11.2M"], progress: 40, airdropUsd: [42600, 43900, 45100, 46800, 47900, 49200, 50500, 51800, 53200, 54700] },
        { filter: "Robinhood", cells: ["$HOOD10X", "Robinhood", "Pons", "$29,600", "$740K", "$3.9M"], progress: 20, airdropUsd: [14400, 15200, 16100, 16800, 17500, 18300, 19100, 19800, 20700, 21400] },
        { filter: "Base", cells: ["$GREEN10X", "Base", "Clanker", "$853,400", "$4.6M", "$18.7M"], progress: 100, airdropUsd: [72100, 74800, 77900, 80600, 83200, 86100, 89400, 92700, 96400, 100200] },
      ],
    },
    leaderboardMetric: "ATH airdrop",
    explanation: [
      { title: "Survival of the fittest", body: "10X analyses recent onchain volume, momentum and attention across chains, launchpads and social. The market surfaces trending memecoins with potential. The 10X community chooses a meme to launch an Attention Token for — or chooses to skip the day, and let our previous launch run for longer. We're not bound to one chain or one launchpad, we launch where the market is hottest (Solana, Base, Robinhood, BSC, etc) attracting capital & attention from everywhere." },
      { title: "A fourth graduation", body: "Launchpad tokens usually graduate through 3 phases: New → Almost Bonded → Migrated. Only ~1% \"make it\" from tens of thousands of new memecoins launched daily. Often those that migrate still die out too quickly. Attention Tokens can be thought of as a 4th level of graduation. Designed to amplify a meme with incentivised focused attention, rather than seeing it bleed out to hundreds of competing vamps." },
      { title: "Launch liquidity & community airdrops", body: "10X seeds every launch with an initial bonding-curve or AMM purchase. The amount is determined by community vote and available treasury. The acquired tokens are distributed to eligible community members over the following 10 days, with eligibility and boosts influenced by participation, holding 10X assets, supporting previous launches and useful bag work." },
      { title: "Known risk — not no risk", body: "Scheduled launches, community scrutiny and clearer rules aim to reduce unknowns around bundles, snipers and anonymous scam deployers. Stop spending 12-16 hours a day in the PVP memecoin trenches. Instead, join a single daily PVE community-driven fair launch. Attention Tokens remain highly speculative, highly volitile, and can still lose all value... but this game gives you a fighting chance.", callout: "With 10X you can be EARLY to every launch!" },
    ],
  },
  nfts: {
    id: "nfts",
    title: "NFTs",
    eyebrow: "10X Seasons",
    statsTitle: "Season Stats",
    summary: "Mint, reveal, upgrade and rally your token tribe across a new NFT season every month... Level up your perks!",
    globalMetrics: [
      { label: "Seasons", value: "12" },
      { label: "NFTs Minted", value: "120,000" },
      { label: "Upgrades Completed", value: "38,420" },
      { label: "Whitelist Savings", value: "$1.08M" },
      { label: "Combined ATH Floor", value: "$1.52M", detail: "Illustrative peak-floor value, not realized profit." },
      { label: "Perk Months", value: "314,500" },
    ],
    averageTitle: "Average Member",
    averageMetrics: [
      { label: "Season Mints", value: "12" },
      { label: "Upgrades", value: "5" },
      { label: "Mint Spend", value: "$12" },
      { label: "Whitelist Savings", value: "$108" },
      { label: "Combined ATH Floor", value: "$152" },
      { label: "Perk Months", value: "32" },
    ],
    explorer: {
      title: "Season Explorer",
      description: "Select a season to compare mint price, peak floor and community activity.",
      filters: ["S12", "S11", "S10", "S9", "S8", "S7", "S6", "S5", "S4", "S3", "S2", "S1"],
      columns: ["Season", "Mint", "Peak", "Multiple", "Owners (Unique)", "Total Volume", "Upgrades", "Leading Tribe", "$1B NFT"],
      rows: Array.from({ length: 12 }, (_, index) => {
        const season = 12 - index;
        const peak = 8.4 + season * 3.32;
        const seasonTokens: Record<number, string> = {
          1: "BTC",
          2: "ETH",
          3: "UNI",
          4: "SOL",
          5: "10X",
          6: "BTC",
          7: "10X",
          8: "10X",
          9: "ETH",
          10: "SOL",
          11: "SOL",
          12: "ANSEM",
        };
        const leadingToken = seasonTokens[season];
        const ownerCount = 2_645 + season * 40;
        const ownerPercentage = Math.round((ownerCount / 10_000) * 100);
        const totalVolume = 61_452 + season * 5_167;
        return {
          filter: `S${season}`,
          cells: [
            `Season ${season}`,
            "$1.00",
            `$${peak.toFixed(2)}`,
            `${peak.toFixed(1)}X`,
            `${ownerCount.toLocaleString("en-US")} (${ownerPercentage}%)`,
            `$${totalVolume.toLocaleString("en-US")}`,
            (2180 + season * 171).toLocaleString("en-US"),
            `$${leadingToken}`,
            `$${(18 + season * 2.4).toFixed(1)}K`,
          ],
          imageSrc: `/perks/s${season}_${leadingToken.toLowerCase()}.jpg`,
        };
      }),
    },
    leaderboardMetric: "Combined ATH Floor",
    explanation: [
      { title: "A new Season every month", body: "Each 10X Season contains 10,000 NFTs on Ethereum, dropped via OpenSea, for maximum volume & attention. 10X Warplet holders get whitelist entry at the best price. Season NFTs have only one trait (\"Level\"), and it follows the same exponential 1X–10X rarity pattern as 10X Warplets. 10X = 10 NFTs, 9X = 20, 8X = 40, ... 1X = 4,890! Higher levels boost your perks." },
      { title: "Upgrade and re-roll", body: "Combine two NFTs at the same Level to upgrade your NFT. One is guaranteed to rise by one Level while the other re-rolls across the full rarity distribution, creating a small chance of a much rarer result. Example: Combine two Level 3X NFTs, it upgrades one to Level 4X and the other re-rolls and could result in a Level 1X... or 2X... or 6X... or 10X! (if you're lucky)" },
      { title: "Benefits that compound", body: "An NFT's Level remains active for the same number of months: 10X for ten months through 1X for one month. Active Levels can improve launch whitelists, airdrop boosts, AI compute, attention and network access. NFTs are upgrade material, tribe territory, and benefit boosters — gamifying utility and status." },
      { title: "Owner-directed attention", body: "Owners claim their NFT in our mini app and choose a token tribe to support. This sets their NFT name, description, image and URL to drive attention to a crypto project. Tribes battle to control more NFTs and higher levels. Matching choices combine into larger logo realestate on a final 10,000 × 10,000 pixel Season canvas that becomes the $1B NFT." },
      { title: "The $1B NFT", body: "The completed Season canvas is Dutch-auctioned as a sponsorship asset, starting at $1B and rapidly dropping over 30 days. Its owner receives twelve months of promotion across the future 10X network. Proceeds from the sale fuel more 10X ecosystem growth and perks.", callout: "Every month, crypto's hottest tokens are minted into history." },
    ],
  },
  ai: {
    id: "ai",
    title: "AI",
    eyebrow: "AI for Builders",
    statsTitle: "Builder Stats",
    summary: "Turning ecosystem revenue into practical AI compute, tools and longer runway for people who ship... Accelerate!",
    globalMetrics: [
      { label: "Sponsored AI", value: "$420K" },
      { label: "Credits Consumed", value: "$397K" },
      { label: "Builders Supported", value: "1,842" },
      { label: "Projects Shipped", value: "286" },
      { label: "Tools Available", value: "16" },
      { label: "Credit Utilization", value: "94.5%" },
    ],
    averageTitle: "Average Member",
    averageMetrics: [
      { label: "Sponsored AI", value: "$228" },
      { label: "Credits Used", value: "$197" },
      { label: "Credits Remaining", value: "$31" },
      { label: "Model Tokens", value: "22.4M" },
      { label: "Image / Video Jobs", value: "31" },
      { label: "Projects Shipped", value: "1" },
    ],
    explorer: {
      title: "Compute Explorer",
      description: "AI allocation and output across the tools community members use.",
      filters: ["All", "Coding", "Image", "Video", "Private"],
      columns: ["Category", "Sponsored", "Used", "Members", "Tools", "Output"],
      rows: [
        { filter: "Coding", cells: ["Coding", "$180K", "96%", "812", "4", "114 apps"], tools: ["Codex", "Claude Code", "Cursor", "GitHub Copilot"] },
        { filter: "Image", cells: ["Image", "$90K", "94%", "744", "4", "48K images"], tools: ["Midjourney", "Adobe Firefly", "Ideogram", "Leonardo.Ai"] },
        { filter: "Video", cells: ["Video", "$75K", "89%", "318", "4", "6,420 clips"], tools: ["Runway", "Kling AI", "Google Veo", "OpenAI Sora"] },
        { filter: "Private", cells: ["Private", "$75K", "98%", "410", "4", "9.1B tokens"], tools: ["Venice.ai", "Proton Lumo", "Duck.ai", "Ollama"] },
      ],
    },
    leaderboardMetric: "sponsored AI",
    explanation: [
      { title: "Runway instead of one-off grants", body: "10X can sponsor practical AI access for builders and creators, reducing recurring costs and helping community projects move faster for longer. AI is the most impactful leverage we can provide to 10X your progress!" },
      { title: "Shared access with fair limits", body: "Organization plans, partner packages and onchain inference credits would use per-member allowances so support reaches more people while scaling with ecosystem revenue." },
      { title: "Tools for every kind of creator", body: "Potential categories include coding, research, image and video production, plus privacy-focused inference. Provider examples are exploratory; no partnership is implied." },
      { title: "Celebrate shipping", body: "Project showcases connect sponsored compute to shipped tools, content and experiments around 10X and the wider Farcaster ecosystem. We're creating an army of bag workers and builders, amplified by AI!", callout: "Intelligence is the ultimate engine of progress." },
    ],
  },
  attention: {
    id: "attention",
    title: "Attention",
    eyebrow: "#1 Feed for Crypto",
    statsTitle: "Distribution Stats",
    summary: "One focused daily feed where posts receive a real chance to be seen and go viral... Join the content cabal!",
    globalMetrics: [
      { label: "Impressions", value: "94.2M" },
      { label: "Engagements", value: "6.8M" },
      { label: "Posts Promoted", value: "24,800" },
      { label: "Verified Actions", value: "3.1M" },
      { label: "Engagement Rate", value: "7.2%" },
      { label: "Airdrops Unlocked", value: "$3.64M" },
    ],
    averageTitle: "Average Member",
    averageMetrics: [
      { label: "Posts", value: "3" },
      { label: "Impressions", value: "9,420" },
      { label: "Engagement", value: "680" },
      { label: "Engagement Rate", value: "7.2%" },
      { label: "Feed Rank", value: "#500" },
      { label: "Daily Airdrop", value: "$3.64" },
    ],
    explorer: {
      title: "Attention Explorer",
      description: "Focused-feed activity and progressive unlocks.",
      filters: ["7D", "30D", "All"],
      columns: ["Range", "Impressions", "Engagements", "Posts", "Actions", "Unlock"],
      rows: [
        { filter: "7D", cells: ["7 Days", "2.8M", "246K", "1,920", "118K", "82%"], progress: 82 },
        { filter: "30D", cells: ["30 Days", "14.6M", "1.1M", "7,430", "510K", "79%"], progress: 79 },
        { filter: "All", cells: ["All Time", "94.2M", "6.8M", "24,800", "3.1M", "78%"], progress: 78 },
      ],
    },
    leaderboardMetric: "impressions",
    explanation: [
      { title: "One daily post. One focused feed.", body: "Community members can publish one thing per day into a Farcaster-powered feed designed to concentrate discovery rather than scatter it across thousands of timelines. Driving DAUs onto Farcaster, a builder-first, crypto-native social platform — where CT really belongs." },
      { title: "Earn attention through contribution", body: "Holdings and Levels can boost ranking, while useful bag work—likes, comments, quotes, shares and original creation—helps strong community members travel further. We win by working together." },
      { title: "Scroll to unlock", body: "The daily Attention Token airdrop unlocks progressively while members explore the feed. Meaningful interactions can accelerate progress without turning the experience into a passive faucet... Scroll-to-Earn, and engage to earn faster!" },
      { title: "Distribution beyond the feed", body: "We're building \"one feed to rule them all\"! The homepage for crypto, where news breaks, alpha drops and new KOLs are minted. Content starts in the 10X feed and spreads virally out to larger platforms. Popular community posts receive broader promotion through future newsletters and the 10X network.", callout: "D.R.E.A.M: Distribution rules everything around me... attention is king." },
    ],
  },
  access: {
    id: "access",
    title: "Access",
    eyebrow: "The 10X Network",
    statsTitle: "Network Stats",
    summary: "Builders, traders, collectors and capital sharing signals across chains instead of staying in silos.",
    globalMetrics: [
      { label: "Members", value: "10,000" },
      { label: "Chains Represented", value: "7" },
      { label: "Memecoins Reviewed", value: "1,460" },
      { label: "Community Votes", value: "682K" },
      { label: "Signals Promoted", value: "410" },
      { label: "Median Move After Flag", value: "+38%", detail: "Illustrative mock performance, not a forecast." },
    ],
    averageTitle: "Average Member",
    averageMetrics: [
      { label: "Votes Cast", value: "68" },
      { label: "Memecoins Reviewed", value: "146" },
      { label: "Signals Backed", value: "14" },
      { label: "Chains Explored", value: "3" },
    ],
    explorer: {
      title: "Memecoin Explorer",
      description: "Cross-chain intelligence, community decisions and subsequent memecoin market movement.",
      filters: ["All", "Ethereum", "Base", "Solana", "BNB", "Robinhood", "Other"],
      columns: ["Memecoin", "Chain", "Momentum", "Vote", "Decision", "Move"],
      rows: [
        { filter: "Base", cells: ["Green Runner", "Base", "96", "84%", "Launch", "+182%"], progress: 96 },
        { filter: "Solana", cells: ["Deep Signal", "Solana", "91", "71%", "Watch", "+64%"], progress: 91 },
        { filter: "BNB", cells: ["Four Alpha", "BNB", "88", "77%", "Launch", "+118%"], progress: 88 },
        { filter: "Ethereum", cells: ["Mainframe", "Ethereum", "83", "65%", "Skip", "-12%"], progress: 83 },
        { filter: "Robinhood", cells: ["Open Bell", "Robinhood", "79", "69%", "Watch", "+42%"], progress: 79 },
        { filter: "Other", cells: ["Hyper Wave", "Hyperliquid", "86", "73%", "Launch", "+97%"], progress: 86 },
      ],
    },
    leaderboardMetric: "contribution score",
    explanation: [
      { title: "Cross-chain common ground", body: "The 10X Network brings Ethereum, Base, Solana, BNB, Robinhood and emerging ecosystems into one Farcaster-native community." },
      { title: "See the memecoins early", body: "Members can review the daily market-analysis shortlist and influence whether 10X launches, skips, changes chain or chooses a different launchpad." },
      { title: "Access that can renew", body: "Warplets provide the founding network while future Season NFTs offer new entry points. Active Levels can shape voting influence and unlock smaller specialist or VIP areas." },
      { title: "Builders meet traders and capital", body: "The network is designed to connect people who create, distribute, collect, trade and fund ideas—online first, with future cultural and IRL experiences as the treasury grows." },
    ],
  },
};
