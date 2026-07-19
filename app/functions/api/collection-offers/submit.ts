import { handleCollectionOfferSubmit, type CollectionOffersEnv } from "../../_lib/collectionOffers.js";

export const onRequestPost: PagesFunction<CollectionOffersEnv> = async (context) => {
  return await handleCollectionOfferSubmit(context);
};
