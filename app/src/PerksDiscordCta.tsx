import { hapticTap } from "./haptics";

export default function PerksDiscordCta({ label }: { label: string }) {
  return (
    <section className="mt-5 rounded-xl border border-[#5865F2]/60 bg-[#111329] px-3 pb-6 pt-3">
      <h2 className="text-center text-xl font-black text-[#E0E3FF]">Discuss 10X {label}</h2>
      <a
        href="https://discord.gg/G5P5cV94Uz"
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => { void hapticTap(); }}
        className="mt-4 flex w-full cursor-pointer items-center justify-center gap-2 rounded-[20px] border border-[#3944b7] bg-[#5865F2] px-4 py-3 text-center text-sm font-black text-[#E0E3FF] shadow-[3px_6px_0_#3944b7] active:translate-y-0.5"
      >
        <img src="/menu/discord.png" alt="" aria-hidden="true" className="h-6 w-6 rounded-md object-cover" />
        <span>Join The 10X Network</span>
      </a>
    </section>
  );
}
