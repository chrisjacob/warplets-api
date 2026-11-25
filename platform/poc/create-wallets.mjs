import {generateKeyPairSync,randomBytes} from 'node:crypto';
import {mkdirSync,writeFileSync,realpathSync} from 'node:fs';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function base58(bytes){
 let n=BigInt('0x'+(Buffer.from(bytes).toString('hex')||'0')),out='';
 while(n){out=alphabet[Number(n%58n)]+out;n/=58n;}
 let zero=0;while(zero<bytes.length&&bytes[zero]===0)zero++;
 return '1'.repeat(zero)+out;
}
export function protectBytes(bytes){
 if(process.platform!=='win32')throw Error('Windows DPAPI is required.');
 const shell=join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 // Secret bytes go through an anonymous child stdin pipe, never arguments, logs or disk.
 const command="$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $raw=[Convert]::FromBase64String([Console]::In.ReadToEnd()); try { $sealed=[Security.Cryptography.ProtectedData]::Protect($raw,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($sealed)) } finally { [Array]::Clear($raw,0,$raw.Length) }";
 const result=spawnSync(shell,['-NoProfile','-NonInteractive','-Command',command],{input:bytes.toString('base64'),encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:65536});
 if(result.status!==0||result.error)throw Error('DPAPI protection failed; no plaintext fallback.');
 const encoded=result.stdout.trim();
 if(!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw Error('Invalid DPAPI response.');
 return Buffer.from(encoded,'base64');
}
export function createWallets(){
 if(process.platform!=='win32'||!process.env.LOCALAPPDATA)throw Error('Windows local profile required.');
 const repo=realpathSync(fileURLToPath(new URL('../../',import.meta.url)));
 const base=realpathSync(process.env.LOCALAPPDATA),rel=relative(repo,base);
 if(rel===''||(!rel.startsWith('..'+(process.platform==='win32'?'\\':'/'))&&!isAbsolute(rel)))throw Error('Wallet storage cannot be inside the repository.');
 const runId='qa-'+new Date().toISOString().slice(0,10)+'-'+randomBytes(5).toString('hex');
 const directory=join(base,'SolanaPocKeys',runId);
 mkdirSync(directory,{recursive:true});
 const wallets=[];
 for(const role of ['payer','treasury','alice','bob','negative']){
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const jwk=privateKey.export({format:'jwk'});
  const seed=Buffer.from(jwk.d,'base64url'),pub=Buffer.from(publicKey.export({format:'jwk'}).x,'base64url');
  if(seed.length!==32||pub.length!==32)throw Error('Unexpected Ed25519 key size.');
  const secret=Buffer.concat([seed,pub]);
  try{writeFileSync(join(directory,role+'.dpapi'),protectBytes(secret),{flag:'wx',mode:0o600});}
  finally{secret.fill(0);seed.fill(0);}
  wallets.push({role,address:base58(pub),encryptedKeyFile:role+'.dpapi'});
 }
 const manifest={schemaVersion:1,runId,createdAt:new Date().toISOString(),network:'solana-mainnet-beta',fundingRequested:false,financialSigningEnabled:false,keyProtection:'Windows DPAPI CurrentUser; Solana 64-byte seed+public-key layout',wallets};
 const manifestPath=join(directory,'wallets.public.json');
 writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
 return {manifestPath,...manifest};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 if(process.argv.length!==3||process.argv[2]!=='--create')throw Error('Use --create. No key export, decryption, signing or network operation is supported.');
 console.log(JSON.stringify(createWallets(),null,2));
}
