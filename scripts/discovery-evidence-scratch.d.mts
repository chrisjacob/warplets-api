import type {DatabaseSync} from "node:sqlite";
export type ScratchOptions={capacityDirectory:string;capacityPin:string;referenceDirectory:string;referencePin:string;sealedDirectory:string;keyFile:string};
export type ScratchStatistics={resolved_rows:number;resolution_attempts:number;raw_payload_bytes:number;ciphertext_bytes_read:number;plaintext_payloads_cached:number};
export type ScratchSession={
  sqlite:DatabaseSync;
  resolve(table:string,key:string):Promise<{payload_hash:string;address:string;observed_at:string;slot?:number;payload:string}>;
  describe(table:string,key:string):Readonly<{payload_hash:string;address:string;slot:number;observed_at:string;bytes:number}|{evidence_hash:string;address:string;observed_at:string;bytes:number}>;
  receiptIdentity(table:string,key:string):Readonly<{metadata:readonly (string|number)[];bytes:number;row_sha256:string}>|null;
  capacity:{source_archive_manifest_sha256:string;source_database_sha256:string;capacity_manifest_sha256:string;reference_manifest_sha256:string};
  statistics():ScratchStatistics;
};
export function withScratchEvidenceResolver<T>(options:ScratchOptions,work:(reader:ScratchSession)=>Promise<T>):Promise<{
  value:T;statistics:ScratchStatistics;complete_metadata_admitted:true;full_catalog_admitted:true;selected_payload_scope:true;
  all_payload_objects_verified:false;database_writes:0;provider_requests:0;runtime_activated:false;action_authority:false;
}>;
