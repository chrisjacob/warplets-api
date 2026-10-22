// Browser transport bounds only; provider allowances and evidence contracts
// remain on the server. Eight MB accommodates the existing bounded queue.
export const DISCOVERY_RESPONSE_LIMITS={bytes:8_000_000,chunks:4096,nodes:100_000,depth:64,timeout_ms:20_000,operation_timeout_ms:60_000}as const;
export class DiscoveryResponseError extends Error{constructor(readonly status:number){super(`Discovery service unavailable (${status}).`);}}
export async function fetchDiscoveryJson(url:string,signal?:AbortSignal,init:Pick<RequestInit,"method"|"headers"|"body">={}):Promise<unknown>{
  if(signal?.aborted)throw new DOMException("Aborted","AbortError");
  const timeout=init.method?.toUpperCase()==="POST"?DISCOVERY_RESPONSE_LIMITS.operation_timeout_ms:DISCOVERY_RESPONSE_LIMITS.timeout_ms;
  const controller=new AbortController(),deadline=performance.now()+timeout;
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined,stopped:Error|null=null,rejectStop!:(error:Error)=>void;
  const interrupted=new Promise<never>((_,reject)=>{rejectStop=reject;});
  const cancel=()=>{if(reader)void reader.cancel().catch(()=>undefined);};
  const stop=(error:Error)=>{if(stopped)return;stopped=error;controller.abort();cancel();rejectStop(error);};
  const onAbort=()=>stop(new DOMException("Aborted","AbortError"));
  const timer=setTimeout(()=>stop(Error("Discovery response timed out.")),timeout);
  signal?.addEventListener("abort",onAbort,{once:true});
  const check=()=>{if(stopped)throw stopped;if(performance.now()>=deadline)throw Error("Discovery response timed out.");};
  const work=async()=>{
    const response=await fetch(url,{...init,signal:controller.signal,cache:"no-store"});
    if(stopped||!response.ok||!response.body){
      void response.body?.cancel().catch(()=>undefined);check();
      if(!response.ok)throw new DiscoveryResponseError(response.status);
      throw Error("Discovery response body is unavailable.");
    }
    reader=response.body.getReader();let complete=false;
    try{
      check();const advertised=response.headers.get("content-length");
      if(advertised!==null&&(!/^\d{1,10}$/.test(advertised)||Number(advertised)>DISCOVERY_RESPONSE_LIMITS.bytes))throw Error("Discovery response is too large.");
      let bytes=new Uint8Array(8192),length=0,chunks=0;
      while(true){
        const part=await reader.read();check();if(part.done)break;
        if(++chunks>DISCOVERY_RESPONSE_LIMITS.chunks)throw Error("Discovery response has too many fragments.");
        const next=length+part.value.byteLength;if(next>DISCOVERY_RESPONSE_LIMITS.bytes)throw Error("Discovery response is too large.");
        if(next>bytes.length){const grown=new Uint8Array(Math.min(DISCOVERY_RESPONSE_LIMITS.bytes,Math.max(next,bytes.length*2)));grown.set(bytes.subarray(0,length));bytes=grown;}
        bytes.set(part.value,length);length=next;
      }
      check();let value:unknown;
      try{value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes.subarray(0,length)));}
      catch{throw Error("Discovery response is not valid JSON.");}
      // Bound schema work too: a small JSON array can otherwise create millions
      // of validation errors. Do not allocate an array of all object values.
      let nodes=0;
      const inspect=(item:unknown,depth:number):void=>{
        if(++nodes>DISCOVERY_RESPONSE_LIMITS.nodes||depth>DISCOVERY_RESPONSE_LIMITS.depth)throw Error("Discovery response is too complex.");
        if(Array.isArray(item))for(const child of item)inspect(child,depth+1);
        else if(item!==null&&typeof item==="object")for(const key in item)if(Object.prototype.hasOwnProperty.call(item,key))inspect(Reflect.get(item,key),depth+1);
      };
      inspect(value,0);
      check();complete=true;return value;
    }finally{if(!complete)cancel();reader.releaseLock();reader=undefined;}
  };
  try{return await Promise.race([work(),interrupted]);}
  finally{clearTimeout(timer);signal?.removeEventListener("abort",onAbort);}
}
