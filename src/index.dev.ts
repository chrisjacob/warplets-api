import { createApp } from "./app";

process.env.SNAP_PUBLIC_BASE_URL = "https://api-dev.10x.meme";

export default createApp({ skipJFSVerification: true });
