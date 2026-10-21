// Server-only: do not import into client models. Workers already uses
// nodejs_compat. Call only after the caller enforces its stored-payload bounds.
import {createHash} from "node:crypto";

export function storedJsonHash(value:unknown):string {
  // Match hashJson's JSON.stringify + TextEncoder bytes exactly, including
  // undefined/function/symbol roots (TextEncoder encodes undefined as empty).
  return storedJsonTextHash(JSON.stringify(value)??"");
}

// Only already serialized, validated and byte-bounded JSON. This avoids a
// second serialization after checking a reconstructed page's expansion bound.
export function storedJsonTextHash(text:string):string {
  return createHash("sha256").update(text,"utf8").digest("hex");
}
