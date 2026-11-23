export async function renderTools({request,escape:e,money,session,form,field,select}) {
  if (location.pathname!=='/workspace-tools') return false;
  const data=await request('workspace-tools');
  const sites=await request('sites');
  const calls=await request('calls');
  const partners=await request('network');
  const management=await request('management');
  const owner=session.role==='owner';
  const root=document.querySelector('#dashboard');
  const tab=new URLSearchParams(location.search).get('tab')||'commerce';
  const number=(name,label,value=0)=>field(name,label,'type="number" min="0" step="1" value="'+value+'"');
  const options=(name,label,values)=>'<label>'+label+'<select name="'+name+'">'+values.map(value=>
    '<option value="'+e(value)+'">'+e(value)+'</option>').join('')+'</select></label>';
  const panel=(title,body)=>'<section><h3>'+title+'</h3>'+body+'</section>';
  const table=(headers,rows)=>'<div class="console-table"><table><thead><tr>'+headers.map(h=>'<th>'+h+'</th>').join('')+
    '</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(value=>'<td>'+value+'</td>').join('')+'</tr>').join('')+
    '</tbody></table>'+(!rows.length?'<p>No records yet.</p>':'')+'</div>';
  root.innerHTML='<h1>Workspace tools</h1><nav class="settings-tabs">'+
    [['commerce','Plan and wallet'],['invoices','Invoice lifecycle'],['recordings','Recordings'],['delivery','Apps and delivery'],['routing','Advanced routing'],['numbers','Number management'],['intelligence','Conversation and caller data'],['auctions','Buyer auctions']].map(([key,label])=>
      '<a href="/workspace-tools?tab='+key+'" class="'+(tab===key?'active':'')+'">'+label+'</a>').join('')+'</nav>';
  if (tab==='auctions') {
    root.innerHTML+=(session.role!=='viewer'?form('Open a timed auction','workspace-tools/auction/open',
      select('offer','Publisher offer',partners.publishers,'id','name')+field('reference','Auction reference')+
      field('region','Two-letter region','maxlength="2"')+number('floor','Bid floor in cents',0)+number('timeout','Bid deadline in milliseconds (200–10000)',2000),'Queue bid requests'):'')+
      panel('Auction results',table(['Reference','Region','Deadline','State','Awarded call','Winning bid','Responses'],data.auctions.map(row=>[
        e(row.reference),e(row.region),e(row.deadline),e(row.state),e(row.call||'—'),row.bid==null?'—':money(row.bid),
        '<details><summary>'+row.bids.length+' bids</summary>'+row.bids.map(bid=>'<p>'+e(bid.name)+' · '+money(bid.cents)+' · '+(bid.timely?'Within deadline':'Late')+'</p>').join('')+'</details>'
      ])))+'<button type="button" id="refresh-auctions">Refresh auction results</button>';
    document.getElementById('refresh-auctions').onclick=()=>renderTools({request,escape:e,money,session,form,field,select})
      .catch(error=>{document.getElementById('status').textContent=error.message;});
  } else if (tab==='intelligence') {
    const state=data.intelligence;
    root.innerHTML+=(session.role!=='viewer'?form('Request provider processing','workspace-tools/intelligence/request',
      select('call','Call',calls,'id','id')+options('kind','Type',['transcription','analysis','lookup','profile','booking'])+
      field('reference','Request reference')+
      '<label>Recording (for transcription)<select name="recording"><option value="">None</option>'+
      data.lifecycle.recordings.filter(row=>!row.deleted).map(row=>'<option value="'+e(row.id)+'">'+e(row.call)+' · '+e(row.created)+'</option>').join('')+'</select></label>'+
      '<label>Transcript (for analysis)<textarea name="transcript" maxlength="6000"></textarea></label>'+
      '<label>External booking reference (for booking verification)<input name="bookingReference"></label>'+
      number('cents','Verified booking charge in cents',0),'Queue processing'):'')+
      panel('Processing requests',table(['Call','Type','State','Result'],state.requests.map(row=>[
        e(row.call),e(row.kind),e(row.state),row.result?'<details><summary>Result</summary><pre>'+e(JSON.stringify(row.result,null,2))+'</pre></details>':'Awaiting provider'
      ])))+
      panel('Transcript alerts',table(['Call','Term','When'],state.alerts.map(row=>[e(row.call),e(row.term),e(row.created)])));
  } else if (tab==='numbers') {
    root.innerHTML+=(session.role!=='viewer'?'<div class="grid">'+
      form('Search carrier inventory','workspace-tools/numbers/search',options('country','Country',['US','CA'])+
        options('kind','Number type',['local','toll-free'])+
        '<label>Area code<input name="area" maxlength="3"></label><label>City<input name="city"></label>','Queue inventory search')+
      form('Submit port request','workspace-tools/numbers/port',field('number','Number to port')+field('business','Business name')+
        field('carrier','Current carrier')+field('reference','Port reference'),'Queue port request')+
      form('Queue outbound call','workspace-tools/numbers/callback',select('site','Caller ID',sites,'id','number')+
        field('destination','Destination')+number('budget','Maximum cost in cents',100)+field('reference','Call reference'),'Reserve cost and queue call')+
      form('Forward incoming texts','workspace-tools/numbers/sms-forwarding',select('site','Number',sites,'id','number')+
        '<label>Forward destination (blank disables)<input name="destination"></label>','Save SMS forwarding')+'</div>':'')+
      panel('Available inventory',table(['Number','Location','Monthly','Activation','Expires'],data.numbers.offers.map(row=>
        [e(row.number),e(row.location),money(row.monthly),money(row.activation),e(row.expires)])))+
      (owner?form('Purchase a quoted number','workspace-tools/numbers/purchase',
        select('offer','Offer',data.numbers.offers,'id','number')+field('name','Number label')+field('reference','Purchase reference'),
        'Reserve wallet funds and queue purchase')+
        form('Release a number','workspace-tools/numbers/release',select('site','Number',sites,'id','number')+field('reference','Release reference'),'Queue release'):'')+
      panel('Carrier requests',table(['Reference','Type','State','Duration','Cost'],data.numbers.requests.map(row=>
        [e(row.reference),e(row.kind),e(row.state),row.seconds??'—',row.cents==null?'—':money(row.cents)])))+
      (session.role!=='viewer'?form('Cancel an unsubmitted carrier request','workspace-tools/numbers/cancel',
        select('id','Request',data.numbers.requests.filter(row=>row.state==='queued'),'id','reference'),'Cancel request and release reservation'):'')+
      panel('Number management',table(['Site','Number','Quarantined','Monthly fee','Publisher offer'],sites.map(site=>{
      const row=management.numbers.find(row=>row.site===site.id);
      return [e(site.name),e(site.number),row?.quarantined?'Yes':'No',money(row?.monthly_cents||0),
        e(partners.publishers.find(offer=>offer.id===row?.offer)?.name||'—')];
    })))+
      (owner?form('Update selected numbers','management/numbers',
        '<label>Numbers<select name="sites" multiple required>'+sites.map(site=>'<option value="'+e(site.id)+'">'+e(site.number)+' · '+e(site.name)+'</option>').join('')+'</select></label>'+
        options('quarantined','Quarantine',['false','true'])+number('monthly','Monthly fee in cents')+
        '<label>Publisher offer<select name="offer"><option value="">None</option>'+partners.publishers.map(row=>'<option value="'+e(row.id)+'">'+e(row.name)+'</option>').join('')+'</select></label>','Save number metadata'):'');
  } else if (tab==='commerce') {
    const shop=data.commerce;
    root.innerHTML+=panel('Plan', '<p>'+e(shop.subscription.plan)+' · '+e(shop.subscription.status)+
      (shop.subscription.trial_end?' · Trial ends '+e(shop.subscription.trial_end):'')+'</p>')+
      '<div class="plan-grid">'+Object.entries(shop.plans).map(([id,plan])=>panel(e(plan.name),
        '<strong class="metric">'+money(plan.cents)+'/month</strong><p>'+
        (plan.partners===null?'Unlimited customers':plan.partners+' customer')+'</p>'+
        (owner&&id!=='free'?form('Start trial','workspace-tools/commerce/trial','<input type="hidden" name="plan" value="'+id+'">','Start 14-day trial'):'')
      )).join('')+'</div>'+
      panel('Workspace wallet','<strong class="metric">'+money(shop.wallet.available)+'</strong><p>Reserved '+money(shop.wallet.reserved)+
        ' · Total '+money(shop.wallet.total)+'</p><p>Payment requests remain awaiting-provider until a trusted payment event settles them.</p>')+
      (owner?'<div class="grid">'+
        form('Request wallet top-up','workspace-tools/commerce/topup',number('cents','Amount in cents',1000)+field('reference','Deposit reference'),'Create payment request')+
        form('Request plan upgrade','workspace-tools/commerce/upgrade',options('plan','Plan',['individual','network'])+
          field('reference','Payment reference'),'Create payment request')+
        form('Cancel managed subscription','workspace-tools/commerce/cancel','<p>Active paid access ends at the current cycle boundary. A trial ends immediately.</p>','Cancel subscription')+
        form('Auto-recharge preferences','workspace-tools/commerce/recharge',options('enabled','Auto-recharge',['false','true'])+
          number('threshold','Trigger balance in cents',shop.preferences.threshold)+number('recharge','Recharge in cents',shop.preferences.recharge),'Save preferences')+'</div>':'')+
      panel('Payment requests',table(['Reference','Type','Amount','State'],shop.requests.map(row=>[e(row.reference),e(row.kind),money(row.amount),e(row.state)])))+
      panel('Wallet ledger',table(['Reference','Description','Amount','Date'],shop.entries.map(row=>[e(row.reference),e(row.description),money(row.cents),e(row.created)])))+
      panel('Usage',table(['Service','Units','Cost'],shop.usage.map(row=>[e(row.kind),row.units,money(row.cents)])));
  } else if (tab==='delivery') {
    const state=data.delivery;
    root.innerHTML+=panel('Provider connections',table(['Provider','Endpoint','Enabled','Secret stored'],state.connections.map(row=>
      [e(row.provider),e(row.endpoint),row.enabled?'Yes':'No',row.hasSecret?'Yes':'No'])))+
      (owner?'<div class="grid">'+
        form('Connection and saved credentials','workspace-tools/delivery/connection',
          options('provider','Provider',state.providers)+field('endpoint','HTTPS endpoint','type="url"')+
          '<label>Shared signing secret (leave blank to retain)<input name="secret" type="password" autocomplete="new-password"></label>'+
          options('enabled','Enabled',['false','true']),'Save connection')+
        form('Queue an event','workspace-tools/delivery/enqueue',options('provider','Provider',state.providers)+field('reference','Idempotency reference')+
          '<label>JSON payload<textarea name="payload" required>{"type":"ringonyx.test"}</textarea></label>','Queue delivery')+
        form('Retry a delivery','workspace-tools/delivery/retry',select('id','Job',state.jobs.filter(row=>!['delivered','sending'].includes(row.state)),'id','reference'),'Retry')+
        form('Cancel a delivery','workspace-tools/delivery/cancel',select('id','Job',state.jobs.filter(row=>!['delivered','sending'].includes(row.state)),'id','reference'),'Cancel')+'</div>':'')+
      panel('Delivery jobs',table(['Reference','Provider','State','Attempts','Last error'],state.jobs.map(row=>[e(row.reference),e(row.provider),e(row.state),row.attempts,e(row.error)])))+
      panel('Attempt history',table(['Job','HTTP status','Error','When'],state.attempts.map(row=>[e(row.job),row.status??'—',e(row.error),e(row.created)])))+
      '<p>Dispatch requires the server delivery switch, an endpoint host allowlist, and a scheduled maintenance run. Credentials require a configured vault key.</p>';
  } else if (tab==='invoices') {
    const state=data.lifecycle;
    const invoiceOptions=state.invoices.map(row=>({id:row.kind+':'+row.id,label:row.customer+' · '+row.kind+' · '+row.id}));
    root.innerHTML+=panel('All invoices',table(['Customer','Invoice','Total','Balance','Due','Status'],state.invoices.map(row=>
      [e(row.customer),e(row.id),money(row.cents),money(row.balance),e(row.due),e(row.status)])))+
      (owner?'<div class="grid">'+
        form('Billing schedule (UTC)','workspace-tools/lifecycle/schedule',options('cadence','Cadence',['manual','weekly','monthly'])+
          number('day','Weekday 1–7 or month day 1–28',state.schedule.day)+number('net','Payment terms in days',state.schedule.net_days),'Save schedule')+
        form('Create due invoices','workspace-tools/lifecycle/run','','Run invoice and retention maintenance')+
        form('Set invoice due date','workspace-tools/lifecycle/invoice-due',select('selection','Invoice',invoiceOptions,'id','label')+
          field('due','Due date','type="date"'),'Save due date')+
        form('Void unpaid invoice','workspace-tools/lifecycle/invoice-void',select('selection','Invoice',invoiceOptions,'id','label')+
          field('reason','Reason'),'Void invoice')+
        form('Queue invoice email','workspace-tools/lifecycle/invoice-send',select('selection','Invoice',invoiceOptions,'id','label')+
          field('email','Recipient','type="email"'),'Queue email')+
        form('Prepare publisher payout','workspace-tools/lifecycle/payout',select('offer','Publisher',partners.publishers,'id','name')+
          field('reference','Payout reference'),'Reserve accrued calls and queue payout')+
        form('Cancel an unsubmitted payout','workspace-tools/lifecycle/cancel-payout',
          select('id','Payout',state.payouts.filter(row=>!row.canceled),'id','reference'),'Cancel and release accruals')+
        form('Review billing classification','workspace-tools/lifecycle/review',select('call','Call',calls,'id','id')+
          options('classification','Classification',['qualified','spam','wrong-number','solicitor'])+field('reason','Review evidence'),'Record review')+
        form('Automatic adjustments for reviewed calls','workspace-tools/lifecycle/automation',
          options('enabled','Enabled',['false','true']),'Save automation')+'</div>':'')+
      panel('Charge reviews',table(['Call','Classification','Reason','Credit or reversal'],state.reviews.map(row=>
        [e(row.call),e(row.classification),e(row.reason),money(row.reversed)])))+
      panel('Payout requests',table(['Reference','Publisher','Amount','State'],state.payouts.map(row=>[e(row.reference),e(row.offer),money(row.cents),row.canceled?'Canceled':'Prepared'])));
  } else if (tab==='recordings') {
    const state=data.lifecycle;
    root.innerHTML+= (owner?form('Recording retention','workspace-tools/lifecycle/retention',
      options('days','Keep recordings for days',[30,90,180,365]),'Save retention'):'')+
      '<p>Current retention '+state.retention+' days. Expired audio is removed by maintenance.</p>'+
      (session.role!=='viewer'?panel('Upload a call recording',
        '<label>Call<select id="recording-call">'+calls.map(row=>'<option value="'+e(row.id)+'">'+e(row.id)+'</option>').join('')+
        '</select></label><label>Audio (up to 10 MB)<input id="recording-file" type="file" accept="audio/mpeg,audio/wav,audio/ogg,audio/webm,audio/mp4"></label><p id="upload-status" role="status"></p>'):'')+
      panel('Recordings',table(['Call','Created','Playback'],state.recordings.map(row=>[e(row.call),e(row.created),
        row.deleted?'Deleted by retention':'<audio controls preload="none" src="/api/recordings/'+e(row.id)+'"></audio>'])));
    document.getElementById('recording-file')?.addEventListener('change',async event=>{
      const file=event.target.files[0];
      if (!file) return;
      const status=document.getElementById('upload-status');
      try {
        status.textContent='Uploading…';
        const response=await fetch('/api/recordings/call/'+encodeURIComponent(document.getElementById('recording-call').value),{
          method:'PUT',headers:{'Content-Type':file.type||'application/octet-stream'},body:file
        });
        const result=await response.json();
        if (!response.ok) throw Error(result.error);
        await renderTools({request,escape:e,money,session,form,field,select});
      } catch (error) { status.textContent=error.message; }
    });
  } else if (tab==='routing') {
    const routes=await request('routing');
    root.innerHTML+=(session.role!=='viewer'?panel('Ring tree editor',
      '<label>Site<select id="flow-site">'+sites.map(site=>'<option value="'+e(site.id)+'">'+e(site.name)+'</option>').join('')+'</select></label>'+
      '<div class="console-toolbar"><input id="target-label" placeholder="Target label" aria-label="Target label">'+
      '<input id="target-phone" placeholder="+16025550101" aria-label="Target number"><button type="button" id="add-target">Add target</button></div>'+
      '<ol id="flow-targets"></ol><button type="button" id="save-flow">Save target order</button><p id="flow-status" role="status"></p>'):'')+
      panel('Configured policies',table(['Site','Strategy','Hours','Time zone','ZIPs'],data.policies.map(row=>
      [e(sites.find(site=>site.id===row.site)?.name),e(row.strategy),row.start+'–'+row.end,e(row.timezone),e(row.zips.join(', '))])))+
      (session.role!=='viewer'?form('Routing policy','workspace-tools/policy/save',
        select('site','Site',sites,'id','name')+options('strategy','Strategy',['priority','round-robin','weighted','ring-all'])+
        field('timezone','Time zone','value="America/Los_Angeles"')+
        number('start','Opening hour (0–23)',0)+number('end','Closing hour (1–24)',24)+
        field('days','Weekdays (0 Sunday to 6 Saturday)','value="0,1,2,3,4,5,6"')+
        '<label>Covered ZIPs (blank for all)<textarea name="zips"></textarea></label>'+
        '<label>After-hours / coverage fallback<input name="fallback" placeholder="+16025550100"></label>'+
        '<label>Target weights as JSON<textarea name="weights">{}</textarea></label>','Save routing policy'):'')+
      (session.role!=='viewer'?form('Restore a routing version','workspace-tools/flow/restore',
        select('id','Version',data.revisions.map(row=>({...row,label:(sites.find(site=>site.id===row.site)?.name||row.site)+' · '+row.kind+' · '+row.created})),'id','label'),'Restore version'):'')+
      '<p>Drag targets to reorder them, or use the up/down controls. Routing policies apply to simulations.</p><a href="/app">Edit keypad menus and test calls</a>';
    const siteControl=document.getElementById('flow-site');
    if (siteControl) {
      let targets=[],dragged=null;
      const draw=()=>{
        const list=document.getElementById('flow-targets');
        list.innerHTML=targets.map((row,index)=>'<li draggable="true" data-index="'+index+'" class="flow-target">'+
          '<span>'+e(row.label)+' · '+e(row.destination)+'</span><button type="button" data-move="-1" aria-label="Move target up">↑</button>'+
          '<button type="button" data-move="1" aria-label="Move target down">↓</button><button type="button" data-remove="true">Remove</button></li>').join('');
        for (const item of list.children) {
          const index=Number(item.dataset.index);
          item.ondragstart=()=>{dragged=index;};
          item.ondragover=event=>event.preventDefault();
          item.ondrop=event=>{
            event.preventDefault();
            if (dragged===null) return;
            const [row]=targets.splice(dragged,1);
            targets.splice(index,0,row);dragged=null;draw();
          };
          item.ondragend=()=>{dragged=null;};
          item.onclick=event=>{
            const button=event.target.closest('button');
            if (!button) return;
            if (button.dataset.remove) targets.splice(index,1);
            else {
              const next=index+Number(button.dataset.move);
              if (next<0 || next>=targets.length) return;
              [targets[index],targets[next]]=[targets[next],targets[index]];
            }
            draw();
          };
        }
      };
      const load=()=>{targets=routes.filter(row=>row.site===siteControl.value).map(({label,destination})=>({label,destination}));draw();};
      siteControl.onchange=load;
      document.getElementById('add-target').onclick=()=>{
        const label=document.getElementById('target-label').value.trim();
        const destination=document.getElementById('target-phone').value.trim();
        const status=document.getElementById('flow-status');
        if (!label || !/^\+[1-9]\d{7,14}$/.test(destination)) {status.textContent='Enter a label and international phone number.';return;}
        if (targets.length>=10 || targets.some(row=>row.destination===destination)) {status.textContent='Choose a unique target, up to ten.';return;}
        targets.push({label,destination});draw();status.textContent='';
      };
      document.getElementById('save-flow').onclick=async()=>{
        const status=document.getElementById('flow-status');
        try {await request('routing',{site:siteControl.value,routes:targets});status.textContent='Target order saved.';}
        catch(error){status.textContent=error.message;}
      };
      load();
    }
  }
  return true;
}
