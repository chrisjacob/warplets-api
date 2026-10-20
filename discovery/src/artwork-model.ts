import { z } from "zod";
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const ArtworkSchema = z.object({ image_url: z.string().max(2048).nullable(), metadata_uri: z.string().max(2048).nullable(), creation_hash: Hash, metadata_hash: Hash.nullable(), fetched_at: z.string().datetime().nullable(), error: z.string().max(100).nullable() });
export const ArtworkResponseSchema = z.object({ data: z.record(z.string(), ArtworkSchema) });
export type Artwork = z.infer<typeof ArtworkSchema>;
