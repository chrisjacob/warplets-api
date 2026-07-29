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
  explanation: Array<{ title: string; body: string }>;
};

export const PERKS_MOCK_DATA_VERSION = "perks-demo-v1";

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
      { label: "Community Buys", value: "$2.84M", detail: "Tokens purchased for community airdrops." },
      { label: "Airdrop Value Now", value: "$4.86M" },
      { label: "Airdrop Value at ATH", value: "$18.42M" },
      { label: "Combined Token ATH", value: "$312.6M" },
    ],
    averageTitle: "Average Member",
    averageMetrics: [
      { label: "Eligible Launches", value: "46" },
      { label: "Airdrop Value Now", value: "$486" },
      { label: "Airdrop Value at ATH", value: "$1,842" },
      { label: "Best Airdrop Multiple", value: "14.6X" },
    ],
    explorer: {
      title: "Launch Explorer",
      description: "Attention Tokens community distribution airdrops.",
      filters: ["All", "Base", "BNB", "Solana", "Robinhood"],
      columns: ["Token", "Chain", "Launchpad", "Airdropped", "MCAP", "ATH"],
      rows: [
        { filter: "Base", cells: ["$BULL10X", "Base", "Clanker", "$357,800", "$1.8M", "$8.4M"], progress: 80, airdropUsd: [31000, 32800, 33700, 34600, 35200, 36100, 37200, 38100, 39000, 40100] },
        { filter: "Solana", cells: ["$TRENCH10X", "Solana", "Pump", "$227,200", "$920K", "$6.1M"], progress: 60, airdropUsd: [18200, 19400, 20100, 21300, 22400, 23100, 24200, 25100, 26300, 27100] },
        { filter: "BNB", cells: ["$BYTE10X", "BNB", "Four", "$485,700", "$2.3M", "$11.2M"], progress: 40, airdropUsd: [42600, 43900, 45100, 46800, 47900, 49200, 50500, 51800, 53200, 54700] },
        { filter: "Robinhood", cells: ["$HOOD10X", "Robinhood", "Pons", "$179,300", "$740K", "$3.9M"], progress: 20, airdropUsd: [14400, 15200, 16100, 16800, 17500, 18300, 19100, 19800, 20700, 21400] },
        { filter: "Base", cells: ["$GREEN10X", "Base", "Clanker", "$853,400", "$4.6M", "$18.7M"], progress: 100, airdropUsd: [72100, 74800, 77900, 80600, 83200, 86100, 89400, 92700, 96400, 100200] },
      ],
    },
    leaderboardMetric: "ATH airdrop",
    explanation: [
      { title: "Survival of the fittest", body: "10X analyses recent onchain volume, momentum and attention across chains and launchpads. The market surfaces memecoins before the community chooses one launch—or chooses to skip the day." },
      { title: "A fourth graduation", body: "New tokens normally move through New, Almost Bonded and Migrated. A community-selected relaunch becomes an Attention Token: a 10X graduation designed to focus attention rather than create hundreds of competing vamps." },
      { title: "Community buys", body: "10X supplies initial liquidity and buys tokens for community airdrops. Distribution happens over ten days, with eligibility and boosts influenced by participation, holding 10X assets, supporting previous launches and useful bag work." },
      { title: "Known risk—not no risk", body: "Scheduled launches, community scrutiny and clearer rules aim to reduce unknowns around bundles, snipers and anonymous deployers. Attention Tokens remain highly speculative and can still lose all value." },
    ],
  },
  nfts: {
    id: "nfts",
    title: "NFTs",
    eyebrow: "10X Seasons",
    statsTitle: "Season Stats",
    summary: "Mint, reveal, upgrade and rally your token tribe across a new Ethereum season every month.",
    globalMetrics: [
      { label: "Seasons", value: "12" },
      { label: "NFTs Minted", value: "120,000" },
      { label: "Upgrades Completed", value: "38,420" },
      { label: "Whitelist Savings", value: "$1.08M" },
      { label: "Peak Floor Opportunity", value: "$1.52M", detail: "Illustrative peak-floor value, not realized profit." },
      { label: "Benefit Months Created", value: "314,500" },
    ],
    averageTitle: "Average Member",
    averageMetrics: [
      { label: "Mint Spend", value: "$12" },
      { label: "Whitelist Savings", value: "$108" },
      { label: "Peak Floor Opportunity", value: "$152" },
      { label: "Active Benefit Months", value: "31.5" },
    ],
    explorer: {
      title: "Season Explorer",
      description: "Select a mock season to compare mint price, peak floor and community activity.",
      filters: ["S12", "S11", "S10", "S9", "S8", "S7", "S6", "S5", "S4", "S3", "S2", "S1"],
      columns: ["Season", "Mint", "Peak", "Multiple", "Upgrades", "Leading Tribe", "$1B NFT"],
      rows: Array.from({ length: 12 }, (_, index) => {
        const season = 12 - index;
        const peak = 8.4 + season * 3.32;
        const tribes = ["$ETH", "$SOL", "$10X", "$BTC", "$HYPE", "$BASE"];
        return {
          filter: `S${season}`,
          cells: [`Season ${season}`, "$1.00", `$${peak.toFixed(2)}`, `${peak.toFixed(1)}X`, (2180 + season * 171).toLocaleString("en-US"), tribes[index % tribes.length], `$${(18 + season * 2.4).toFixed(1)}K`],
          progress: 48 + (season * 7) % 48,
        };
      }),
    },
    leaderboardMetric: "peak-floor opportunity",
    explanation: [
      { title: "A new Season every month", body: "Each Ethereum Season contains 10,000 NFTs. Level is the only protocol trait and is hidden at mint, following the same exponential 1X–10X rarity pattern as Warplets." },
      { title: "Upgrade and re-roll", body: "Combine two NFTs at the same Level and pay a small upgrade fee. One is guaranteed to rise by one Level while the other re-rolls across the full rarity distribution, creating a small chance of a much rarer result." },
      { title: "Owner-directed attention", body: "Owners set their NFT name, description, image and URL, then choose a token to support. Matching choices combine into larger areas on a final 10,000×10,000 Season canvas." },
      { title: "Benefits that renew", body: "A Level remains active for the same number of months: 10X for ten months through 1X for one month. Active Levels can improve launch access, airdrop boosts, AI support, attention and network access." },
      { title: "The $1B NFT", body: "The completed Season canvas is auctioned as a sponsorship asset. Its owner receives twelve months of promotion across the future 10X network." },
    ],
  },
  ai: {
    id: "ai",
    title: "AI",
    eyebrow: "AI for Builders",
    statsTitle: "Builder Stats",
    summary: "Turn ecosystem revenue into practical AI compute, tools and longer runway for people who ship.",
    globalMetrics: [
      { label: "Sponsored AI", value: "$420K" },
      { label: "Credits Consumed", value: "$397K" },
      { label: "Builders Supported", value: "1,842" },
      { label: "Projects Shipped", value: "286" },
      { label: "Tools Available", value: "17" },
      { label: "Credit Utilization", value: "94.5%" },
    ],
    averageTitle: "Average Active Builder",
    averageMetrics: [
      { label: "Sponsored Value", value: "$228" },
      { label: "Model Tokens", value: "22.4M" },
      { label: "Image / Video Jobs", value: "31" },
      { label: "Projects Shipped", value: "0.16" },
    ],
    explorer: {
      title: "Compute Explorer",
      description: "Mock allocation and output across the tools community members use.",
      filters: ["All", "Coding", "Research", "Image", "Video", "Private"],
      columns: ["Category", "Sponsored", "Used", "Members", "Output"],
      rows: [
        { filter: "Coding", cells: ["Coding", "$148K", "96%", "812", "114 apps"] , progress: 96 },
        { filter: "Research", cells: ["Research", "$82K", "91%", "623", "3,840 reports"], progress: 91 },
        { filter: "Image", cells: ["Image", "$74K", "94%", "744", "48K images"], progress: 94 },
        { filter: "Video", cells: ["Video", "$61K", "89%", "318", "6,420 clips"], progress: 89 },
        { filter: "Private", cells: ["Private", "$55K", "98%", "410", "9.1B tokens"], progress: 98 },
      ],
    },
    leaderboardMetric: "sponsored compute",
    explanation: [
      { title: "Runway instead of one-off grants", body: "10X can sponsor practical AI access for builders and creators, reducing recurring costs and helping community projects move faster for longer." },
      { title: "Shared access with fair limits", body: "Future organization plans, partner packages and onchain inference credits would use per-member allowances so support reaches more people while scaling with ecosystem revenue." },
      { title: "Tools for every kind of creator", body: "Potential categories include coding, research, image and video production, plus privacy-focused inference. Provider examples are exploratory; no partnership is implied." },
      { title: "Celebrate useful output", body: "Project showcases connect sponsored compute to shipped tools, content and experiments around 10X and the wider Farcaster ecosystem." },
    ],
  },
  attention: {
    id: "attention",
    title: "Attention",
    eyebrow: "#1 Feed for Crypto",
    statsTitle: "Distribution Stats",
    summary: "One focused daily feed where useful posts receive a real opportunity to be seen and acted on.",
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
      { label: "Impressions", value: "9,420" },
      { label: "Engagements", value: "680" },
      { label: "Posts", value: "2.5" },
      { label: "Daily Unlock", value: "78%" },
    ],
    explorer: {
      title: "Attention Explorer",
      description: "Mock focused-feed activity and progressive daily unlocks.",
      filters: ["7D", "30D", "All"],
      columns: ["Range", "Impressions", "Engagements", "Posts", "Actions", "Unlock"],
      rows: [
        { filter: "7D", cells: ["7 Days", "2.8M", "246K", "1,920", "118K", "82%"], progress: 82 },
        { filter: "30D", cells: ["30 Days", "14.6M", "1.1M", "7,430", "510K", "79%"], progress: 79 },
        { filter: "All", cells: ["All Time", "94.2M", "6.8M", "24,800", "3.1M", "78%"], progress: 78 },
      ],
    },
    leaderboardMetric: "earned impressions",
    explanation: [
      { title: "One post. One focused feed.", body: "Community members can publish one thing per day into a Farcaster-powered feed designed to concentrate discovery rather than scatter it across thousands of timelines." },
      { title: "Earn attention through contribution", body: "Holdings and Levels can boost ranking, while useful bag work—likes, comments, quotes, shares and original creation—helps strong posts travel further." },
      { title: "Scroll to unlock", body: "The daily Attention Token allocation unlocks progressively while members explore the feed. Meaningful interactions can accelerate progress without turning the experience into a passive faucet." },
      { title: "Distribution beyond the feed", body: "Popular community posts can receive broader promotion through future newsletters and the 10X network, while sponsors receive clearly identified placement." },
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
      description: "Mock cross-chain intelligence, community decisions and subsequent market movement.",
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
