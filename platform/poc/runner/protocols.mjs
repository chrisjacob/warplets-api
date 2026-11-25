import {Keypair, PublicKey, SystemProgram, TransactionInstruction} from '@solana/web3.js';
import * as spl from '@solana/spl-token';
import * as sdk from '@meteora-ag/cp-amm-sdk';
import BN from 'bn.js';
import {keccak_256} from '@noble/hashes/sha3';

export const SUPPLY = 1_000_000_000_000n;
export const CORE = new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');
export const REWARDS = new PublicKey('REWArDioXgQJ2fZKkfu9LCLjQfRwYWVVfsvcsR5hoXi');
const token = spl.TOKEN_PROGRAM_ID, system = SystemProgram.programId;
const memo = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const pk = value => new PublicKey(value);
const ata = (mint,owner) => spl.getAssociatedTokenAddressSync(pk(mint),pk(owner),true);
const r = pubkey => ({pubkey,isSigner:false,isWritable:false});
const w = pubkey => ({...r(pubkey),isWritable:true});
const s = (pubkey,writable=false) => ({...r(pubkey),isSigner:true,isWritable:writable});
const u64 = n => {const b=Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b;};
const u32 = n => {const b=Buffer.alloc(4); b.writeUInt32LE(n); return b;};
const str = v => Buffer.concat([u32(Buffer.byteLength(v)),Buffer.from(v)]);
const ix = (programId,keys,...data) => new TransactionInstruction({programId,keys,data:Buffer.concat(data)});
const pda = (program,prefix,...keys) => PublicKey.findProgramAddressSync([Buffer.from(prefix),...keys.map(k=>k.toBuffer())],program);

export async function buildAction({action, payer, recipient, artifacts, label, connection, chainTime}) {
  payer=pk(payer);
  const ixs=[],signers=[],expect=[],result={};
  let detail={};
  const createAta=(mint,owner) => spl.createAssociatedTokenAccountIdempotentInstruction(payer,ata(mint,owner),pk(owner),pk(mint));
  if(['original','attention'].includes(action)) {
    const mint=Keypair.generate(),address=mint.publicKey,destination=ata(address,payer);
    const rent=await connection.getMinimumBalanceForRentExemption(spl.MINT_SIZE,'confirmed');
    ixs.push(SystemProgram.createAccount({fromPubkey:payer,newAccountPubkey:address,lamports:rent,space:spl.MINT_SIZE,programId:token}),
      spl.createInitializeMint2Instruction(address,9,payer,null),createAta(address,payer),
      spl.createMintToInstruction(address,destination,payer,SUPPLY),spl.createSetAuthorityInstruction(address,payer,spl.AuthorityType.MintTokens,null));
    signers.push(mint);
    Object.assign(result,{mint:address.toBase58(),owner:payer.toBase58(),ata:destination.toBase58(),label,supply:String(SUPPLY)});
    expect.push({kind:'mint',address:result.mint,supply:String(SUPPLY)});
    detail={supply:String(SUPPLY),decimals:9,mintAuthority:null,freezeAuthority:null,name:label,metadata:'Memo only; no fungible metadata account'};
  } else if(action==='token-transfer') {
    const mint=pk(artifacts.original.mint),to=pk(recipient);
    ixs.push(createAta(mint,to),spl.createTransferCheckedInstruction(ata(mint,payer),mint,ata(mint,to),payer,1_000_000_000n,9));
    Object.assign(result,{mint:mint.toBase58(),recipient:to.toBase58(),amount:'1000000000'});
    expect.push({kind:'token-delta',address:ata(mint,to).toBase58(),minimum:'1000000000',maximum:'1000000000'});
    detail={...result};
  } else if(action==='pool') {
    const amm=new sdk.CpAmm(connection),positionNft=Keypair.generate();
    const a=pk(artifacts.attention.mint),b=pk(artifacts.original.mint);
    const low=sdk.getSqrtPriceFromPrice('0.000001',9,9),high=sdk.getSqrtPriceFromPrice('0.001',9,9);
    const amount=new BN((SUPPLY*80n/100n).toString());
    const delta=amm.preparePoolCreationSingleSide({tokenAAmount:amount,minSqrtPrice:low,maxSqrtPrice:high,initSqrtPrice:low,collectFeeMode:sdk.CollectFeeMode.OnlyB});
    const activation=chainTime+60;
    const baseFee=sdk.getFeeTimeSchedulerParams(9000,100,sdk.BaseFeeMode.FeeTimeSchedulerLinear,89,89);
    const plan=await amm.createCustomPool({creator:payer,payer,positionNft:positionNft.publicKey,tokenAMint:a,tokenBMint:b,
      tokenAAmount:amount,tokenBAmount:new BN(1),sqrtMinPrice:low,sqrtMaxPrice:high,initSqrtPrice:low,liquidityDelta:delta,
      poolFees:{baseFee,compoundingFeeBps:0,padding:0,dynamicFee:null},hasAlphaVault:false,activationType:sdk.ActivationType.Timestamp,
      collectFeeMode:sdk.CollectFeeMode.OnlyB,activationPoint:new BN(activation),tokenAProgram:token,tokenBProgram:token,isLockLiquidity:true});
    ixs.push(...plan.tx.instructions);signers.push(positionNft);
    Object.assign(result,{pool:plan.pool.toBase58(),position:plan.position.toBase58(),positionNft:positionNft.publicKey.toBase58(),activation,owner:payer.toBase58(),mintA:a.toBase58(),mintB:b.toBase58(),liquidityDelta:delta.toString()});
    expect.push({kind:'pool',...result});detail={...result,attUnits:amount.toString(),originalUnits:'1',permanentLock:true,feeBpsStart:9000,feeBpsEnd:100};
  } else if(['buy','sell','fees'].includes(action)) {
    const saved=artifacts.pool,amm=new sdk.CpAmm(connection),pool=pk(saved.pool),state=await amm.fetchPoolState(pool);
    if(chainTime<saved.activation+90)throw Error('Wait until activation + 90 seconds: '+new Date((saved.activation+90)*1000).toISOString());
    const common={pool,tokenAMint:pk(saved.mintA),tokenBMint:pk(saved.mintB),tokenAVault:state.tokenAVault,tokenBVault:state.tokenBVault,tokenAProgram:token,tokenBProgram:token};
    if(action==='fees') {
      const positionNftAccount=sdk.derivePositionNftAccount(pk(saved.positionNft));
      const tx=await amm.claimPositionFee({...common,owner:payer,position:pk(saved.position),positionNftAccount});
      ixs.push(...tx.instructions);detail={pool:saved.pool,position:saved.position};
    } else {
      const input=action==='buy'?common.tokenBMint:common.tokenAMint,output=action==='buy'?common.tokenAMint:common.tokenBMint;
      const quote=amm.getQuote({inAmount:new BN(1_000_000),inputTokenMint:input,slippage:1,poolState:state,currentTime:chainTime,currentSlot:await connection.getSlot('confirmed'),tokenADecimal:9,tokenBDecimal:9,hasReferral:false});
      if(quote.minSwapOutAmount.isZero())throw Error('Quote output rounds to zero; probe size is unsuitable for this pool state.');
      const tx=await amm.swap({...common,payer,inputTokenMint:input,outputTokenMint:output,amountIn:quote.swapInAmount,minimumAmountOut:quote.minSwapOutAmount,referralTokenAccount:null,poolState:state});
      ixs.push(...tx.instructions);detail={inputMint:input.toBase58(),outputMint:output.toBase58(),inputUnits:quote.swapInAmount.toString(),minimumOutputUnits:quote.minSwapOutAmount.toString(),quotedOutputUnits:quote.swapOutAmount.toString(),slippagePercent:1,quotedAt:chainTime};
      expect.push({kind:'token-delta',address:ata(output,payer).toBase58(),minimum:detail.minimumOutputUnits});
    }
    Object.assign(result,{pool:saved.pool,...detail});expect.push({kind:'pool',...saved});
  } else if(action==='allocation') {
    const mint=pk(artifacts.attention.mint),rent=await connection.getMinimumBalanceForRentExemption(spl.ACCOUNT_SIZE,'confirmed');
    const accounts={};
    for(const [role,percent] of [['earn',10],['stake',5],['permanent',2.5],['season',2.5]]) {
      const account=Keypair.generate(),units=SUPPLY*BigInt(percent*10)/1000n;
      ixs.push(SystemProgram.createAccount({fromPubkey:payer,newAccountPubkey:account.publicKey,lamports:rent,space:spl.ACCOUNT_SIZE,programId:token}),
        spl.createInitializeAccount3Instruction(account.publicKey,mint,payer),spl.createTransferCheckedInstruction(ata(mint,payer),mint,account.publicKey,payer,units,9));
      signers.push(account);accounts[role]={address:account.publicKey.toBase58(),units:String(units)};
      expect.push({kind:'token-account',address:account.publicKey.toBase58(),mint:mint.toBase58(),owner:payer.toBase58(),amount:String(units)});
    }
    Object.assign(result,{accounts,owner:payer.toBase58(),custody:'payer-owned test accounts only'});detail={...result};
  } else if(action==='distribution') {
    const mint=pk(artifacts.original.mint),seed=Keypair.generate(),[dist,bump]=pda(REWARDS,'merkle_distribution',mint,payer,seed.publicKey);
    const [event]=pda(REWARDS,'event_authority'),vault=ata(mint,dist),allocation=1_000_000_000n;
    const cliff=chainTime+60,end=chainTime+120,schedule=Buffer.concat([Buffer.from([1]),u64(cliff),u64(end)]);
    const root=Buffer.from(keccak_256(Buffer.concat([Buffer.from([0]),Buffer.from(keccak_256(Buffer.concat([payer.toBuffer(),u64(allocation),schedule])))])));
    ixs.push(ix(REWARDS,[s(payer,true),s(payer),s(seed.publicKey),w(dist),r(mint),w(vault),w(ata(mint,payer)),r(system),r(token),r(spl.ASSOCIATED_TOKEN_PROGRAM_ID),r(event),r(REWARDS)],
      Buffer.from([5,bump,0]),u64(allocation),root,u64(allocation),u64((1n<<63n)-1n)));
    signers.push(seed);Object.assign(result,{distribution:dist.toBase58(),mint:mint.toBase58(),vault:vault.toBase58(),owner:payer.toBase58(),allocation:String(allocation),cliff,end,root:root.toString('hex'),schedule:schedule.toString('hex'),proof:[],accelerated:true});
    expect.push({kind:'token-account',address:result.vault,mint:result.mint,owner:result.distribution,amount:String(allocation)});detail={...result};
  } else if(action==='claim') {
    const saved=artifacts.distribution,mint=pk(saved.mint),dist=pk(saved.distribution),[claim,bump]=pda(REWARDS,'merkle_claim',dist,payer),[marker]=pda(REWARDS,'revocation',dist,payer),[event]=pda(REWARDS,'event_authority');
    ixs.push(ix(REWARDS,[s(payer,true),s(payer),w(dist),w(claim),r(marker),r(mint),w(pk(saved.vault)),w(ata(mint,payer)),r(system),r(token),r(event),r(REWARDS)],Buffer.from([6,bump]),u64(saved.allocation),u64(0),Buffer.from(saved.schedule,'hex'),u32(0)));
    Object.assign(result,{distribution:saved.distribution,claim:claim.toBase58(),owner:payer.toBase58()});detail={...result,cliff:saved.cliff,end:saved.end,requested:'all currently vested'};
    expect.push({kind:'token-delta',address:ata(mint,payer).toBase58(),minimum:'1'});
  } else if(action==='nft') {
    const asset=Keypair.generate(),uri='http://127.0.0.1:4195/metadata/'+label+'.json';
    ixs.push(ix(CORE,[s(asset.publicKey,true),r(CORE),r(CORE),s(payer,true),r(payer),r(CORE),r(system),r(CORE)],Buffer.from([0,0]),str(label),str(uri),Buffer.from([0])));
    signers.push(asset);Object.assign(result,{asset:asset.publicKey.toBase58(),owner:payer.toBase58(),name:label,uri});
    expect.push({kind:'core',address:result.asset,owner:result.owner});detail={...result,rights:'No rewards or economic attributes; basic ownership probe only'};
  } else if(action==='nft-transfer') {
    const asset=pk(artifacts.nft.asset),to=pk(recipient);
    ixs.push(ix(CORE,[w(asset),r(CORE),s(payer,true),r(CORE),r(to),r(system),r(CORE)],Buffer.from([14,0])));
    Object.assign(result,{asset:asset.toBase58(),owner:to.toBase58()});expect.push({kind:'core',address:result.asset,owner:result.owner});detail={...result};
  } else throw Error('Unknown action');
  ixs.push(ix(memo,[],Buffer.from(label+' '+action+' disposable QA no value')));
  return {ixs,signers,expect,result,detail,label};
}

export async function verifyEffects(connection, expectations, receipt) {
  const observations=[];
  for(const e of expectations) {
    if(e.kind==='token-delta') {
      const index=receipt.transaction.message.accountKeys.indexOf(e.address);
      if(index<0)throw Error('Expected token account absent from receipt');
      const amount=items=>BigInt(items.find(b=>b.accountIndex===index)?.uiTokenAmount.amount??'0');
      const delta=amount(receipt.meta.postTokenBalances??[])-amount(receipt.meta.preTokenBalances??[]);
      if(delta<BigInt(e.minimum)||(e.maximum!==undefined&&delta>BigInt(e.maximum)))throw Error('Unexpected finalized token delta');
      observations.push({...e,observedDelta:String(delta)});
    } else if(e.kind==='pool') {
      const amm=new sdk.CpAmm(connection),pool=await amm.fetchPoolState(pk(e.pool)),position=await amm.fetchPositionState(pk(e.position));
      if(!pool.tokenAMint.equals(pk(e.mintA))||!pool.tokenBMint.equals(pk(e.mintB))||pool.activationPoint.toString()!==String(e.activation)||position.permanentLockedLiquidity.toString()!==e.liquidityDelta||!position.unlockedLiquidity.isZero()||!position.vestedLiquidity.isZero())throw Error('Pool identity/activation/permanent lock mismatch');
      observations.push({kind:e.kind,pool:e.pool,permanentLockedLiquidity:position.permanentLockedLiquidity.toString(),activation:pool.activationPoint.toString()});
    } else {
      const info=await connection.getAccountInfo(pk(e.address),'finalized');
      if(!info)throw Error('Expected account missing: '+e.address);
      if(e.kind==='mint') {
        const mint=spl.unpackMint(pk(e.address),info,token);
        if(mint.supply.toString()!==e.supply||mint.decimals!==9||mint.mintAuthority||mint.freezeAuthority)throw Error('Mint supply/authority mismatch');
      } else if(e.kind==='token-account') {
        const account=spl.unpackAccount(pk(e.address),info,token);
        if(account.amount.toString()!==e.amount||!account.mint.equals(pk(e.mint))||!account.owner.equals(pk(e.owner)))throw Error('Token allocation mismatch');
      } else if(e.kind==='core') {
        if(!info.owner.equals(CORE)||info.data[0]!==1||!new PublicKey(info.data.subarray(1,33)).equals(pk(e.owner)))throw Error('Core owner mismatch');
      }
      observations.push({...e,verified:true});
    }
  }
  return observations;
}
