import { handleCollectionOffersGet, type CollectionOffersEnv } from "../_lib/collectionOffers.js";

export const onRequestGet: PagesFunction<CollectionOffersEnv> = async (context) => {
  return await handleCollectionOffersGet(context);
};
