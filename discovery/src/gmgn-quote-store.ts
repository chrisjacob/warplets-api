import{gmgnCorroboration}from"./gmgn-corroboration-store";
import{reviewGmgnQuote}from"./gmgn-quote";
export async function gmgnQuote(db:D1Database,id:string,now=new Date()){
  const comparison=await gmgnCorroboration(db,id,now);if(!comparison)return null;
  return{version:"gmgn-quote-replay-v1" as const,comparison,report:await reviewGmgnQuote(comparison)};
}
