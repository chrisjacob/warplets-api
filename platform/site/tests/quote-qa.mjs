import assert from 'node:assert/strict';
import { seedBoundQuote } from '../../application/fixtures/seed-bound-quote.mjs';

export async function checkQuoteView({browser,db,origin,artifactStore}){
  await seedBoundQuote(db,artifactStore);
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const calls=[];
  page.on('request',request=>{if(new URL(request.url()).pathname==='/api/v1/quotes')calls.push(JSON.parse(request.postData()??'{}'));});
  try{
    await page.goto(origin+'/markets/quote-demo');
    await page.getByLabel('Amount in QUOTEOG',{exact:true}).fill('1');
    await page.getByRole('button',{name:'Preview swap quote'}).click();
    await page.getByRole('heading',{name:'Local exact-input quote'}).waitFor();
    assert.equal(calls[0].inputUnits,'1000000');assert.equal(calls[0].direction,'buy-att');
    await page.getByText('Effective buy FDV',{exact:true}).waitFor();
    await page.getByLabel('Direction',{exact:true}).selectOption('sell-att');
    await page.getByLabel('Amount in QUOTEATT',{exact:true}).fill('2');
    await page.getByRole('button',{name:'Preview swap quote'}).click();
    await page.getByRole('heading',{name:'Local exact-input quote'}).waitFor();
    assert.equal(calls[1].inputUnits,'2000000000');assert.equal(calls[1].direction,'sell-att');
    assert.equal(await page.getByText('Effective buy FDV',{exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:/send|swap now|sign transaction/i}).count(),0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.getByLabel('Direction',{exact:true}).selectOption('buy-att');
    await page.getByLabel('Amount in QUOTEOG',{exact:true}).fill('0.0000001');
    await page.getByRole('button',{name:'Preview swap quote'}).click();
    await page.getByText('This token supports 6 decimal places.').waitFor();
    assert.equal(calls.length,2);
    await page.getByLabel('Slippage tolerance in basis points',{exact:true}).fill('17');
    await page.getByRole('button',{name:'Switch to simple view',exact:true}).click();
    assert.equal(await page.getByLabel('Slippage tolerance',{exact:true}).inputValue(),'17');
    assert.equal(await page.getByRole('option',{name:'0.17% (custom)',exact:true}).count(),1);
    await page.getByLabel('Slippage tolerance',{exact:true}).selectOption('50');
    await page.getByLabel('Amount in QUOTEOG',{exact:true}).fill('1');
    await page.getByRole('button',{name:'Preview swap quote'}).click();
    await page.getByRole('heading',{name:'Local exact-input quote'}).waitFor();
    assert.equal(calls[2].slippageBps,50);
    console.log('Both quote directions, token precision, fee-inclusive FDV, slippage and mobile presentation passed.');
  }finally{await page.close();}
}
