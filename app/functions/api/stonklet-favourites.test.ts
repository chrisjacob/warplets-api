import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAppSession, type AppSession } from "../_lib/appAuth";
import { allowStonkletAction } from "../_lib/stonkletAbuse";
import { resolveSessionFavouriteWallet } from "./warplet-favourites";
import { onRequestPut } from "./stonklet-favourites";

vi.mock("../_lib/appAuth", () => ({ getAppSession: vi.fn() }));
vi.mock("../_lib/stonkletAbuse", () => ({ allowStonkletAction: vi.fn() }));
vi.mock("./warplet-favourites", () => ({ resolveSessionFavouriteWallet: vi.fn() }));

const wallet = "0x1111111111111111111111111111111111111111";
function session(fid: number | null): AppSession {
  return { sessionHash: "test", farcasterFid: fid, walletAddress: wallet,
    farcasterSignerUuid: null, createdAt: "", lastSeenAt: "", expiresAt: "", absoluteExpiresAt: "" };
}

async function changeFavourite(favourited = true, asset = "stonklet") {
  const statement = { bind: vi.fn().mockReturnThis(), run: vi.fn().mockResolvedValue({}), all: vi.fn().mockResolvedValue({ results: [] }) };
  const context = {
    request: new Request("https://stonklet.10x.meme/api/stonklet-favourites", {
      method: "PUT", headers: { origin: "https://stonklet.10x.meme", "content-type": "application/json" },
      body: JSON.stringify({ stonkletId: "nvidia", asset, favourited }),
    }),
    env: { WARPLETS: { prepare: vi.fn().mockReturnValue(statement) } },
  };
  const response = await onRequestPut(context as unknown as Parameters<typeof onRequestPut>[0]);
  return { response, statement };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(resolveSessionFavouriteWallet).mockResolvedValue(wallet);
  vi.mocked(allowStonkletAction).mockResolvedValue(false);
});

describe("favourite limit bypass", () => {
  it.each([1313340, 1129138])("allows adds and removals for verified FID %s despite an exhausted limit", async (fid) => {
    vi.mocked(getAppSession).mockResolvedValue(session(fid));
    for (const asset of ["stock", "stonklet"]) {
      for (const favourited of [true, false]) {
        const { response, statement } = await changeFavourite(favourited, asset);
        expect(response.status).toBe(200);
        expect(statement.run).toHaveBeenCalledOnce();
      }
    }
    expect(allowStonkletAction).not.toHaveBeenCalled();
  });

  it.each([1234, null])("keeps the limit for other FIDs and wallet-only sessions (%s)", async (fid) => {
    vi.mocked(getAppSession).mockResolvedValue(session(fid));
    const { response, statement } = await changeFavourite();
    expect(response.status).toBe(429);
    expect(allowStonkletAction).toHaveBeenCalledWith(expect.anything(), "votes", wallet, 5);
    expect(statement.run).not.toHaveBeenCalled();
  });

  it("still requires an authenticated favourite identity", async () => {
    vi.mocked(getAppSession).mockResolvedValue(null);
    vi.mocked(resolveSessionFavouriteWallet).mockResolvedValue(null);
    const { response, statement } = await changeFavourite();
    expect(response.status).toBe(401);
    expect(statement.run).not.toHaveBeenCalled();
  });
});
