import { useEffect } from "react";
import sdk from "@farcaster/miniapp-sdk";
import { Text } from "@neynar/ui/typography";

export default function App() {
  useEffect(() => {
    // Hide the splash screen once the app is ready
    sdk.actions.ready();
  }, []);

  return (
    <div className="flex items-center justify-center h-screen">
      <Text>Hello world</Text>
    </div>
  );
}
