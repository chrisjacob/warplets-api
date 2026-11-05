import {JOB_TYPES} from './model.mjs';
// Subsequent B tasks attach actual evidence/settlement/publication services.
// An absent handler is visible work held for a named dependency, never success.
export function createHandlerRegistry(implemented={}){
 for(const key of Object.keys(implemented))if(!JOB_TYPES.includes(key)||typeof implemented[key]!=='function')throw new TypeError('Unknown job handler.');
 return Object.freeze(Object.fromEntries(JOB_TYPES.map(type=>[type,implemented[type]??(async()=>({state:'held',reason:'handler-not-implemented',dependency:type,readyMs:null}))])));
}
