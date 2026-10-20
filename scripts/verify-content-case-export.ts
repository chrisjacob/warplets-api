import {open} from "node:fs/promises";
import {CONTENT_EXPORT_MAX_BYTES} from "../discovery/src/content-export-model";
import {verifyContentCaseExport} from "../discovery/src/content-export";

// Read-only and offline. Never prints private URLs, allegations or identities.
try{
  const [file,expectedHash,...extra]=process.argv.slice(2);
  if(!file||extra.length)throw Error("usage: verify-content-case-export.ts <file> [expected-sha256]");
  const handle=await open(file,"r");let text:string;
  try{
    if((await handle.stat()).size>CONTENT_EXPORT_MAX_BYTES)throw Error("content_case_export_size_exceeded");
    // Bound the read itself too, including a file that grows after stat().
    const buffer=Buffer.alloc(CONTENT_EXPORT_MAX_BYTES+1);let offset=0;
    while(offset<buffer.length){const {bytesRead}=await handle.read(buffer,offset,buffer.length-offset,offset);if(!bytesRead)break;offset+=bytesRead;}
    if(offset>CONTENT_EXPORT_MAX_BYTES)throw Error("content_case_export_size_exceeded");
    text=buffer.subarray(0,offset).toString("utf8");
  }finally{await handle.close();}
  const value=await verifyContentCaseExport(JSON.parse(text),expectedHash);
  console.log(JSON.stringify({verified:true,export_hash:value.export_hash,...value.manifest,visibility_held:value.visibility_held,authority:value.authority,source_requests:0}));
}catch{
  // Parser errors can include user input: keep diagnostics free of case data.
  console.error("Content case verification failed. Check the file, size, history and independently retained checksum.");process.exitCode=1;
}
