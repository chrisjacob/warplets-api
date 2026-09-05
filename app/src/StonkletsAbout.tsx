import PerksDiscordCta from "./PerksDiscordCta";

const sections = [
      { title: "Built for Risk. Grounded in Reality.", body: "Gen Z are entering markets after decades of compounding has already created enormous wealth for earlier generations. Stonklets are built for a new generation willing to take more risk in search of asymmetric upside ...while staying grounded in longer-term exposure to real-world value." },
      { title: "Meme Stonks, not Stocks", body: "A Stonklet is an independent memecoin associated with a major real-world asset. It does not represent, track or redeem for the stock. Specialist infrastructure handles tokenized asset exposure; 10X builds the character, incentives and attention market around it." },
      { title: "Tax: 3% in, 3% out", body: "Using the same 3/3 tax as MarsCoin, which was listed on Binance Alpha, and is now listed on Binance Spot. A proven path to mainstream adoption and CEX listing. Holding has no additional transaction tax and qualifying holders can earn RWA rewards. Selling contributes to the flywheel: paper hands feed diamond hands." },
      { title: "1% Holders. 1% Liquidity. 1% Growth", body: "Trading activity progressively strengthens the market. 34% of tax revenue funds tokenized-asset RWA rewards for qualifying holders. 33% builds permanent Stonklet/$RWA liquidity. 33% goes into community growth, including airdrops to 10X Warplets holders." },
      { title: "Your Turn to Be Early", body: "The underlying assets may already be worth billions or trillions. The Stonklet market starts at zero. A new attention economy, new liquidity and a new opportunity to participate from the beginning.", callout: "Reset the market. Be early. Win." },
];

export default function StonkletsAbout() {
  return <div className="pt-6">
    <header className="mb-5 text-center">
      <h1 className="text-3xl font-black text-[#00FF00]">About Stonklets</h1>
      <p className="mt-3 text-base font-bold text-[#b8d7b8]">Real-world assets, relaunched as meme stonks.</p>
    </header>
    <img src="/hero_stonklet.jpg" alt="Stonklets Bull and Bear" width={1200} height={630} className="mb-6 w-full rounded-xl" />
    <div className="overflow-hidden rounded-xl border border-[#00FF00]/25 bg-black/70">
      {sections.map((section, index) => <section key={section.title} className={`p-4 ${index < sections.length - 1 ? "border-b border-[#00FF00]/10" : ""}`}>
        <h2 className="text-base font-black text-[#00FF00]">{section.title}</h2>
        <p className="mt-2 text-sm leading-6 text-[#b8d7b8]">{section.body}</p>
      </section>)}
      <p className="px-4 pb-5 pt-2 text-center text-xl font-black text-[#00FF00]">Reset the market. Be early. Win.</p>
    </div>
    <PerksDiscordCta label="RWAs" />
    <aside className="stonklets-risk"><b>Know what you’re pairing.</b> bStocks provide tokenized economic exposure to real-world assets. Stonklets are separate meme tokens; their prices are not correlated with the referenced asset. Nothing here is investment advice.</aside>
  </div>;
}
