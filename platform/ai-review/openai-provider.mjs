import {dimensions,reviewFlags,RUBRIC_VERSION} from './rubric.mjs';
const object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const string={type:'string'};
export const evaluationSchema=object({
 rubricVersion:{type:'string',enum:[RUBRIC_VERSION]},
 criteria:{type:'array',items:object({id:{type:'string',enum:dimensions.map(d=>d.id)},score:{type:'integer',minimum:0,maximum:5},rationale:string,improvement:string,evidence:{type:'array',items:object({start:{type:'integer',minimum:0},end:{type:'integer',minimum:1},quote:string})}})},
 summary:string,confidence:{type:'string',enum:['low','medium','high']},flags:{type:'array',items:{type:'string',enum:[...reviewFlags]}},verification:{type:'string',enum:['provided-material-only']},
});
async function boundedJson(response,maxBytes){
 if(Number(response.headers.get('content-length'))>maxBytes){await response.body?.cancel();throw Error('Review response exceeded the byte limit.');}
 if(!response.body)throw Error('Review provider returned no response body.');
 const reader=response.body.getReader(),chunks=[];let length=0;
 try{while(true){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>maxBytes){await reader.cancel();throw Error('Review response exceeded the byte limit.');}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength;}
 try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw Error('Review provider did not return valid JSON.');}
}
/** The sole network adapter. Disabled unless explicitly opted in. No retries or tools. */
export function createOpenAIProvider({apiKey,model,allowPaidProvider=false,maxOutputTokens=4096,timeoutMs=55000,fetchImpl=globalThis.fetch}={}){
 if(allowPaidProvider!==true)throw Error('OpenAI scoring requires explicit --allow-paid-provider consent.');
 if(typeof apiKey!=='string'||!apiKey.trim()||/[\r\n]/.test(apiKey))throw Error('Configure OPENAI_API_KEY privately in the process environment.');
 if(typeof model!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(model))throw Error('Specify an approved model ID; there is no default model.');
 if(!Number.isInteger(maxOutputTokens)||maxOutputTokens<512||maxOutputTokens>8192)throw Error('Output limit must be 512–8192 tokens.');
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw Error('Invalid provider timeout.');
 return Object.freeze({id:'openai-responses',model,version:'responses-v1-'+maxOutputTokens,kind:'model',provenance:'declared-local-adapter',responseFormat:'evaluation-with-evidence-v1',async evaluate({systemPrompt,untrustedData},{signal}){
  const body=JSON.stringify({model,instructions:systemPrompt,input:[{role:'user',content:[{type:'input_text',text:JSON.stringify({untrustedData})}]}],text:{format:{type:'json_schema',name:'tenx_content_review',strict:true,schema:evaluationSchema}},max_output_tokens:maxOutputTokens,store:false,tools:[],tool_choice:'none'});
  if(new TextEncoder().encode(body).byteLength>131072)throw Error('Review request exceeded the byte limit.');
  const abort=AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]);
  let response;
  try{response=await fetchImpl('https://api.openai.com/v1/responses',{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},body,signal:abort});}catch{throw Error('OpenAI review request failed or timed out; no score accepted.');}
  if(!response.ok){await response.body?.cancel();throw Error('OpenAI review request returned HTTP '+response.status+'; no score accepted.');}
  const value=await boundedJson(response,524288);
  if(value.status!=='completed'||value.error||value.incomplete_details)throw Error('Review model response was incomplete; no score accepted.');
  if(!Array.isArray(value.output)||value.output.some(i=>!['message','reasoning'].includes(i.type)))throw Error('Unexpected review output type.');
  const messages=value.output.filter(i=>i.type==='message');
  if(messages.length!==1||messages[0].role!=='assistant'||messages[0].status!=='completed'||!Array.isArray(messages[0].content))throw Error('Unexpected review message.');
  const blocks=messages[0].content;
  if(blocks.some(b=>b.type==='refusal'))throw Error('Review model refused this evaluation; send it for investigation.');
  if(blocks.length!==1||blocks[0].type!=='output_text'||typeof blocks[0].text!=='string'||blocks[0].text.length>32768)throw Error('Review output was missing, ambiguous or too large.');
  const usage=value.usage,requestId=response.headers.get('x-request-id');
  if(typeof value.id!=='string'||value.id.length>128||typeof value.model!=='string'||value.model.length>128||!usage||!['input_tokens','output_tokens','total_tokens'].every(k=>Number.isSafeInteger(usage[k])&&usage[k]>=0)||usage.total_tokens!==usage.input_tokens+usage.output_tokens)throw Error('Review provider provenance/usage is incomplete.');
  const providerEvidence={responseId:value.id,requestId:requestId?.slice(0,128)??null,resolvedModel:value.model,inputTokens:usage.input_tokens,outputTokens:usage.output_tokens,totalTokens:usage.total_tokens};
  let evaluation;try{evaluation=JSON.parse(blocks[0].text);}catch{throw Error('Review model output is not valid JSON.');}
  return {evaluation,providerEvidence};
 }});
}
