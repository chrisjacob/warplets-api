import { STONKLETS_BY_ID } from "../../../shared/stonkletsCatalog";
import { validNewsId } from "../../../shared/stonkletsSpotlight";
import { readNews } from "../../_lib/stonkletNews";
import { jsonSecure } from "../../_lib/security";
export const onRequestGet:PagesFunction<{WARPLETS:D1Database}> = async ({request,env})=>{
 const params=new URL(request.url).searchParams,id=params.get("news"),raw=params.get("pairs"),pairs=raw?.split(",");
 if((id&&!validNewsId(id))||(id&&pairs)||(pairs&&(!pairs.length||pairs.length>20||pairs.some(pair=>!STONKLETS_BY_ID.has(pair)))))return jsonSecure({error:"invalid_news_query"},{status:400});
 try{return jsonSecure(await readNews(env.WARPLETS,{...(id?{id}:{}),...(pairs?{pairs:[...new Set(pairs)]}:{})}),{headers:{"cache-control":params.get("validate")==="1"?"private, no-store":"public, max-age=30, s-maxage=30"}});}
 catch{return jsonSecure({entries:[],news:null,status:"unavailable",lastEvaluatedAt:null},{status:503});}
};
