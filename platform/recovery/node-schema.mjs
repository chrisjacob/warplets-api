import {readFile,readdir} from 'node:fs/promises';
import {schemaDescriptor} from './inventory.mjs';
export async function readInstalledRecoverySchema(crypto){
 const directory=new URL('../storage/',import.meta.url),files=(await readdir(directory)).filter(n=>/^\d{3}-[\w-]+\.sql$/.test(n)).sort();
 const migrations=await Promise.all(files.map(async file=>({file,digest:await crypto.sha256(new Uint8Array(await readFile(new URL(file,directory))))})));
 return schemaDescriptor(migrations,crypto);
}
