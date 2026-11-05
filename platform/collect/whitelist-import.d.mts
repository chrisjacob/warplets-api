export function dryRunWhitelist(input:{source:string;entries:unknown[]}):{
 mode:'local-fixture';source:string;inputCount:number;acceptedCount:number;duplicateCount:number;errorCount:number;
 errors:Array<{index:number;reason:'noncanonical-solana-address'}>;wallets:string[];digest:string;publishable:boolean;
};
