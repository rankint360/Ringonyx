import { randomUUID } from 'node:crypto';

export const plans = {
  free: { name: 'Free', cents: 0, partners: 1, sites: null, ai: 0 },
  individual: { name: 'Individual', cents: 1900, partners: null, sites: null, ai: 2000 },
  network: { name: 'Network', cents: 6900, partners: null, sites: 5, ai: null }
};
export function commerce(db, { query, run, transaction, fail, required, whole, now }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      account TEXT PRIMARY KEY REFERENCES accounts(id), plan TEXT NOT NULL, status TEXT NOT NULL,
      trial_end TEXT, trial_used INTEGER NOT NULL DEFAULT 0, updated TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS subscription_cycles (
      account TEXT PRIMARY KEY REFERENCES accounts(id), ends TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS commerce_requests (
      id TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id), kind TEXT NOT NULL,
      reference TEXT NOT NULL, amount INTEGER NOT NULL, detail TEXT NOT NULL, state TEXT NOT NULL,
      created TEXT NOT NULL, UNIQUE(account,kind,reference)
    );
    CREATE TABLE IF NOT EXISTS wallet_entries (
      id TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id), reference TEXT NOT NULL,
      cents INTEGER NOT NULL, description TEXT NOT NULL, created TEXT NOT NULL, UNIQUE(account,reference)
    );
    CREATE TABLE IF NOT EXISTS wallet_holds (
      account TEXT NOT NULL REFERENCES accounts(id), reference TEXT NOT NULL, cents INTEGER NOT NULL,
      state TEXT NOT NULL, created TEXT NOT NULL, PRIMARY KEY(account,reference)
    );
    CREATE TABLE IF NOT EXISTS wallet_preferences (
      account TEXT PRIMARY KEY REFERENCES accounts(id), threshold INTEGER NOT NULL, recharge INTEGER NOT NULL,
      enabled INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS usage_events (
      account TEXT NOT NULL REFERENCES accounts(id), reference TEXT NOT NULL, kind TEXT NOT NULL,
      units INTEGER NOT NULL, cents INTEGER NOT NULL, created TEXT NOT NULL, UNIQUE(account,reference)
    );
    CREATE TABLE IF NOT EXISTS settlement_receipts (
      id TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id), request TEXT NOT NULL,
      created TEXT NOT NULL
    );
  `);
  function state(account) {
    const record = query('SELECT * FROM subscriptions WHERE account=?', account)[0];
    const cycle=query('SELECT ends FROM subscription_cycles WHERE account=?',account)[0];
    if (record) record.cycle_end=cycle?.ends ?? null;
    if (record?.status==='canceling' && cycle?.ends<=now()) {
      run("UPDATE subscriptions SET status='canceled',updated=? WHERE account=?",now(),account);
      record.status='canceled';
    }
    if (record?.status === 'trial' && record.trial_end <= now()) {
      run("UPDATE subscriptions SET status='expired',updated=? WHERE account=?", now(), account);
      record.status = 'expired';
    }
    return record ?? { plan: 'legacy', status: 'legacy', trial_used: 0 };
  }
  function balance(account) {
    const total = query('SELECT COALESCE(SUM(cents),0) AS cents FROM wallet_entries WHERE account=?', account)[0].cents;
    const reserved = query("SELECT COALESCE(SUM(cents),0) AS cents FROM wallet_holds WHERE account=? AND state='held'", account)[0].cents;
    return { total, reserved, available: total - reserved };
  }
  function paymentRequest(account, kind, reference, amount, detail) {
    const [prior] = query('SELECT * FROM commerce_requests WHERE account=? AND kind=? AND reference=?', account, kind, reference);
    const json = JSON.stringify(detail);
    if (prior) {
      if (prior.amount !== amount || prior.detail !== json) fail('Payment reference conflicts with the earlier request.', 409);
      return prior;
    }
    const id = randomUUID();
    run('INSERT INTO commerce_requests VALUES (?,?,?,?,?,?,?,?)', id, account, kind, reference, amount, json, 'awaiting-provider', now());
    return { id, state: 'awaiting-provider', amount };
  }
  return {
    state, balance,
    check(account, resource) {
      const subscription = state(account);
      if (subscription.plan === 'legacy') return;
      const plan = plans[['active','canceling','trial'].includes(subscription.status) ? subscription.plan : 'free'];
      if (resource==='publishers') {
        if (plan.name!=='Network') fail('Publisher offers require the Network plan.',409);
        if (subscription.status==='trial' && query('SELECT COUNT(*) AS count FROM publisher_offers WHERE account=?',account)[0].count>=3) {
          fail('The Network trial supports three publisher offers.',409);
        }
        return;
      }
      if (resource==='ai') {
        const used=query("SELECT COALESCE(SUM(units),0) AS count FROM usage_events WHERE account=? AND kind='analysis' AND created>=?",
          account,now().slice(0,7)+'-01')[0].count;
        const pending=query("SELECT COUNT(*) AS count FROM intelligence_requests WHERE account=? AND kind='analysis' AND state='queued'",account)[0].count;
        if (plan.ai!==null && used+pending>=plan.ai) fail('Monthly analysis allowance reached.',409);
        return;
      }
      const count = resource === 'sites'
        ? query('SELECT COUNT(*) AS count FROM sites WHERE account=?', account)[0].count
        : query('SELECT (SELECT COUNT(*) FROM renters WHERE account=?)+(SELECT COUNT(*) FROM buyers WHERE account=?) AS count', account, account)[0].count;
      const limit = resource === 'sites' ? plan.sites : plan.partners;
      if (limit !== null && count >= limit) fail('Your current plan limit has been reached.', 409);
    },
    read(account) {
      return { subscription: state(account), plans, wallet: balance(account),
        preferences: query('SELECT * FROM wallet_preferences WHERE account=?', account)[0] ?? { threshold: 200, recharge: 1000, enabled: 0 },
        entries: query('SELECT reference,cents,description,created FROM wallet_entries WHERE account=? ORDER BY created DESC LIMIT 100', account),
        requests: query('SELECT id,kind,reference,amount,state,created FROM commerce_requests WHERE account=? ORDER BY created DESC LIMIT 100', account),
        usage: query('SELECT kind,SUM(units) AS units,SUM(cents) AS cents FROM usage_events WHERE account=? GROUP BY kind', account) };
    },
    write(user, action, data) {
      if (user.role !== 'owner') fail('Workspace owner access required.', 403);
      const account = user.account;
      if (action==='cancel') {
        const record=state(account);
        if (record.status==='legacy') fail('No managed subscription to cancel.',409);
        const next=record.status==='active' ? 'canceling':'canceled';
        run('UPDATE subscriptions SET status=?,updated=? WHERE account=?',next,now(),account);
        return {status:next};
      }
      if (action === 'trial') return transaction(() => {
        if (!['individual','network'].includes(data.plan)) fail('Choose a paid plan.');
        if (state(account).trial_used) fail('This workspace has already used its trial.', 409);
        const end = new Date(Date.parse(now()) + 14 * 86400000).toISOString();
        run(`INSERT INTO subscriptions VALUES (?,?,'trial',?,1,?)
          ON CONFLICT(account) DO UPDATE SET plan=excluded.plan,status='trial',trial_end=excluded.trial_end,trial_used=1,updated=excluded.updated`,
          account, data.plan, end, now());
        return { trialEnd: end };
      });
      if (action === 'upgrade') {
        if (!['individual','network'].includes(data.plan)) fail('Choose a paid plan.');
        return transaction(() => paymentRequest(account, 'subscription', required(data.reference,'payment reference'), plans[data.plan].cents, { plan: data.plan }));
      }
      if (action === 'topup') {
        const cents=whole(data.cents,100000000);
        if (!cents) fail('Deposit amount must be positive.');
        return transaction(() => paymentRequest(account,'wallet',required(data.reference,'deposit reference'),cents,{}));
      }
      if (action === 'recharge') {
        if (typeof data.enabled !== 'boolean') fail('Choose auto-recharge on or off.');
        const threshold = whole(data.threshold, 10000000);
        const recharge = whole(data.recharge, 10000000);
        if (data.enabled && !recharge) fail('Recharge amount must be positive.');
        run(`INSERT INTO wallet_preferences VALUES (?,?,?,?) ON CONFLICT(account)
          DO UPDATE SET threshold=excluded.threshold,recharge=excluded.recharge,enabled=excluded.enabled`,
          account, threshold, recharge, Number(data.enabled));
        return { saved: true };
      }
      fail('Unknown commerce operation.',404);
    },
    recordUsage(account, { reference, kind, units, cents }) {
      required(reference,'usage reference'); required(kind,'usage kind');
      whole(units,100000000); whole(cents,100000000);
      return transaction(() => {
        const [prior] = query('SELECT * FROM usage_events WHERE account=? AND reference=?',account,reference);
        if (prior) {
          if (prior.kind !== kind || prior.units !== units || prior.cents !== cents) fail('Usage reference conflict.',409);
          return { recorded: true };
        }
        if (balance(account).available < cents) fail('Insufficient wallet balance.',409);
        run('INSERT INTO usage_events VALUES (?,?,?,?,?,?)',account,reference,kind,units,cents,now());
        if (cents) run('INSERT INTO wallet_entries VALUES (?,?,?,?,?,?)',randomUUID(),account,'usage:'+reference,-cents,kind,now());
        const pref = query('SELECT * FROM wallet_preferences WHERE account=? AND enabled=1',account)[0];
        if (pref && balance(account).available < pref.threshold) {
          const existing = query("SELECT id FROM commerce_requests WHERE account=? AND kind='wallet' AND state='awaiting-provider'",account);
          if (!existing.length) paymentRequest(account,'wallet','auto:'+reference,pref.recharge,{});
        }
        return { recorded: true };
      });
    },
    settle(receipt, requestId) {
      return transaction(() => {
        const [request] = query('SELECT * FROM commerce_requests WHERE id=?',requestId);
        if (!request) fail('Unknown payment request.',404);
        const [prior] = query('SELECT request FROM settlement_receipts WHERE id=?',receipt);
        if (prior && prior.request !== requestId) fail('Receipt already used.',409);
        if (request.state === 'settled') return { settled: true };
        if (!prior) run('INSERT INTO settlement_receipts VALUES (?,?,?,?)',receipt,request.account,requestId,now());
        if (request.kind === 'wallet') run('INSERT INTO wallet_entries VALUES (?,?,?,?,?,?)',
          randomUUID(),request.account,'payment:'+request.id,request.amount,'Wallet deposit',now());
        else {
          const plan = JSON.parse(request.detail).plan;
          run(`INSERT INTO subscriptions VALUES (?,?,'active',NULL,1,?)
            ON CONFLICT(account) DO UPDATE SET plan=excluded.plan,status='active',updated=excluded.updated`,request.account,plan,now());
          const end=new Date(now());
          const day=end.getUTCDate();
          end.setUTCDate(1);end.setUTCMonth(end.getUTCMonth()+1);
          const last=new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth()+1,0)).getUTCDate();
          end.setUTCDate(Math.min(day,last));
          run('INSERT INTO subscription_cycles VALUES (?,?) ON CONFLICT(account) DO UPDATE SET ends=excluded.ends',request.account,end.toISOString());
        }
        run("UPDATE commerce_requests SET state='settled' WHERE id=?",request.id);
        return { settled: true };
      });
    },
    reserve(account, reference, cents) {
      return transaction(() => {
        whole(cents,100000000);
        const [prior] = query('SELECT cents,state FROM wallet_holds WHERE account=? AND reference=?',account,reference);
        if (prior) {
          if (prior.cents !== cents) fail('Reservation conflict.',409);
          return prior;
        }
        if (balance(account).available < cents) fail('Insufficient wallet balance.',409);
        run("INSERT INTO wallet_holds VALUES (?,?,?,'held',?)",account,reference,cents,now());
        return { state:'held',cents };
      });
    },
    release(account, reference) {
      run("UPDATE wallet_holds SET state='released' WHERE account=? AND reference=? AND state='held'",account,reference);
    },
    capture(account,reference,kind,cents,units=1) {
      return transaction(()=>{
        const [hold]=query('SELECT * FROM wallet_holds WHERE account=? AND reference=?',account,reference);
        if (!hold) fail('Unknown wallet reservation.',404);
        if (hold.state==='captured') return {captured:true};
        if (hold.state!=='held') fail('Reservation was released.',409);
        const charge=cents===undefined ? hold.cents:whole(cents,hold.cents);
        whole(units,100000000);
        run("UPDATE wallet_holds SET state='captured' WHERE account=? AND reference=?",account,reference);
        this.recordUsage(account,{reference:'hold:'+reference,kind,units,cents:charge});
        return {captured:true};
      });
    },
    renew(account) {
      const record=state(account);
      if (record.status==='active' && record.cycle_end && record.cycle_end<=now()) {
        return transaction(()=>paymentRequest(account,'subscription','renew:'+record.cycle_end,plans[record.plan].cents,{plan:record.plan}));
      }
      return {due:false};
    }
  };
}
