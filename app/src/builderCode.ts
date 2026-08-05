import { Attribution } from "ox/erc8021";

export type HexData = `0x${string}`;

export function builderCodeSuffix(code = import.meta.env.VITE_BASE_BUILDER_CODE): HexData | null {
  const normalized = typeof code === "string" ? code.trim() : "";
  if (!normalized) return null;
  return Attribution.toDataSuffix({ codes: [normalized] });
}

export function appendBuilderCode(data: string | null | undefined, code = import.meta.env.VITE_BASE_BUILDER_CODE): HexData {
  const normalizedData = typeof data === "string" && /^0x[0-9a-f]*$/i.test(data) ? data.toLowerCase() : "0x";
  const suffix = builderCodeSuffix(code);
  if (!suffix || normalizedData.endsWith(suffix.slice(2).toLowerCase())) return normalizedData as HexData;
  return `${normalizedData}${suffix.slice(2)}` as HexData;
}
