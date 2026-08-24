import { handleTraitOfferSubmit, type CollectionOffersEnv } from "../../_lib/collectionOffers.js";

export const onRequestPost: PagesFunction<CollectionOffersEnv> = async (context) => handleTraitOfferSubmit(context);
