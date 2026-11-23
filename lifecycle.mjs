import { randomUUID,createHash } from 'node:crypto';
export function lifecycle(db, { query, run, transaction, required, whole, fail, now, invoices, exchange, deliveries }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS invoice_lifecycle (
      kind TEXT NOT NULL, invoice TEXT NOT NULL, due TEXT NOT NULL, voided TEXT, reason TEXT,
      PRIMARY KEY(kind,invoice)
    );
    CREATE TABLE IF NOT EXISTS billing_schedule (
      account TEXT PRIMARY KEY REFERENCES accounts(id), cadence TEXT NOT NULL, day INTEGER NOT NULL,
      net_days INTEGER NOT NULL, last_period TEXT
    );
    CREATE TABLE IF NOT EXISTS recording_policy (
      account TEXT PRIMARY KEY REFERENCES accounts(id), days INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS recordings (
      id TEXT PRIMARY KEY, call TEXT NOT NULL REFERENCES calls(id), mime TEXT NOT NULL,
      bytes BLOB, created TEXT NOT NULL, deleted TEXT
    );
    CREATE TABLE IF NOT EXISTS charge_reviews (
      call TEXT PRIMARY KEY REFERENCES calls(id), classification TEXT NOT NULL, reason TEXT NOT NULL,
      actor TEXT NOT NULL, created TEXT NOT NULL, reversed INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS billing_automation (
      account TEXT PRIMARY KEY REFERENCES accounts(id), enabled INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS publisher_payout_requests (
      id TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id), offer TEXT NOT NULL REFERENCES publisher_offers(id),
      reference TEXT NOT NULL, cents INTEGER NOT NULL, created TEXT NOT NULL, UNIQUE(account,reference)
    );
    CREATE TABLE IF NOT EXISTS publisher_payout_lines (
      call TEXT PRIMARY KEY REFERENCES network_calls(id), request TEXT NOT NULL REFERENCES publisher_payout_requests(id), cents INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS publisher_payout_cancellations (
      request TEXT PRIMARY KEY REFERENCES publisher_payout_requests(id), created TEXT NOT NULL
    );
  `);
  function all(account) {
    const groups = [
      ...invoices.list(account).map(row => ({ ...row,kind:'renter',customer:row.renter_name })),
      ...exchange.list(account,'owner').invoices.map(row => ({ ...row,kind:'buyer',customer:row.buyer_name }))
    ];
    return groups.map(row => {
      const metadata = query('SELECT due,voided,reason FROM invoice_lifecycle WHERE kind=? AND invoice=?',row.kind,row.id)[0] ??
        { due:new Date(Date.parse(row.created)+30*86400000).toISOString(),voided:null };
      const status = metadata.voided ? 'void' : row.cents <= row.applied ? 'paid' : metadata.due < now() ? 'overdue':'unpaid';
      return { ...row,...metadata,status,balance:metadata.voided ? 0:row.cents-row.applied };
    });
  }
  function invoice(account,kind,id) {
    const row = all(account).find(row=>row.kind===kind && row.id===id);
    if (!row) fail('Unknown invoice.',404);
    return row;
  }
  function metadata(row,due,voided=null,reason=null) {
    run(`INSERT INTO invoice_lifecycle VALUES (?,?,?,?,?) ON CONFLICT(kind,invoice)
      DO UPDATE SET due=excluded.due,voided=excluded.voided,reason=excluded.reason`,row.kind,row.id,due,voided,reason);
  }
  function adjust(account,call,classification,reason,actor) {
    const [row] = query(`SELECT c.id,c.outcome,COALESCE(ch.cents,0) AS cents,l.invoice FROM calls c JOIN sites s ON s.id=c.site
      LEFT JOIN charges ch ON ch.call=c.id LEFT JOIN invoice_lines l ON l.call=c.id WHERE c.id=? AND s.account=?`,call,account);
    if (!row) fail('Unknown call.',404);
    const prior = query('SELECT * FROM charge_reviews WHERE call=?',call)[0];
    if (prior) {
      if (prior.classification!==classification || prior.reason!==reason) fail('Review already recorded.',409);
      return prior;
    }
    let reversed = 0;
    const record = () => run('INSERT INTO charge_reviews VALUES (?,?,?,?,?,?)',call,classification,reason,actor,now(),reversed);
    const enabled = query('SELECT enabled FROM billing_automation WHERE account=?',account)[0]?.enabled;
    if (enabled && ['spam','wrong-number','solicitor'].includes(classification) && row.cents>0) {
      if (row.invoice) {
        const bill = invoice(account,'renter',row.invoice);
        if (bill.balance < row.cents || bill.voided) fail('Resolve the paid or void invoice manually before reversing this call.',409);
        reversed=row.cents;
        invoices.apply(account,row.invoice,{kind:'credit',reference:'review:'+call,cents:row.cents},record);
        return {call,reversed};
      } else {
        reversed=row.cents;
        transaction(()=>{
          run('UPDATE charges SET cents=0 WHERE call=?',call);
          record();
        });
        return {call,reversed};
      }
    }
    record();
    return {call,reversed};
  }
  return {
    all,
    guard(account,kind,id) {
      if (invoice(account,kind,id).voided) fail('Void invoices cannot receive entries.',409);
    },
    read(account) {
      return { invoices:all(account),
        schedule:query('SELECT * FROM billing_schedule WHERE account=?',account)[0] ?? {cadence:'manual',day:1,net_days:30},
        retention:query('SELECT days FROM recording_policy WHERE account=?',account)[0]?.days ?? 180,
        recordings:query(`SELECT r.id,r.call,r.mime,r.created,r.deleted,length(r.bytes) AS size FROM recordings r
          JOIN calls c ON c.id=r.call JOIN sites s ON s.id=c.site WHERE s.account=? ORDER BY r.created DESC`,account),
        reviews:query(`SELECT r.* FROM charge_reviews r JOIN calls c ON c.id=r.call JOIN sites s ON s.id=c.site
          WHERE s.account=? ORDER BY r.created DESC`,account),
        automation: Boolean(query('SELECT enabled FROM billing_automation WHERE account=?',account)[0]?.enabled),
        payouts:query(`SELECT p.id,p.offer,p.reference,p.cents,p.created,c.request IS NOT NULL AS canceled
          FROM publisher_payout_requests p LEFT JOIN publisher_payout_cancellations c ON c.request=p.id
          WHERE p.account=? ORDER BY p.created DESC`,account) };
    },
    write(user,action,data) {
      if (user.role !== 'owner') fail('Workspace owner access required.',403);
      const account = user.account;
      if (action === 'schedule') {
        if (!['manual','weekly','monthly'].includes(data.cadence)) fail('Choose a billing cadence.');
        const day = whole(data.day, data.cadence==='weekly' ? 7:28);
        if (!day) fail('Choose a positive billing day.');
        const net = whole(data.net,365);
        run(`INSERT INTO billing_schedule VALUES (?,?,?,?,NULL) ON CONFLICT(account)
          DO UPDATE SET cadence=excluded.cadence,day=excluded.day,net_days=excluded.net_days`,account,data.cadence,day,net);
        return {saved:true};
      }
      if (action === 'invoice-due' || action === 'invoice-void' || action === 'invoice-send') {
        const row = invoice(account,data.kind,required(data.id,'invoice'));
        if (action === 'invoice-send') {
          const email = required(data.email,'recipient');
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Enter a valid email.');
          const revision=createHash('sha256').update(JSON.stringify(row)).digest('hex').slice(0,16);
          return deliveries.enqueue(account,'email','invoice:'+row.kind+':'+row.id+':'+revision+':'+email,
            {type:'invoice',recipient:email,invoice:row});
        }
        if (row.voided) fail('Invoice is already void.',409);
        if (action === 'invoice-void') {
          if (row.applied) fail('Reconcile existing entries before voiding.',409);
          metadata(row,row.due,now(),required(data.reason,'void reason'));
        } else {
          if (typeof data.due!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.due) || !Number.isFinite(Date.parse(data.due))) fail('Enter a due date.');
          metadata(row,data.due+'T23:59:59.999Z');
        }
        return {saved:true};
      }
      if (action === 'retention') {
        if (![30,90,180,365].includes(data.days)) fail('Choose 30, 90, 180, or 365 days.');
        run('INSERT INTO recording_policy VALUES (?,?) ON CONFLICT(account) DO UPDATE SET days=excluded.days',account,data.days);
        return {saved:true};
      }
      if (action === 'automation') {
        if (typeof data.enabled!=='boolean') fail('Choose a billing automation state.');
        run('INSERT INTO billing_automation VALUES (?,?) ON CONFLICT(account) DO UPDATE SET enabled=excluded.enabled',account,Number(data.enabled));
        return {saved:true};
      }
      if (action === 'review') {
        if (!['qualified','spam','wrong-number','solicitor'].includes(data.classification)) fail('Choose a classification.');
        return adjust(account,required(data.call,'call'),data.classification,required(data.reason,'review evidence'),user.email ?? 'local operator');
      }
      if (action === 'payout') return transaction(() => {
        const offer = required(data.offer,'publisher offer');
        const reference = required(data.reference,'payout reference');
        const [prior] = query('SELECT * FROM publisher_payout_requests WHERE account=? AND reference=?',account,reference);
        if (prior) {
          if (prior.offer!==offer) fail('Payout reference conflict.',409);
          return prior;
        }
        if (!query('SELECT id FROM publisher_offers WHERE id=? AND account=?',offer,account).length) fail('Unknown publisher.',404);
        const calls = query(`SELECT c.id,c.payout FROM network_calls c LEFT JOIN publisher_payout_lines l ON l.call=c.id
          WHERE c.offer=? AND c.account=? AND c.payout>0 AND l.call IS NULL`,offer,account);
        if (!calls.length) fail('No unpaid publisher accruals.',409);
        const id = randomUUID();
        const cents = calls.reduce((sum,row)=>sum+row.payout,0);
        run('INSERT INTO publisher_payout_requests VALUES (?,?,?,?,?,?)',id,account,offer,reference,cents,now());
        for (const call of calls) run('INSERT INTO publisher_payout_lines VALUES (?,?,?)',call.id,id,call.payout);
        deliveries.enqueue(account,'payouts',id,{type:'publisher-payout',id,offer,cents});
        return {id,cents,state:'queued'};
      });
      if (action==='cancel-payout') return transaction(()=>{
        const id=required(data.id,'payout');
        if (!query('SELECT id FROM publisher_payout_requests WHERE id=? AND account=?',id,account).length) fail('Unknown payout.',404);
        if (query('SELECT request FROM publisher_payout_cancellations WHERE request=?',id).length) return {canceled:true};
        const [job]=query("SELECT id,state FROM delivery_jobs WHERE account=? AND provider='payouts' AND reference=?",account,id);
        if (job && ['sending','delivered'].includes(job.state)) fail('Payout already submitted. Reconcile its provider result.',409);
        if (job) run("UPDATE delivery_jobs SET state='canceled' WHERE id=?",job.id);
        run('DELETE FROM publisher_payout_lines WHERE request=?',id);
        run('INSERT INTO publisher_payout_cancellations VALUES (?,?)',id,now());
        return {canceled:true};
      });
      if (action === 'run') return this.run(account,true);
      fail('Unknown lifecycle operation.',404);
    },
    upload(account,call,mime,bytes) {
      if (!query('SELECT c.id FROM calls c JOIN sites s ON s.id=c.site WHERE c.id=? AND s.account=?',call,account).length) fail('Unknown call.',404);
      if (!['audio/mpeg','audio/wav','audio/ogg','audio/webm','audio/mp4'].includes(mime)) fail('Unsupported audio format.',415);
      if (!bytes.length || bytes.length>10*1024*1024) fail('Audio must be between 1 byte and 10 MB.',413);
      const id = randomUUID();
      run('INSERT INTO recordings VALUES (?,?,?,?,?,NULL)',id,call,mime,bytes,now());
      return {id};
    },
    recording(account,id) {
      const [row] = query(`SELECT r.* FROM recordings r JOIN calls c ON c.id=r.call JOIN sites s ON s.id=c.site
        WHERE r.id=? AND s.account=? AND r.deleted IS NULL`,id,account);
      if (!row) fail('Recording not found.',404);
      return row;
    },
    forRenter(renter) {
      return query(`SELECT r.id,r.call,r.created,r.deleted FROM recordings r JOIN calls c ON c.id=r.call
        JOIN assignments a ON a.id=c.assignment WHERE a.renter=? ORDER BY r.created DESC`,renter);
    },
    renterRecording(renter,id) {
      const [row]=query(`SELECT r.* FROM recordings r JOIN calls c ON c.id=r.call JOIN assignments a ON a.id=c.assignment
        WHERE r.id=? AND a.renter=? AND r.deleted IS NULL`,id,renter);
      if (!row) fail('Recording not found.',404);
      return row;
    },
    run(account,force=false) {
      const date = new Date(now());
      const schedule = query('SELECT * FROM billing_schedule WHERE account=?',account)[0];
      const due = schedule && (schedule.cadence==='weekly' ? ((date.getUTCDay() || 7)===schedule.day) :
        schedule.cadence==='monthly' && date.getUTCDate()===schedule.day);
      const period = now().slice(0,10);
      const results = [];
      if (force || (due && schedule.last_period!==period)) {
        for (const renter of query('SELECT id FROM renters WHERE account=?',account)) {
          try {
            const previous = new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()-1,1)).toISOString().slice(0,7);
            const created = invoices.create(account,renter.id,schedule?.cadence==='monthly' ? previous:null);
            const row = invoice(account,'renter',created.id);
            metadata(row,new Date(Date.parse(now())+(schedule?.net_days ?? 30)*86400000).toISOString());
            results.push(created);
          } catch (error) { if (error.status!==409) throw error; }
        }
        for (const buyer of query('SELECT id FROM buyers WHERE account=?',account)) {
          try {
            const created = exchange.write(account,'invoices',{buyer:buyer.id});
            metadata(invoice(account,'buyer',created.id),new Date(Date.parse(now())+(schedule?.net_days ?? 30)*86400000).toISOString());
            results.push(created);
          } catch (error) { if (error.status!==409) throw error; }
        }
        if (schedule) run('UPDATE billing_schedule SET last_period=? WHERE account=?',period,account);
      }
      const days = query('SELECT days FROM recording_policy WHERE account=?',account)[0]?.days ?? 180;
      const cutoff = new Date(Date.parse(now())-days*86400000).toISOString();
      const deleted = run(`UPDATE recordings SET bytes=NULL,deleted=? WHERE deleted IS NULL AND created<?
        AND call IN (SELECT c.id FROM calls c JOIN sites s ON s.id=c.site WHERE s.account=?)`,now(),cutoff,account).changes;
      return {invoices:results,recordingsDeleted:deleted};
    }
  };
}
