import { FormEvent, useState } from "react";
import { getRuntimeAppIconPath } from "./brandAssets";

export default function TabsEntryPage() {
  const [query, setQuery] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const destination = new URL("/", window.location.origin);
    if (query.trim()) destination.searchParams.set("q", query.trim());
    destination.searchParams.set("source", "10x-tabs");
    window.location.assign(destination);
  };
  return (
    <main className="min-h-screen bg-black px-4 py-[max(2rem,env(safe-area-inset-top))] text-white">
      <section className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center">
        <img src={getRuntimeAppIconPath()} alt="10X" width="96" height="96" className="h-24 w-24" />
        <h1 className="mt-5 text-center text-3xl font-black text-[#00FF00]">10X Warplets</h1>
        <p className="mt-2 text-center text-sm text-[#8bbf8b]">Find any Warplet without loading marketplace data until you need it.</p>
        <form onSubmit={submit} className="mt-6 flex w-full gap-2">
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search token, trait, wallet or username…" className="min-w-0 flex-1 rounded-xl border border-[#00FF00] bg-[#001000] px-4 py-3 text-[#00FF00] outline-none" />
          <button type="submit" className="rounded-xl bg-[#00FF00] px-5 py-3 font-black text-[#003800]">Search</button>
        </form>
        <nav className="mt-5 flex flex-wrap justify-center gap-2 text-sm font-bold">
          <a href="/?random=1&source=10x-tabs" className="rounded-lg border border-[#00FF00]/50 px-3 py-2 text-[#00FF00]">Random</a>
          <a href="/listed?source=10x-tabs" className="rounded-lg border border-[#00FF00]/50 px-3 py-2 text-[#00FF00]">Listed</a>
          <a href="/offers?source=10x-tabs" className="rounded-lg border border-[#00FF00]/50 px-3 py-2 text-[#00FF00]">Offers</a>
          <a href="/stats?source=10x-tabs" className="rounded-lg border border-[#00FF00]/50 px-3 py-2 text-[#00FF00]">Stats</a>
        </nav>
      </section>
    </main>
  );
}
