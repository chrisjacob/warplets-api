import {importPublicIdentities} from './public-identities.mjs';
const args=process.argv.slice(2),options={};
for(let n=0;n<args.length;n+=2){const key=args[n];if(!['--directory','--output'].includes(key)||!args[n+1]||options[key])throw Error('Use --directory EXISTING_QA --output NEW_QA_OVERLAY_DIRECTORY.');options[key]=args[n+1];}
if(!options['--directory']||!options['--output'])throw Error('Use --directory EXISTING_QA --output NEW_QA_OVERLAY_DIRECTORY. This explicitly fetches free public sources.');
const result=await importPublicIdentities({directory:options['--directory'],output:options['--output'],onProgress:value=>console.log(JSON.stringify(value))});
console.log(JSON.stringify({scope:result.scope,capturedAt:result.capturedAt,coverage:result.coverage,imageAttempts:result.imageAttempts,sourceReceipts:result.sources.length,failedSources:result.failures,financialExecution:false},null,2));
