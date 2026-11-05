export class BodyInputError extends Error {
  constructor(status,code,message) {super(message);this.status=status;this.code=code;}
}
export async function boundedJson(request,limit=4096) {
  const length=request.headers.get('content-length');
  const tooLarge=()=>new BodyInputError(413,'body_too_large','JSON request exceeds its size limit.');
  if(length && Number(length)>limit)throw tooLarge();
  const reader=request.body?.getReader();
  if(!reader)throw new BodyInputError(400,'invalid_input','Expected a JSON body.');
  let total=0;const chunks=[];
  try {
    for(;;) {
      const {done,value}=await reader.read();if(done)break;total+=value.byteLength;
      if(total>limit){await reader.cancel();throw tooLarge();}
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  try {return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
  catch {throw new BodyInputError(400,'invalid_input','Expected valid UTF-8 JSON.');}
}
