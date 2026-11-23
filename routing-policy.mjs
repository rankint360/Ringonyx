export function routingPolicies(db, {query,run,required,fail,whole}) {
  db.exec(`CREATE TABLE IF NOT EXISTS routing_policies (
    site TEXT PRIMARY KEY REFERENCES sites(id), config TEXT NOT NULL
  )`);
  function own(account,site) {
    if (!query('SELECT id FROM sites WHERE id=? AND account=?',site,account).length) fail('Unknown site.',404);
  }
  function parse(account,site) {
    own(account,site);
    return JSON.parse(query('SELECT config FROM routing_policies WHERE site=?',site)[0]?.config ?? 'null');
  }
  return {
    list(account) {
      return query('SELECT p.site,p.config FROM routing_policies p JOIN sites s ON s.id=p.site WHERE s.account=?',account)
        .map(row=>({site:row.site,...JSON.parse(row.config)}));
    },
    save(account,data) {
      const site = required(data.site,'site');
      own(account,site);
      if (!['priority','round-robin','weighted','ring-all'].includes(data.strategy)) fail('Choose a routing strategy.');
      const timezone = required(data.timezone,'time zone');
      try { new Intl.DateTimeFormat('en',{timeZone:timezone}); } catch { fail('Invalid time zone.'); }
      const start = whole(data.start,23), end = whole(data.end,24);
      if (end<=start) fail('Closing hour must be later than opening hour.');
      if (!Array.isArray(data.days) || !data.days.length || data.days.some(day=>!Number.isInteger(day)||day<0||day>6)) fail('Choose valid weekdays.');
      const zips = typeof data.zips==='string' ? data.zips.split(/[ ,\n]+/).filter(Boolean):[];
      if (zips.length>100 || zips.some(zip=>!/^\d{5}$/.test(zip))) fail('Enter up to 100 five-digit ZIP codes.');
      if (data.fallback && !/^\+[1-9]\d{7,14}$/.test(data.fallback)) fail('Invalid fallback number.');
      let weights = {};
      if (data.weights) {
        if (typeof data.weights!=='object' || Array.isArray(data.weights)) fail('Invalid target weights.');
        for (const [phone,weight] of Object.entries(data.weights)) {
          if (!/^\+[1-9]\d{7,14}$/.test(phone) || !Number.isSafeInteger(weight)||weight<1||weight>100) fail('Weights must be from 1 to 100.');
          weights[phone] = weight;
        }
      }
      const config = {strategy:data.strategy,timezone,start,end,days:[...new Set(data.days)],zips,fallback:data.fallback||'',weights};
      run('INSERT INTO routing_policies VALUES (?,?) ON CONFLICT(site) DO UPDATE SET config=excluded.config',site,JSON.stringify(config));
      return {site,...config};
    },
    apply(account,site,steps,context={}) {
      const policy = parse(account,site);
      if (!policy) return {steps,next:steps.find(row=>!row.attempted)??null};
      const at = context.at ? new Date(context.at):new Date();
      if (!Number.isFinite(at.valueOf())) fail('Invalid simulation time.');
      const parts = new Intl.DateTimeFormat('en-US',{timeZone:policy.timezone,weekday:'short',hour:'numeric',hourCycle:'h23'}).formatToParts(at);
      const day = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(parts.find(part=>part.type==='weekday').value);
      const hour = Number(parts.find(part=>part.type==='hour').value);
      const reason = policy.zips.length && !policy.zips.includes(context.zip) ? 'ZIP outside coverage' :
        !policy.days.includes(day)||hour<policy.start||hour>=policy.end ? 'Outside business hours':null;
      if (reason) {
        const skipped = steps.map(row=>({...row,attempted:true,reason}));
        if (policy.fallback) skipped.push({label:'After-hours / coverage fallback',destination:policy.fallback,attempted:false,reason:null});
        return {steps:skipped,next:skipped.find(row=>!row.attempted)??null,strategy:policy.strategy};
      }
      const available = steps.filter(row=>!row.attempted);
      if (available.length && ['round-robin','weighted'].includes(policy.strategy)) {
        const count = query('SELECT COUNT(*) AS count FROM calls WHERE site=?',site)[0].count;
        let selected;
        if (policy.strategy==='round-robin') selected=available[count%available.length];
        else {
          const cycle = available.reduce((sum,row)=>sum+(policy.weights[row.destination]||1),0);
          let slot = count%cycle;
          selected = available.find(row=>{
            slot -= policy.weights[row.destination]||1;
            return slot<0;
          });
        }
        return {steps,next:selected,strategy:policy.strategy};
      }
      return {steps,next:available[0]??null,strategy:policy.strategy,
        ringGroup:policy.strategy==='ring-all' ? available.map(row=>row.destination):[]};
    }
  };
}
