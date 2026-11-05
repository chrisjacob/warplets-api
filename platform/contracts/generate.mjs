import {readFileSync,writeFileSync} from 'node:fs';
import {openapi} from '../server/api.mjs';

const spec=openapi(),media='application/vnd.10x.v1+json';
function type(schema) {
  if(!schema)return 'unknown';
  if(schema.$ref)return schema.$ref.split('/').at(-1);
  if(schema.const!==undefined)return JSON.stringify(schema.const);
  if(schema.enum)return schema.enum.map(JSON.stringify.bind(JSON)).join(' | ');
  if(schema.anyOf)return schema.anyOf.map(type).join(' | ');
  if(schema.allOf)return schema.allOf.map(type).join(' & ');
  if(schema.type==='array')return 'Array<'+type(schema.items)+'>';
  if(schema.type==='object'||schema.properties){
    if(!schema.properties)return 'Record<string, unknown>';
    return '{ '+Object.entries(schema.properties).map(([name,s])=>JSON.stringify(name)+(schema.required?.includes(name)?'':'?')+': '+type(s)).join('; ')+' }';
  }
  return ({integer:'number',number:'number',boolean:'boolean',string:'string',null:'null'})[schema.type]??'unknown';
}
let declarations='// Generated from the v1 OpenAPI contract. Run node contracts/generate.mjs to update.\n';
for(const [name,s] of Object.entries(spec.components.schemas))declarations+='export type '+name+' = '+type(s)+';\n';
declarations+='export interface PlatformClient {\n';
const operations=[];
for(const [path,item] of Object.entries(spec.paths)){
 for(const [method,op] of Object.entries(item)){
  if(!op.operationId)continue;
  const id=op.operationId,params=[...(item.parameters??[]),...(op.parameters??[])];
  const pathKeys=[...path.matchAll(/\{([^}]+)\}/g)].map(m=>m[1]);
  const opt=['headers?: HeadersInit','signal?: AbortSignal','idempotencyKey?: string'];
  if(pathKeys.length)opt.push('path: { '+pathKeys.map(s=>JSON.stringify(s)+': string').join('; ')+' }');
  const query=params.filter(p=>p.in==='query');
  if(query.length)opt.push('query?: { '+query.map(p=>JSON.stringify(p.name)+'?: '+type(p.schema)).join('; ')+' }');
  if(op.requestBody)opt.push('body'+(op.requestBody.required?'':'?')+': '+type(op.requestBody.content?.['application/json']?.schema));
  const response=Object.entries(op.responses).find(([status])=>status.startsWith('2'))?.[1];
  declarations+='  '+id+'(options'+(pathKeys.length||op.requestBody?.required?'':'?')+': { '+opt.join('; ')+' }): Promise<'+type(response?.content?.[media]?.schema)+'>;\n';
  operations.push({id,path,method:method.toUpperCase()});
 }
}
declarations+='}\nexport declare class PlatformApiError extends Error {status:number;code:string;retryable:boolean;requestId?:string}\nexport declare function createClient(options?:{baseUrl?:string;fetchImpl?:typeof fetch}):PlatformClient;\n';
const files={'client.d.mts':declarations,'operations.mjs':'// Generated from openapi.json.\nexport const operations = '+JSON.stringify(operations,null,2)+';\n','openapi.json':JSON.stringify(spec,null,2)+'\n'};
for(const [name,body] of Object.entries(files)){
 const dest=new URL(name,import.meta.url);
 if(process.argv.includes('--check')){if(readFileSync(dest,'utf8')!==body)throw Error('Regenerate '+name);}
 else writeFileSync(dest,body);
}
