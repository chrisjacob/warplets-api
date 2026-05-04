import { Text } from "@neynar/ui/typography";

export default function FindApp() {
  return (
    <div
      className="relative min-h-screen bg-black text-white flex flex-col items-center justify-center px-6"
      style={{ fontFamily: '"Roboto Mono", system-ui, sans-serif' }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(0,255,0,0.16),_rgba(0,0,0,0.92)_60%)]" aria-hidden="true" />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-[#00FF00]/40 bg-[#041204]/90 p-6 text-center">
        <Text className="text-3xl font-bold" style={{ color: "#00FF00" }}>
          10X Warplets Find
        </Text>
        <Text className="mt-4 text-sm" style={{ color: "#b7ffb7" }}>
          Coming soon. This app will help you discover rare Warplets faster.
        </Text>
      </div>
    </div>
  );
}
