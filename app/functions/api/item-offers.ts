import { handleItemOffersGet, type CollectionOffersEnv } from "../_lib/collectionOffers.js";

export const onRequestGet: PagesFunction<CollectionOffersEnv> = async (context) => handleItemOffersGet(context);
