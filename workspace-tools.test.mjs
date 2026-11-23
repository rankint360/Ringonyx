import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';
test('workspace tools preserve accounting, job and recording boundaries', async t => {
  const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'0',RINGONYX_DB:':memory:',
    RINGONYX_OPERATOR_KEY:'tools-test',RINGONYX_PAYMENT_EVENT_SECRET:'test-events'}});
  let errors='';
  child.stderr.on('data',chunk=>{errors+=chunk;});
  t.after(async()=>{
    if (child.exitCode===null) { const exit=once(child,'exit'); child.kill(); await exit; }
  });
  const [startup]=await once(child.stdout,'data',{signal:AbortSignal.timeout(10000)});
  const origin=startup.toString().trim().split(' ').at(-1);
  async function api(path,data,expected=200) {
    const response=await fetch(origin+'/api/'+path,{method:data?'POST':'GET',
      headers:{'X-Ringonyx-Operator':'tools-test'},body:data&&JSON.stringify(data)});
    const result=await response.json();
    assert.equal(response.status,expected,JSON.stringify(result)+' '+errors);
    return result;
  }
  const site=await api('sites',{name:'Tools site',number:'+16025550900'},201);
  const renter=await api('renters',{name:'Tools renter',destination:'+16025550901'},201);
  const publisher=await api('network/publishers',{name:'Auction traffic',payout:1000});
  await api('assignments',{site:site.id,renter:renter.id,rate:5000,minimum:60},201);
  const call=await api('calls',{number:'+16025550900',source:'Tools'},201);
  await api('calls/'+call.id+'/complete',{outcome:'answered',duration:90});
  const invoice=await api('invoices',{renter:renter.id},201);
  let state=await api('workspace-tools');
  assert.equal(state.lifecycle.invoices[0].status,'unpaid');
  await api('workspace-tools/lifecycle/invoice-void',{kind:'renter',id:invoice.id,reason:'Test void'});
  await api('invoice-entries',{invoice:invoice.id,reference:'bad',kind:'payment',cents:1},409);
  await api('workspace-tools/lifecycle/invoice-send',{kind:'renter',id:invoice.id,email:'customer@example.test'});
  await api('workspace-tools/lifecycle/invoice-send',{kind:'renter',id:invoice.id,email:'customer@example.test'});
  state=await api('workspace-tools');
  assert.equal(state.delivery.jobs.length,1);
  const topup=await api('workspace-tools/commerce/topup',{reference:'topup-1',cents:1000});
  assert.equal((await api('workspace-tools')).commerce.wallet.total,0);
  const raw=JSON.stringify({id:'receipt-1',request:topup.id});
  const timestamp=String(Math.floor(Date.now()/1000));
  const signature=createHmac('sha256','test-events').update(timestamp+'.'+raw).digest('hex');
  for (let i=0;i<2;i++) {
    const response=await fetch(origin+'/webhooks/ringonyx/payment',{method:'POST',body:raw,
      headers:{'X-Ringonyx-Timestamp':timestamp,'X-Ringonyx-Signature':signature}});
    assert.equal(response.status,200,await response.text());
  }
  assert.equal((await api('workspace-tools')).commerce.wallet.total,1000);
  async function carrierEvent(event,expected=200) {
    const body=JSON.stringify({type:'carrier',...event});
    const time=String(Math.floor(Date.now()/1000));
    const response=await fetch(origin+'/webhooks/ringonyx/events',{method:'POST',body,
      headers:{'X-Ringonyx-Timestamp':time,'X-Ringonyx-Signature':createHmac('sha256','test-events').update(time+'.'+body).digest('hex')}});
    assert.equal(response.status,expected,await response.text());
  }
  const buyerA=await api('network/buyers',{name:'Bidder A',destination:'+16025550801',region:'NV',price:6000,minimum:60,cap:10,concurrency:2});
  const buyerB=await api('network/buyers',{name:'Bidder B',destination:'+16025550802',region:'NV',price:7000,minimum:60,cap:10,concurrency:2});
  const auction=await api('workspace-tools/auction/open',{offer:publisher.id,reference:'auction-1',region:'NV',floor:5000,timeout:10000});
  await carrierEvent({type:'bid',request:auction.id,buyer:buyerA.id,cents:8000});
  await carrierEvent({type:'bid',request:auction.id,buyer:buyerB.id,cents:9000});
  await carrierEvent({type:'bid',request:auction.id,buyer:buyerB.id,cents:9000});
  const awarded=(await api('workspace-tools')).auctions.find(row=>row.id===auction.id);
  assert.equal(awarded.state,'complete');
  assert.equal(awarded.bid,9000);
  assert.equal(awarded.buyer,buyerB.id);
  const auctionSettlement=await api('network/complete',{call:awarded.call,seconds:90,outcome:'answered'});
  assert.equal(auctionSettlement.revenue,9000);
  const search=await api('workspace-tools/numbers/search',{country:'US',kind:'local',area:'602'});
  await carrierEvent({request:search.id,state:'complete',offers:[{number:'+16025550920',location:'Phoenix',monthly:100,activation:100}]});
  const offer=(await api('workspace-tools')).numbers.offers[0];
  const purchase=await api('workspace-tools/numbers/purchase',{offer:offer.id,reference:'number-1',name:'Purchased test'});
  assert.equal((await api('workspace-tools')).commerce.wallet.reserved,200);
  await carrierEvent({request:purchase.id,state:'complete'},400);
  assert.equal((await api('workspace-tools')).commerce.wallet.reserved,200);
  await carrierEvent({request:purchase.id,state:'complete',providerReference:'provider-1'});
  await carrierEvent({request:purchase.id,state:'complete',providerReference:'provider-1'});
  assert.equal((await api('workspace-tools')).commerce.wallet.total,800);
  assert.equal((await api('sites')).filter(row=>row.number==='+16025550920').length,1);
  const billed=await api('calls',{number:'+16025550900',source:'Review'},201);
  await api('calls/'+billed.id+'/complete',{outcome:'answered',duration:90});
  const reviewInvoice=await api('invoices',{renter:renter.id},201);
  await api('workspace-tools/lifecycle/automation',{enabled:true});
  const review={call:billed.id,classification:'wrong-number',reason:'Reviewed by operator'};
  await api('workspace-tools/lifecycle/review',review);
  await api('workspace-tools/lifecycle/review',review);
  assert.equal((await api('invoices')).find(row=>row.id===reviewInvoice.id).applied,5000);
  await api('workspace-tools/commerce/trial',{plan:'individual'});
  await api('workspace-tools/commerce/trial',{plan:'network'},409);
  const policy={site:site.id,strategy:'ring-all',timezone:'UTC',start:9,end:17,days:[1,2,3,4,5],
    zips:'85001',fallback:'+16025550902',weights:{}};
  await api('workspace-tools/policy/save',policy);
  await api('routing',{site:site.id,routes:[{label:'Backup',destination:'+16025550903'}]});
  const versions=(await api('workspace-tools')).revisions;
  assert.ok(versions.some(row=>row.site===site.id && row.kind==='targets'));
  await api('workspace-tools/flow/restore',{id:versions[0].id});
  const closed=await api('routing/preview',{site:site.id,zip:'85001',at:'2026-11-23T20:00:00Z'});
  assert.equal(closed.next.destination,policy.fallback);
  assert.equal(closed.steps[0].reason,'Outside business hours');
  const open=await api('routing/preview',{site:site.id,zip:'85001',at:'2026-11-23T12:00:00Z'});
  assert.deepEqual(open.ringGroup,['+16025550901','+16025550903']);
  const upload=await fetch(origin+'/api/recordings/call/'+call.id,{method:'PUT',
    headers:{'X-Ringonyx-Operator':'tools-test','Content-Type':'audio/wav'},body:Buffer.from('RIFF-test-audio')});
  assert.equal(upload.status,201);
  const recording=await upload.json();
  await api('management/business',{name:'Tools workspace',timezone:'UTC',terms:'water heater'});
  const transcription=await api('workspace-tools/intelligence/request',{
    kind:'transcription',call:call.id,recording:recording.id,reference:'transcript-1'
  });
  await carrierEvent({type:'intelligence',request:transcription.id,state:'complete',transcript:'Caller: My water heater is leaking.'});
  assert.equal((await api('workspace-tools')).intelligence.alerts[0].term,'water heater');
  const analysis=await api('workspace-tools/intelligence/request',{
    kind:'analysis',call:call.id,reference:'analysis-1',transcript:'Caller: I need to book a service.'
  });
  const aiResult={type:'intelligence',request:analysis.id,state:'complete',summary:'Service requested',intent:'booking',
    score:90,sentiment:'neutral',urgency:'high',coaching:'Confirm the address.'};
  await carrierEvent(aiResult);
  await carrierEvent(aiResult);
  const booking=await api('workspace-tools/intelligence/request',{
    kind:'booking',call:call.id,reference:'booking-request-1',bookingReference:'external-booking-1',cents:1500
  });
  const confirmation={type:'intelligence',request:booking.id,state:'complete',confirmed:true,evidence:'Confirmed by booking provider'};
  await carrierEvent(confirmation);
  await carrierEvent(confirmation);
  assert.equal((await api('bookings')).filter(row=>row.reference==='external-booking-1').length,1);
  const audio=await fetch(origin+'/api/recordings/'+recording.id,{
    headers:{'X-Ringonyx-Operator':'tools-test',Range:'bytes=0-3'}});
  assert.equal(audio.status,206);
  assert.equal(await audio.text(),'RIFF');
  assert.equal((await fetch(origin+'/api/recordings/'+recording.id)).status,401);
  await api('workspace-tools/lifecycle/automation',{enabled:true});
  const second=await api('calls',{number:'+16025550900',source:'Tools'},201);
  // This call can be unrouted under the business policy, so create its review without any charge.
  await api('workspace-tools/lifecycle/review',{call:second.id,classification:'spam',reason:'Manual review'});
  state=await api('workspace-tools');
  assert.equal(state.lifecycle.reviews[0].classification,'spam');
});
