/** Exact presentation conversions. Financial policy stays in the API. */
export function baseUnits(text:string,decimals:number):string{
  if(!Number.isInteger(decimals)||decimals<0||decimals>18)throw Error('Token precision is unavailable.');
  if(!/^(0|[1-9]\d*)(\.\d+)?$/.test(text) || text.length>64)throw Error('Enter a positive decimal amount.');
  const [whole,fraction='']=text.split('.');
  if(fraction.length>decimals)throw Error('This token supports '+decimals+' decimal places.');
  const amount=BigInt(whole)*10n**BigInt(decimals)+BigInt((fraction+'0'.repeat(decimals)).slice(0,decimals)||'0');
  if(amount===0n||amount>((1n<<64n)-1n))throw Error('Amount is outside the supported token range.');
  return amount.toString();
}
export function tokenUnits(raw:string,decimals:number):string{
  if(!/^\d+$/.test(raw)||!Number.isInteger(decimals)||decimals<0||decimals>18)throw Error('Invalid token amount.');
  const value=BigInt(raw),scale=10n**BigInt(decimals),fraction=(value%scale).toString().padStart(decimals,'0').replace(/0+$/,'');
  return (value/scale).toString()+(fraction?'.'+fraction:'');
}
export function dollarsMicros(raw:string):string{
  const value=tokenUnits(raw,6),[whole,frac='']=value.split('.');
  const grouped=whole.replace(/\B(?=(\d{3})+(?!\d))/g,',');
  return 'US$'+grouped+'.'+(frac+'00').slice(0,2);
}
