import { z } from "zod";

// Preserve legacy UUIDs and admit only the exact hourly pilot namespaces.
export const GmgnTraderSourceId=z.union([z.uuid(),z.string().regex(/^attention-traders-\d{10}$/)]);
export const GmgnSavedReceiptId=z.union([GmgnTraderSourceId,z.string().regex(/^attention-candles-\d{10}$/)]);
