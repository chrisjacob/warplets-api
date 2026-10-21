// Server-only: do not import into client models. Workers already uses
// nodejs_compat. Call only after the caller enforces its stored-payload bounds.
import {createHash} from "node:crypto";

export function storedJsonHash(value:unknown):string {
  // Match hashJson's JSON.stringify + TextEncoder bytes exactly, including
  // undefined/function/symbol roots (TextEncoder encodes undefined as empty).
  return createHash("sha256").update(JSON.stringify(value)??"","utf8").digest("hex");
}
