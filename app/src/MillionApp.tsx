import { Text } from "@neynar/ui/typography";

export default function MillionApp() {
  return (
    <div
      className="relative min-h-screen bg-black text-white flex flex-col items-center justify-center px-6"
      style={{ fontFamily: '"Roboto Mono", system-ui, sans-serif' }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,215,0,0.18),_rgba(0,0,0,0.93)_60%)]" aria-hidden="true" />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-yellow-300/40 bg-[#121004]/90 p-6 text-center">
        <Text className="text-3xl font-bold text-yellow-300">$1M Warplet</Text>
        <Text className="mt-4 text-sm text-yellow-100/90">
          Coming soon. A dedicated experience for the $1M Warplet campaign.
        </Text>
      </div>
    </div>
  );
}
