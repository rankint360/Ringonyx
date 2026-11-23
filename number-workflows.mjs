import { randomUUID } from 'node:crypto';
export function numberWorkflows(db,{query,run,transaction,required,whole,fail,now,shop,deliveries,addSite,enable}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS carrier_requests (
      id TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id), kind TEXT NOT NULL,
      reference TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL, created TEXT NOT NULL,
      UNIQUE(account,kind,reference)
    );
    CREATE TABLE IF NOT EXISTS number_offers (
      id TEXT PRIMARY KEY, search TEXT NOT NULL REFERENCES carrier_requests(id), number TEXT NOT NULL,
      location TEXT NOT NULL, monthly INTEGER NOT NULL, activation INTEGER NOT NULL, expires TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS purchased_numbers (
      request TEXT PRIMARY KEY REFERENCES carrier_requests(id), site TEXT NOT NULL REFERENCES sites(id),
      provider_reference TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sms_forwarding (
      site TEXT PRIMARY KEY REFERENCES sites(id), destination TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS carrier_results (
      request TEXT PRIMARY KEY REFERENCES carrier_requests(id), seconds INTEGER NOT NULL, cents INTEGER NOT NULL
    );
  `);
  function phone(value) {
    if (typeof value!=='string'||!/^\+[1-9]\d{7,14}$/.test(value)) fail('Use an international phone number.');
    return value;
  }
  function request(account,kind,reference,payload) {
    const raw=JSON.stringify(payload);
    const [prior]=query('SELECT * FROM carrier_requests WHERE account=? AND kind=? AND reference=?',account,kind,reference);
    if (prior) {
      if (prior.payload!==raw) fail('Carrier request reference conflict.',409);
      return {id:prior.id,state:prior.state};
    }
    const id=randomUUID();
    run("INSERT INTO carrier_requests VALUES (?,?,?,?,?,'queued',?)",id,account,kind,reference,raw,now());
    deliveries.enqueue(account,'carrier',id,{id,type:'carrier.'+kind,...payload});
    return {id,state:'queued'};
  }
  return {
    read(account) {
      return { requests:query(`SELECT r.id,r.kind,r.reference,r.state,r.created,result.seconds,result.cents FROM carrier_requests r
        LEFT JOIN carrier_results result ON result.request=r.id WHERE r.account=? ORDER BY r.created DESC LIMIT 100`,account),
        offers:query(`SELECT o.* FROM number_offers o JOIN carrier_requests r ON r.id=o.search
          WHERE r.account=? AND o.expires>? AND r.state='complete' ORDER BY o.monthly,o.number`,account,now()),
        forwarding:query('SELECT f.* FROM sms_forwarding f JOIN sites s ON s.id=f.site WHERE s.account=?',account) };
    },
    write(user,action,data) {
      if (user.role==='viewer') fail('Read-only account.',403);
      const account=user.account;
      if (action==='cancel') return transaction(()=>{
        const id=required(data.id,'request');
        const [existing]=query('SELECT state FROM carrier_requests WHERE id=? AND account=?',id,account);
        if (!existing) fail('Unknown request.',404);
        if (existing.state==='canceled') return {canceled:true};
        if (existing.state!=='queued') fail('Only unsubmitted requests can be canceled.',409);
        const [job]=query("SELECT id,state FROM delivery_jobs WHERE account=? AND provider='carrier' AND reference=?",account,id);
        if (job && ['sending','delivered'].includes(job.state)) fail('The request has been submitted. Wait for the provider result.',409);
        if (job) run("UPDATE delivery_jobs SET state='canceled' WHERE id=?",job.id);
        shop.release(account,id);
        run("UPDATE carrier_requests SET state='canceled' WHERE id=?",id);
        return {canceled:true};
      });
      if (action==='search') {
        if (!['US','CA'].includes(data.country)||!['local','toll-free'].includes(data.kind)) fail('Choose US or Canada and local or toll-free.');
        const area=typeof data.area==='string'?data.area.trim():'';
        if (area&&!/^[2-9]\d{2}$/.test(area)) fail('Enter a three-digit area code.');
        const city=typeof data.city==='string'?data.city.trim():'';
        if (city.length>100) fail('City is too long.');
        return transaction(()=>request(account,'search',randomUUID(),{country:data.country,kind:data.kind,area,city}));
      }
      if (action==='purchase') {
        if (user.role!=='owner') fail('Workspace owner access required.',403);
        const offer=required(data.offer,'offer');
        const reference=required(data.reference,'purchase reference');
        return transaction(()=>{
          const [quote]=query(`SELECT o.* FROM number_offers o JOIN carrier_requests r ON r.id=o.search
            WHERE o.id=? AND r.account=?`,offer,account);
          if (!quote) fail('Unknown number offer.',404);
          const [prior]=query("SELECT id FROM carrier_requests WHERE account=? AND kind='purchase' AND reference=?",account,reference);
          if (!prior && quote.expires<=now()) fail('Offer expired. Search again.',409);
          const payload={offer,number:quote.number,monthly:quote.monthly,activation:quote.activation,name:required(data.name,'number label')};
          const created=request(account,'purchase',reference,payload);
          shop.reserve(account,created.id,quote.monthly+quote.activation);
          return created;
        });
      }
      if (action==='port') return transaction(()=>request(account,'port',required(data.reference,'port reference'),{
        number:phone(data.number),business:required(data.business,'business name'),carrier:required(data.carrier,'current carrier')
      }));
      if (action==='callback') {
        const site=required(data.site,'site');
        const [source]=query('SELECT number FROM sites WHERE id=? AND account=?',site,account);
        if (!source) fail('Unknown source number.',404);
        const budget=whole(data.budget,1000000);
        if (!budget) fail('Enter a maximum call cost.');
        return transaction(()=>{
          const created=request(account,'callback',required(data.reference,'call reference'),{site,from:source.number,to:phone(data.destination),budget});
          shop.reserve(account,created.id,budget);
          return created;
        });
      }
      if (action==='sms-forwarding') {
        const site=required(data.site,'site');
        if (!query('SELECT id FROM sites WHERE id=? AND account=?',site,account).length) fail('Unknown number.',404);
        if (!data.destination) run('DELETE FROM sms_forwarding WHERE site=?',site);
        else run('INSERT INTO sms_forwarding VALUES (?,?) ON CONFLICT(site) DO UPDATE SET destination=excluded.destination',site,phone(data.destination));
        return {saved:true};
      }
      if (action==='release') {
        if (user.role!=='owner') fail('Workspace owner access required.',403);
        const site=required(data.site,'site');
        if (!query('SELECT id FROM sites WHERE id=? AND account=?',site,account).length) fail('Unknown number.',404);
        return transaction(()=>request(account,'release',required(data.reference,'release reference'),{site}));
      }
      fail('Unknown number operation.',404);
    },
    event(data) {
      if (!['complete','failed'].includes(data.state)) fail('Choose a terminal carrier state.');
      const [request]=query('SELECT * FROM carrier_requests WHERE id=?',required(data.request,'request'));
      if (!request) fail('Unknown carrier request.',404);
      return transaction(()=>{
        if (request.state==='complete') return {complete:true};
        if (data.state==='failed') {
          shop.release(request.account,request.id);
          run("UPDATE carrier_requests SET state='failed' WHERE id=?",request.id);
          return {failed:true};
        }
        if (['failed','canceled'].includes(request.state)) fail('Closed requests require a new request.',409);
        const payload=JSON.parse(request.payload);
        if (request.kind==='search') {
          if (!Array.isArray(data.offers)||data.offers.length>100) fail('Invalid inventory response.');
          for (const offer of data.offers) {
            const monthly=whole(offer.monthly,1000000),activation=whole(offer.activation,1000000);
            run('INSERT INTO number_offers VALUES (?,?,?,?,?,?,?)',randomUUID(),request.id,phone(offer.number),
              required(offer.location||'Unspecified','location'),monthly,activation,new Date(Date.parse(now())+300000).toISOString());
          }
        } else if (request.kind==='purchase') {
          const site=addSite(request.account,{name:payload.name,number:payload.number});
          enable(site.id,'Number purchase');
          shop.capture(request.account,request.id,'number-activation');
          run('INSERT INTO purchased_numbers VALUES (?,?,?)',request.id,site.id,required(data.providerReference,'provider reference'));
          run('INSERT INTO number_management (site,monthly_cents) VALUES (?,?) ON CONFLICT(site) DO UPDATE SET monthly_cents=excluded.monthly_cents',site.id,payload.monthly);
        } else if (request.kind==='port') {
          const site=query('SELECT id FROM sites WHERE number=? AND account=?',payload.number,request.account)[0] ||
            addSite(request.account,{name:payload.business,number:payload.number});
          enable(site.id,'Ported number');
        } else if (request.kind==='callback') {
          const seconds=whole(data.seconds,86400),cents=whole(data.cents,1000000);
          shop.capture(request.account,request.id,'outbound-call',cents,seconds);
          run('INSERT INTO carrier_results VALUES (?,?,?)',request.id,seconds,cents);
        } else if (request.kind==='release') {
          run(`INSERT INTO number_management (site,quarantined,monthly_cents) VALUES (?,1,0)
            ON CONFLICT(site) DO UPDATE SET quarantined=1,monthly_cents=0`,payload.site);
        }
        run("UPDATE carrier_requests SET state='complete' WHERE id=?",request.id);
        return {complete:true};
      });
    }
  };
}
