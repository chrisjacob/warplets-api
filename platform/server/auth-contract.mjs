const body=(fields)=>({required:true,content:{'application/json':{schema:{
  type:'object',required:fields,properties:Object.fromEntries(fields.map(f=>[f,{type:'string'}]))}}}});
const resp=description=>({description});
export const authPaths={
  '/auth/challenges':{post:{operationId:'createWalletChallenge',requestBody:body(['wallet']),
    responses:{201:resp('Single-use five-minute sign-in challenge'),403:resp('Origin mismatch'),429:resp('Rate limited')}}},
  '/auth/verify':{post:{operationId:'verifyWalletSignature',requestBody:body(['nonce','signature']),
    responses:{200:resp('Local HttpOnly session cookie'),401:resp('Invalid or expired proof')}}},
  '/auth/logout':{post:{operationId:'revokeSession',responses:{200:resp('Session revoked')}}},
  '/me':{get:{operationId:'getProfile',responses:{200:resp('Verified wallet and chain'),401:resp('Session required')}}},
  '/me/wallets':{get:{operationId:'getWallets',responses:{200:resp('Verified wallet list'),401:resp('Session required')}}}
};
