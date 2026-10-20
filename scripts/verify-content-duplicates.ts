import {open} from "node:fs/promises";
import {DUPLICATE_MAX_BYTES} from "../discovery/src/content-duplicates-model";
import {verifyDuplicateReport} from "../discovery/src/content-duplicates-math";
try{
  const [file,expectedHash,...extra]=process.argv.slice(2);if(!file||extra.length)throw Error("usage: verify-content-duplicates.ts <file> [expected-sha256]");
  const handle=await open(file,"r");let text:string;
  try{
    if((await handle.stat()).size>DUPLICATE_MAX_BYTES)throw Error("oversize");
    const buffer=Buffer.alloc(DUPLICATE_MAX_BYTES+1);let offset=0;
    while(offset<buffer.length){const {bytesRead}=await handle.read(buffer,offset,buffer.length-offset,offset);if(!bytesRead)break;offset+=bytesRead;}
    if(offset>DUPLICATE_MAX_BYTES)throw Error("oversize");text=buffer.subarray(0,offset).toString("utf8");
  }finally{await handle.close();}
  const value=await verifyDuplicateReport(JSON.parse(text),expectedHash);
  console.log(JSON.stringify({verified:true,report_hash:value.report_hash,compared:value.coverage.compared,omitted:value.coverage.omitted,matching_candidates:value.result.matching_candidates,matches_shown:value.result.matches.length,external_content_complete:false,source_requests:0}));
}catch{console.error("Private excerpt comparison verification failed. Check the file, size, history, comparison and independently retained checksum.");process.exitCode=1;}
