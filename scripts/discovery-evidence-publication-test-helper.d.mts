import type {DatabaseSync} from "node:sqlite";
import type {ScratchOptions} from "./discovery-evidence-scratch.mjs";
type Row={payload_hash:string;address:string;slot?:number;payload:string;observed_at:string};
type Item={table:string;row:Row};
type Stage={directory:string;contextPin:string;keyFile:string};
export type PublicationFixture={root:string;target:string;db:DatabaseSync;copy:DatabaseSync;source:ScratchOptions;stage:Stage;options:{directory:string;targetPin:string;stage:Stage};grant:{generation:string;owner:string;epoch:number};baseHolder:Item;baseWallet:Item};
export function fixture(work:(f:PublicationFixture)=>Promise<void>,beforeArchive?:(f:Pick<PublicationFixture,"db"|"baseHolder"|"baseWallet">)=>Promise<void>):Promise<void>;
export function receipt(kind?:string,memo?:string):Item;
export function sha(bytes:string|Uint8Array):string;
