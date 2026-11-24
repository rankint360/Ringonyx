import { randomBytes, randomUUID, createCipheriv, createDecipheriv, createHmac } from 'node:crypto';
import { nativeProviders, nativeRequest, nativeResult, readProviderJSON } from './native-providers.mjs';
const providers = ['google-ads','meta','hubspot','salesforce','slack','transcription','caller-lookup','caller-profiles',
  'booking','email','payments','payouts','carrier','lead-delivery','webhook','ai','bidding'];
export function delivery(db, { query, run, transaction, required, fail, now }, options = {}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS integration_modes (
      account TEXT NOT NULL REFERENCES accounts(id), provider TEXT NOT NULL, mode TEXT NOT NULL,
      PRIMARY KEY(account,provider)
    );
    CREATE TABLE IF NOT EXISTS integration_connections (
      account TEXT NOT NULL REFERENCES accounts(id), provider TEXT NOT NULL, endpoint TEXT NOT NULL,
      enabled INTEGER NOT NULL, secret TEXT, updated TEXT NOT NULL, PRIMARY KEY(account,provider)
    );
    CREATE TABLE IF NOT EXISTS delivery_jobs (
      id TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id), provider TEXT NOT NULL,
      reference TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL,
      available TEXT NOT NULL, lease TEXT, error TEXT, created TEXT NOT NULL, UNIQUE(account,provider,reference)
    );
    CREATE TABLE IF NOT EXISTS delivery_attempts (
      id INTEGER PRIMARY KEY, job TEXT NOT NULL REFERENCES delivery_jobs(id), status INTEGER,
      error TEXT, created TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS delivery_leases (
      job TEXT PRIMARY KEY REFERENCES delivery_jobs(id), owner TEXT NOT NULL
    );
  `);
  function key() {
    const value = options.key || process.env.RINGONYX_VAULT_KEY;
    if (!/^[a-f0-9]{64}$/i.test(value || '')) fail('Configure the vault encryption key before saving credentials.',409);
    return Buffer.from(value,'hex');
  }
  function encrypt(value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm',key(),iv);
    const bytes = Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
    return [iv.toString('hex'),cipher.getAuthTag().toString('hex'),bytes.toString('hex')].join('.');
  }
  function decrypt(value) {
    const [iv,tag,bytes] = value.split('.');
    const cipher = createDecipheriv('aes-256-gcm',key(),Buffer.from(iv,'hex'));
    cipher.setAuthTag(Buffer.from(tag,'hex'));
    return Buffer.concat([cipher.update(Buffer.from(bytes,'hex')),cipher.final()]).toString();
  }
  function endpoint(value) {
    let url;
    try { url = new URL(value); } catch { fail('Enter an HTTPS endpoint.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port) fail('Use a standard HTTPS endpoint without credentials or a fragment.');
    return url.href;
  }
  function enqueue(account, provider, reference, payload) {
    if (!providers.includes(provider)) fail('Unknown provider.');
    const body = JSON.stringify(payload);
    if (body.length > 12000) fail('Delivery payload is too large.');
    const [prior] = query('SELECT * FROM delivery_jobs WHERE account=? AND provider=? AND reference=?',account,provider,reference);
    if (prior) {
      if (prior.payload !== body) fail('Delivery reference conflict.',409);
      return { id:prior.id,state:prior.state };
    }
    const id = randomUUID();
    run("INSERT INTO delivery_jobs VALUES (?,?,?,?,?,'queued',0,?,NULL,NULL,?)",id,account,provider,reference,body,now(),now());
    return { id,state:'queued' };
  }
  return {
    providers, enqueue, nativeProviders,
    read(account) {
      return { providers, nativeProviders,
        connections: query(`SELECT c.provider,c.endpoint,c.enabled,c.secret IS NOT NULL AS hasSecret,c.updated,COALESCE(m.mode,'gateway') AS mode
          FROM integration_connections c LEFT JOIN integration_modes m ON m.account=c.account AND m.provider=c.provider WHERE c.account=?`,account),
        jobs: query('SELECT id,provider,reference,state,attempts,available,error,created FROM delivery_jobs WHERE account=? ORDER BY created DESC LIMIT 100',account),
        attempts: query(`SELECT a.* FROM delivery_attempts a JOIN delivery_jobs j ON j.id=a.job
          WHERE j.account=? ORDER BY a.id DESC LIMIT 100`,account) };
    },
    write(user, action, data) {
      if (user.role !== 'owner') fail('Workspace owner access required.',403);
      const account = user.account;
      if (action === 'connection') {
        if (!providers.includes(data.provider) || typeof data.enabled !== 'boolean') fail('Choose a provider and enabled state.');
        const url = endpoint(required(data.endpoint,'endpoint'));
        const mode = data.mode || 'gateway';
        if (!['native','gateway'].includes(mode) || (mode==='native' && !nativeProviders.includes(data.provider))) fail('Choose a supported transport mode.');
        const prior = query('SELECT secret FROM integration_connections WHERE account=? AND provider=?',account,data.provider)[0];
        if (data.secret && (typeof data.secret!=='string' || data.secret.length>8000)) fail('Secret must be at most 8,000 characters.');
        const secret = data.clearSecret === true ? null : data.secret ? encrypt(data.secret) : prior?.secret ?? null;
        if (mode==='native') {
          let credentials;
          try { credentials = JSON.parse(secret ? decrypt(secret) : '{}'); } catch { fail('Native credentials must be a JSON object.'); }
          if (!credentials || Array.isArray(credentials) || typeof credentials!=='object') fail('Native credentials must be a JSON object.');
        }
        return transaction(()=>{
        run(`INSERT INTO integration_connections VALUES (?,?,?,?,?,?) ON CONFLICT(account,provider)
          DO UPDATE SET endpoint=excluded.endpoint,enabled=excluded.enabled,secret=excluded.secret,updated=excluded.updated`,
          account,data.provider,url,Number(data.enabled),secret,now());
        run('INSERT INTO integration_modes VALUES (?,?,?) ON CONFLICT(account,provider) DO UPDATE SET mode=excluded.mode',account,data.provider,mode);
        return { saved:true };
        });
      }
      if (action === 'test') return enqueue(account,data.provider,'test:'+randomUUID(),{type:'ringonyx.test',created:now()});
      if (action === 'enqueue') {
        let payload;
        try { payload = JSON.parse(data.payload); } catch { fail('Enter a valid JSON payload.'); }
        return enqueue(account,data.provider,required(data.reference,'reference'),payload);
      }
      if (action === 'retry' || action === 'cancel') {
        const id = required(data.id,'job');
        const [job] = query('SELECT state,provider,reference FROM delivery_jobs WHERE id=? AND account=?',id,account);
        if (!job) fail('Unknown delivery job.',404);
        if (['sending','delivered'].includes(job.state)) fail('This job cannot be changed.',409);
        if (action==='retry' && job.provider==='carrier' &&
            query("SELECT id FROM carrier_requests WHERE id=? AND state='canceled'",job.reference).length) {
          fail('Create a new carrier request after cancellation.',409);
        }
        if (action==='retry' && job.provider==='payouts' &&
            query('SELECT request FROM publisher_payout_cancellations WHERE request=?',job.reference).length) {
          fail('Create a new payout request after cancellation.',409);
        }
        run('UPDATE delivery_jobs SET state=?,available=?,error=NULL WHERE id=?',action === 'retry' ? 'queued':'canceled',now(),id);
        return { saved:true };
      }
      fail('Unknown delivery operation.',404);
    },
    async dispatch() {
      if ((options.enabled ?? process.env.RINGONYX_DELIVERY_ENABLED) !== 'true') return { sent:0,disabled:true };
      const allowed = (options.hosts ?? process.env.RINGONYX_DELIVERY_HOSTS ?? '').split(',').map(x=>x.trim()).filter(Boolean);
      const jobs = transaction(() => {
        run("UPDATE delivery_jobs SET state='queued',lease=NULL WHERE state='sending' AND lease<?",now());
        const rows = query("SELECT * FROM delivery_jobs WHERE state='queued' AND available<=? ORDER BY available LIMIT 10",now());
        for (const row of rows) {
          row.owner=randomUUID();
          run("UPDATE delivery_jobs SET state='sending',lease=? WHERE id=?",
            new Date(Date.parse(now())+120000).toISOString(),row.id);
          run('INSERT INTO delivery_leases VALUES (?,?) ON CONFLICT(job) DO UPDATE SET owner=excluded.owner',row.id,row.owner);
        }
        return rows;
      });
      let sent = 0;
      await Promise.all(jobs.map(async job => {
        let status = null;
        let error = null;
        let result = null;
        try {
          if (job.provider==='bidding') {
            const deadline=JSON.parse(job.payload).deadline;
            if (deadline && deadline<now()) throw Error('Bid deadline expired before dispatch.');
          }
          const [connection] = query('SELECT * FROM integration_connections WHERE account=? AND provider=? AND enabled=1',job.account,job.provider);
          if (!connection) throw Error('Provider connection is disabled or missing.');
          const url = new URL(connection.endpoint);
          if (!allowed.includes(url.hostname)) throw Error('Endpoint host is not in the server delivery allowlist.');
          const timestamp = String(Math.floor(Date.parse(now())/1000));
          const headers = { 'Content-Type':'application/json','Idempotency-Key':job.id,'X-Ringonyx-Timestamp':timestamp };
          const mode = query('SELECT mode FROM integration_modes WHERE account=? AND provider=?',job.account,job.provider)[0]?.mode || 'gateway';
          if (connection.secret && mode==='gateway') headers['X-Ringonyx-Signature'] = createHmac('sha256',decrypt(connection.secret))
            .update(timestamp+'.'+job.payload).digest('hex');
          const payload=JSON.parse(job.payload);
          const credentials=mode==='native' ? JSON.parse(connection.secret ? decrypt(connection.secret) : '{}') : null;
          const request=mode==='native' ? nativeRequest(job.provider,url.href,credentials,payload,{recording:id=>options.recording?.(job.account,id)}) : {url:url.href,method:'POST',headers,body:job.payload};
          if (!allowed.includes(new URL(request.url).hostname)) throw Error('Native API host is not in the server delivery allowlist.');
          const response = await (options.fetch || fetch)(request.url,{
            method:request.method,headers:{...request.headers,'Idempotency-Key':job.id},body:request.body,redirect:'error',signal:AbortSignal.timeout(job.provider==='bidding' ? Math.max(1,Math.min(10000,Date.parse(payload.deadline)-Date.parse(now()))) : 60000)
          });
          status = response.status;
          if (!response.ok) {await response.body?.cancel();throw Error('HTTP '+status);}
          if (mode==='native' && request.response==='json') {
            result=nativeResult(request,await readProviderJSON(response),payload,credentials);
          } else await response.body?.cancel();
        } catch (failure) { error = String(failure.message).slice(0,300); }
        const applied=transaction(() => {
          if (!query("SELECT j.id FROM delivery_jobs j JOIN delivery_leases l ON l.job=j.id WHERE j.id=? AND j.state='sending' AND l.owner=?",
            job.id,job.owner).length) return;
          if (!error && result) {
            try { transaction(()=>options.onResult?.(result,job.account)); }
            catch {error='Provider result could not be applied.';}
          }
          run('INSERT INTO delivery_attempts (job,status,error,created) VALUES (?,?,?,?)',job.id,status,error,now());
          const attempts = job.attempts+1;
          const state = error ? (attempts>=5 ? 'failed':'queued'):'delivered';
          run('UPDATE delivery_jobs SET state=?,attempts=?,error=?,lease=NULL,available=? WHERE id=?',
            state,attempts,error,new Date(Date.parse(now())+Math.min(3600000,30000*2**attempts)).toISOString(),job.id);
          run('DELETE FROM delivery_leases WHERE job=? AND owner=?',job.id,job.owner);
          return true;
        });
        if (applied && !error) sent++;
      }));
      return {sent,processed:jobs.length};
    }
  };
}
