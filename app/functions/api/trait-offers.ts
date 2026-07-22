import { handleTraitOffersGet, type CollectionOffersEnv } from "../_lib/collectionOffers.js";

export const onRequestGet: PagesFunction<CollectionOffersEnv> = async (context) => handleTraitOffersGet(context);
