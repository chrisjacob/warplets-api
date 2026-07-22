import { handleCollectionOfferCancelPrepare, type CollectionOffersEnv } from "../../_lib/collectionOffers.js";

export const onRequestPost: PagesFunction<CollectionOffersEnv> = async (context) => handleCollectionOfferCancelPrepare(context);
