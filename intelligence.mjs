import { randomUUID } from 'node:crypto';
export function intelligence(db,{query,run,transaction,required,whole,fail,now,deliveries,shop,invoices,life}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS intelligence_requests (
      id TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id), call TEXT NOT NULL REFERENCES calls(id),
      kind TEXT NOT NULL, reference TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL,
      result TEXT, created TEXT NOT NULL, completed TEXT, UNIQUE(account,reference)
    );
    CREATE TABLE IF NOT EXISTS transcript_alerts (
      request TEXT NOT NULL REFERENCES intelligence_requests(id), term TEXT NOT NULL,
      created TEXT NOT NULL, PRIMARY KEY(request,term)
    );
  `);
  const providers={transcription:'transcription',analysis:'ai',lookup:'caller-lookup',profile:'caller-profiles',booking:'booking'};
  function call(account,id) {
    const [row]=query(`SELECT c.*,x.caller FROM calls c JOIN sites s ON s.id=c.site
      LEFT JOIN call_context x ON x.call=c.id WHERE c.id=? AND s.account=?`,id,account);
    if (!row) fail('Unknown call.',404);
    return row;
  }
  function text(value,label,max=200) {
    if (typeof value!=='string'||value.length>max) fail('Invalid '+label);
    return value.trim();
  }
  return {
    read(account) {
      return {
        requests:query('SELECT id,call,kind,reference,state,result,created,completed FROM intelligence_requests WHERE account=? ORDER BY created DESC LIMIT 100',account)
          .map(row=>({...row,result:row.result?JSON.parse(row.result):null})),
        alerts:query(`SELECT a.request,a.term,a.created,r.call FROM transcript_alerts a
          JOIN intelligence_requests r ON r.id=a.request WHERE r.account=? ORDER BY a.created DESC LIMIT 100`,account)
      };
    },
    request(user,data) {
      if (user.role==='viewer') fail('Read-only account.',403);
      const provider=providers[data.kind];
      if (!provider) fail('Choose a supported request type.');
      const record=call(user.account,required(data.call,'call'));
      const reference=required(data.reference,'request reference');
      const payload={call:record.id};
      if (data.kind==='transcription') {
        const recording=required(data.recording,'recording');
        life.recording(user.account,recording);
        if (!query('SELECT id FROM recordings WHERE id=? AND call=?',recording,record.id).length) fail('Recording belongs to another call.',409);
        payload.recording=recording;
      }
      if (data.kind==='analysis') {
        if (record.outcome!=='answered') fail('Choose an answered call.',409);
        payload.transcript=text(data.transcript,'transcript',6000);
        if (!payload.transcript) fail('Enter the transcript.');
      }
      if (['lookup','profile'].includes(data.kind)) {
        if (!record.caller) fail('This call has no captured caller number.',409);
        payload.number=record.caller;
      }
      if (data.kind==='booking') {
        const cents=whole(data.cents,100000000);
        if (!cents) fail('Booking charge must be positive.');
        if (record.outcome!=='answered'||!record.assignment) fail('Choose an answered renter call.',409);
        payload.cents=cents;payload.bookingReference=required(data.bookingReference,'booking reference');
      }
      return transaction(()=>{
        const [prior]=query('SELECT * FROM intelligence_requests WHERE account=? AND reference=?',user.account,reference);
        const json=JSON.stringify(payload);
        if (prior) {
          if (prior.kind!==data.kind||prior.payload!==json) fail('Request reference conflict.',409);
          return {id:prior.id,state:prior.state};
        }
        if (data.kind==='analysis') shop.check(user.account,'ai');
        const id=randomUUID();
        run("INSERT INTO intelligence_requests VALUES (?,?,?,?,?,?,'queued',NULL,?,NULL)",id,user.account,record.id,data.kind,reference,json,now());
        deliveries.enqueue(user.account,provider,id,{id,type:data.kind+'.requested',...payload});
        return {id,state:'queued'};
      });
    },
    event(data) {
      const id=required(data.request,'request');
      const [request]=query('SELECT * FROM intelligence_requests WHERE id=?',id);
      if (!request) fail('Unknown intelligence request.',404);
      if (request.state==='complete') return {complete:true};
      if (!['complete','failed'].includes(data.state)) fail('Choose a terminal result state.');
      return transaction(()=>{
        if (data.state==='failed') {
          run("UPDATE intelligence_requests SET state='failed',completed=? WHERE id=?",now(),id);
          return {failed:true};
        }
        if (request.state==='failed') fail('Create a new request after a failure.',409);
        const payload=JSON.parse(request.payload);
        let result={};
        if (request.kind==='transcription') {
          result.transcript=text(data.transcript,'transcript',6000);
          if (!result.transcript) fail('Transcript is empty.');
        } else if (request.kind==='analysis') {
          const score=whole(data.score,100);
          if (!['positive','neutral','negative','unknown'].includes(data.sentiment)) fail('Invalid sentiment.');
          if (!['low','normal','high'].includes(data.urgency)) fail('Invalid urgency.');
          result={summary:required(data.summary,'summary'),intent:required(data.intent,'intent'),score,
            sentiment:data.sentiment,urgency:data.urgency,coaching:text(data.coaching||'','coaching',2000)};
          if (data.classification && !['qualified','spam','wrong-number','solicitor'].includes(data.classification)) fail('Invalid classification.');
          if (data.classification) result.classification=data.classification;
          shop.recordUsage(request.account,{reference:'analysis-result:'+id,kind:'analysis',units:1,cents:0});
          if (data.classification && ['spam','wrong-number','solicitor'].includes(data.classification)) {
            life.write({account:request.account,role:'owner',email:'provider:ai'},'review',{
              call:request.call,classification:data.classification,reason:('Provider analysis '+id+': '+result.summary).slice(0,200)
            });
          }
        } else if (request.kind==='booking') {
          if (typeof data.confirmed!=='boolean') fail('Booking confirmation must be a boolean.');
          result={confirmed:data.confirmed};
          if (data.confirmed) {
            const booking=invoices.verifyBooking(request.account,'provider:booking',{
              call:request.call,reference:payload.bookingReference,cents:payload.cents,evidence:required(data.evidence,'booking evidence')
            });
            result.booking=booking.id;
          }
        } else {
          for (const key of ['name','lineType','carrier','city','region','country','source','profile']) {
            if (data[key]!==undefined) result[key]=text(data[key],key,key==='profile'?2000:200);
          }
          if (!Object.keys(result).length) fail('Provider returned no caller data.');
        }
        const transcript=result.transcript||payload.transcript;
        if (transcript) {
          const terms=query('SELECT alert_terms FROM business_settings WHERE account=?',request.account)[0]?.alert_terms||'';
          for (const term of [...new Set(terms.split(',').map(value=>value.trim().toLowerCase()).filter(Boolean))]) {
            if (transcript.toLowerCase().includes(term)) {
              run('INSERT OR IGNORE INTO transcript_alerts VALUES (?,?,?)',id,term,now());
              for (const connection of query("SELECT provider FROM integration_connections WHERE account=? AND enabled=1 AND provider IN ('slack','webhook')",request.account)) {
                deliveries.enqueue(request.account,connection.provider,'alert:'+id+':'+term,{type:'transcript.alert',call:request.call,term,request:id});
              }
            }
          }
        }
        run("UPDATE intelligence_requests SET state='complete',result=?,completed=? WHERE id=?",JSON.stringify(result),now(),id);
        return {complete:true};
      });
    }
  };
}
