import {z} from "zod";
export async function contentApi(path:string,options:{token?:string;body?:unknown;signal?:AbortSignal}={}){
  const response=await fetch(`/api/10x/${path}`,{credentials:"same-origin",cache:"no-store",signal:options.signal,
    headers:{...(options.token?{authorization:`Bearer ${options.token}`}:{}) ,...(options.body===undefined?{}:{"content-type":"application/json","x-tenx-identity":"1"})},
    ...(options.body===undefined?{}:{method:"POST",body:JSON.stringify(options.body)})});
  const value:unknown=await response.json();if(!response.ok){const error=z.object({error:z.string()}).safeParse(value);throw new Error((error.success?error.data.error:`Request failed (${response.status})`).replaceAll("_"," "));}return value;
}
