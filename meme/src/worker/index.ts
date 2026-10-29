import {preview} from '../shared/fixtures';
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff','x-robots-tag':'noindex, nofollow'}});
export async function handleRequest(request:Request):Promise<Response>{
 const path=new URL(request.url).pathname;
 if(!['GET','HEAD'].includes(request.method))return json({error:'Participation and financial actions are disabled in this local preview'},405);
 const response=path==='/health'?json({mode:'fixture',actionsEnabled:false}):path==='/api/meme/preview'?json(preview):json({error:'Not found'},404);
 return request.method==='HEAD'?new Response(null,response):response;
}
export default {async fetch(request:Request,env:Env):Promise<Response>{
 if(env.LOCAL_PREVIEW_ONLY!=='true')return json({error:'Local fixture preview is disabled'},404);
 return handleRequest(request);
}} satisfies ExportedHandler<Env>;
