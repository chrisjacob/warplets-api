import { Attribution } from "ox/erc8021";

export type HexData = `0x${string}`;

export function resolveBuilderCodeForHostname(
  hostname: string,
  appCode = import.meta.env.VITE_BASE_APP_BUILDER_CODE,
  warpletsCode = import.meta.env.VITE_BASE_BUILDER_CODE,
): string | undefined {
  const normalizedHostname = hostname.trim().toLowerCase();
  if (["stonklet.10x.meme", "stonklet-local.10x.meme"].includes(normalizedHostname)) {
    return "bc_aj4t6s6i";
  }
  if (["10x.meme", "www.10x.meme", "app.10x.meme"].includes(normalizedHostname)) {
    return appCode?.trim() || undefined;
  }
  return warpletsCode?.trim() || undefined;
}

function configuredBuilderCode(): string | undefined {
  const hostname = typeof window === "undefined" ? "" : window.location.hostname;
  return resolveBuilderCodeForHostname(hostname);
}

export function builderCodeSuffix(code = configuredBuilderCode()): HexData | null {
  const normalized = typeof code === "string" ? code.trim() : "";
  if (!normalized) return null;
  return Attribution.toDataSuffix({ codes: [normalized] });
}

export function appendBuilderCode(data: string | null | undefined, code = configuredBuilderCode()): HexData {
  const normalizedData = typeof data === "string" && /^0x[0-9a-f]*$/i.test(data) ? data.toLowerCase() : "0x";
  const suffix = builderCodeSuffix(code);
  if (!suffix || normalizedData.endsWith(suffix.slice(2).toLowerCase())) return normalizedData as HexData;
  return `${normalizedData}${suffix.slice(2)}` as HexData;
}
