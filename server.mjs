import { accountAccess, initializeAccounts, provision } from './accounts.mjs';
import { billing, initializeBilling } from './billing.mjs';
import { network } from './network.mjs';
import { routing } from './routing.mjs';
import { attribution } from './attribution.mjs';
import { communications } from './communications.mjs';
import { enableNumber, initializeVoice, voiceHandler } from './voice.mjs';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';

const path = process.env.RINGONYX_DB || 'data/ringonyx.sqlite';
if (!process.env.RINGONYX_DB) mkdirSync('data', { recursive: true });
const db = new DatabaseSync(path);
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS sites (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, number TEXT UNIQUE NOT NULL
  );
  CREATE TABLE IF NOT EXISTS renters (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, destination TEXT NOT NULL,
    portal TEXT UNIQUE NOT NULL
  );
  CREATE TABLE IF NOT EXISTS assignments (
    id TEXT PRIMARY KEY, site TEXT REFERENCES sites(id), renter TEXT REFERENCES renters(id),
    rate INTEGER NOT NULL, minimum INTEGER NOT NULL, started TEXT NOT NULL, ended TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS active_assignment ON assignments(site) WHERE ended IS NULL;
  CREATE TABLE IF NOT EXISTS calls (
    id TEXT PRIMARY KEY, site TEXT REFERENCES sites(id), assignment TEXT REFERENCES assignments(id),
    source TEXT NOT NULL, created TEXT NOT NULL, duration INTEGER, outcome TEXT
  );
  CREATE TABLE IF NOT EXISTS charges (
    call TEXT PRIMARY KEY REFERENCES calls(id), cents INTEGER NOT NULL
  );
`);
initializeAccounts(db);
initializeBilling(db);
initializeVoice(db);
if (process.argv[2] === '--enable-voice') {
  enableNumber(db, process.argv[3], process.argv[4]);
  db.close();
  process.exit(0);
}
if (process.argv[2] === '--provision') {
  const [email, role, mode, value] = process.argv.slice(3);
  if (!value || !['--new', '--account'].includes(mode)) throw Error('Usage: --provision EMAIL ROLE (--new NAME | --account ID)');
  const password = readFileSync(0, 'utf8').replace(/\r?\n$/, '');
  console.log('Workspace ID: ' + provision(db, { email, password, role, [mode === '--new' ? 'name' : 'account']: value }));
  db.close();
  process.exit(0);
}
const production = process.env.NODE_ENV === 'production';
const access = accountAccess(db, { secure: production });
const localKey = production ? undefined : process.env.RINGONYX_OPERATOR_KEY;
const now = () => new Date().toISOString();
const routes = {
  sites: `SELECT s.id, s.name, s.number, v.source AS voice_source
    FROM sites s LEFT JOIN voice_numbers v ON v.site=s.id WHERE s.account=? ORDER BY s.name`,
  renters: 'SELECT id, name, destination, portal FROM renters WHERE account=? ORDER BY name',
  assignments: 'SELECT a.* FROM assignments a JOIN sites s ON s.id=a.site WHERE s.account=? ORDER BY a.started DESC',
  calls: `SELECT c.*, s.name AS site_name, r.name AS renter_name,
    COALESCE(ch.cents, 0) AS cents, cc.sid IS NOT NULL AS carrier, ca.campaign, ca.number AS tracking_number,
    sr.destination AS simulated_destination, sr.menu_status AS simulated_menu_status,
    rd.disclosure AS simulated_disclosure, rd.decision AS simulated_recording_decision
    FROM calls c JOIN sites s ON s.id=c.site
    LEFT JOIN assignments a ON a.id=c.assignment LEFT JOIN renters r ON r.id=a.renter
    LEFT JOIN charges ch ON ch.call=c.id LEFT JOIN carrier_calls cc ON cc.call=c.id
    LEFT JOIN call_attribution ca ON ca.call=c.id LEFT JOIN simulated_routes sr ON sr.call=c.id
    LEFT JOIN simulated_recording_decisions rd ON rd.call=c.id`
};
const query = (sql, ...args) => db.prepare(sql).all(...args);
const run = (sql, ...args) => db.prepare(sql).run(...args);
function transaction(action) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
function required(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) fail('Invalid ' + label);
  return value.trim();
}
function phone(value) {
  if (!/^\+[1-9]\d{7,14}$/.test(value)) fail('Use a phone number in international format');
  return value;
}
function whole(value, max) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) fail('Numeric value out of range');
  return value;
}
function billingPeriod(value) {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) fail('Enter a billing month in YYYY-MM format.');
  return value;
}
async function readBody(req) {
  let input = '';
  for await (const part of req) {
    input += part;
    if (input.length > 16384) fail('Request too large', 413);
  }
  return input;
}
async function body(req) {
  const input = await readBody(req);
  let data;
  try { data = JSON.parse(input); } catch { fail('Invalid JSON'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('Expected a JSON object');
  return data;
}
function write(entity, data, account) {
  const id = randomUUID();
  if (entity === 'sites') {
    const number = phone(data.number);
    const name = required(data.name, 'site name');
    return transaction(() => {
      if (query('SELECT id FROM sites WHERE number=?', number).length || tracking.contains(number)) fail('Number already assigned', 409);
      run('INSERT INTO sites (id, name, number, account) VALUES (?, ?, ?, ?)', id, name, number, account);
      return { id };
    });
  }
  if (entity === 'renters') {
    run('INSERT INTO renters (id, name, destination, portal, account) VALUES (?, ?, ?, ?, ?)', id, required(data.name, 'renter name'), phone(data.destination), randomUUID(), account);
    return { id };
  }
  if (entity === 'assignments') {
    const site = required(data.site, 'site');
    const renter = required(data.renter, 'renter');
    if (!query('SELECT id FROM sites WHERE id=? AND account=?', site, account).length ||
        !query('SELECT id FROM renters WHERE id=? AND account=?', renter, account).length) fail('Unknown site or renter', 404);
    const rate = whole(data.rate, 1000000);
    const minimum = whole(data.minimum, 86400);
    const at = now();
    return transaction(() => {
      run('UPDATE assignments SET ended=? WHERE site=? AND ended IS NULL', at, site);
      run('INSERT INTO assignments VALUES (?, ?, ?, ?, ?, ?, NULL)', id, site, renter, rate, minimum, at);
      return { id };
    });
  }
  if (entity === 'calls') {
    const number = phone(data.number);
    return transaction(() => {
      const match = tracking.resolve(account, number);
      if (match) {
        const call = simulate(match, match.source ?? 'Unattributed', account, data);
        tracking.snapshot(call.id, number, match);
        return call;
      }
      const [site] = query('SELECT id FROM sites WHERE number=? AND account=?', number, account);
      if (!site) fail('Unknown tracking number', 404);
      return simulate(site, required(data.source, 'source'), account, data);
    });
  }
  fail('Unknown endpoint', 404);
}
function simulate(site, source, account, data) {
  const decision = routingPlans.preview(account, site.id, data.failed ?? [], data.digit);
  const destination = decision.next?.destination ?? null;
  const [assignment] = destination ? query(`SELECT a.id FROM assignments a JOIN renters r ON r.id=a.renter
    WHERE a.site=? AND a.ended IS NULL AND r.destination=?`, site.id, destination) : [];
  const id = randomUUID();
  run('INSERT INTO calls VALUES (?, ?, ?, ?, ?, NULL, ?)', id, site.id, assignment?.id ?? null,
    source, now(), destination ? 'pending' : 'unrouted');
  routingPlans.snapshot(id, decision);
  const recording = comms.simulateRecording(id, site.id, destination, data.recordingConsent);
  return { id, destination, recording };
}
function arrive(site, source, live = false) {
  const [assignment] = query(`SELECT a.id, r.destination FROM assignments a
    JOIN renters r ON r.id=a.renter WHERE a.site=? AND a.ended IS NULL
    AND (?=0 OR NOT EXISTS (
      SELECT 1 FROM voice_numbers v JOIN sites target ON target.id=v.site WHERE target.number=r.destination
    ))`, site.id, Number(live));
  const id = randomUUID();
  run('INSERT INTO calls VALUES (?, ?, ?, ?, ?, NULL, ?)', id, site.id,
    assignment?.id ?? null, source, now(), assignment ? 'pending' : 'unrouted');
  return { id, destination: assignment?.destination ?? null };
}
function complete(id, data, account) {
  const duration = whole(data.duration, 86400);
  if (!['answered', 'missed'].includes(data.outcome)) fail('Invalid outcome');
  const [call] = query(`SELECT c.*, a.rate, a.minimum, COALESCE(ch.cents, 0) AS cents
    FROM calls c LEFT JOIN assignments a ON a.id=c.assignment
    LEFT JOIN charges ch ON ch.call=c.id JOIN sites s ON s.id=c.site WHERE c.id=? AND s.account=?`, id, account);
  if (!call) fail('Unknown call', 404);
  if (call.outcome === data.outcome && call.duration === duration) return { cents: call.cents };
  if (call.outcome !== 'pending') fail('Call cannot be finalized', 409);
  const cents = call.assignment && data.outcome === 'answered' && duration >= call.minimum ? call.rate : 0;
  run('UPDATE calls SET outcome=?, duration=? WHERE id=?', data.outcome, duration, id);
  if (cents) run('INSERT INTO charges VALUES (?, ?)', id, cents);
  return { cents };
}
const handleVoice = voiceHandler({
  query, run, transaction, arrive, complete, fail, readBody,
  config: { token: process.env.TWILIO_AUTH_TOKEN, sid: process.env.TWILIO_ACCOUNT_SID, base: process.env.RINGONYX_VOICE_ORIGIN }
});
const invoices = billing({ query, run, transaction, id: randomUUID, now, fail });
const exchange = network(db, { query, run, transaction, fail, required, whole, phone, now });
const routingPlans = routing(db, { query, run, transaction, required, phone, fail });
const tracking = attribution(db, { query, run, transaction, fail, phone });
const comms = communications(db, { query, run, fail, required, phone, now });
const assets = {
  '/': ['home.html', 'text/html'],
  '/home.css': ['home.css', 'text/css'],
  '/home.js': ['home.js', 'text/javascript'],
  '/tracking.js': ['tracking.js', 'text/javascript'],
  '/ringonyx-mark.svg': ['ringonyx-mark.svg', 'image/svg+xml'],
  '/ringonyx-icons.svg': ['ringonyx-icons.svg', 'image/svg+xml'],
  '/brand.css': ['brand.css', 'text/css'],
  '/brand/favicons/favicon-32.png': ['brand/favicons/favicon-32.png', 'image/png'],
  '/brand/favicons/favicon-180.png': ['brand/favicons/favicon-180.png', 'image/png'],
  '/app': ['index.html', 'text/html'],
  '/network': ['index.html', 'text/html'],
  '/communications': ['index.html', 'text/html'],
  '/partner': ['index.html', 'text/html'],
  '/portal': ['index.html', 'text/html'],
  '/app.js': ['app.js', 'text/javascript'],
  '/style.css': ['style.css', 'text/css']
};
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const json = (data, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    const visitor = /^\/tracking\/([\w-]+)$/.exec(pathname);
    if (visitor && req.method === 'POST') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      return json(tracking.lease(visitor[1], await body(req)));
    }
    if (await handleVoice(req, res, pathname)) return;
    if (req.method === 'POST' && req.headers.origin) {
      const expectedOrigin = (production ? 'https://' : 'http://') + req.headers.host;
      if (req.headers.origin !== expectedOrigin) fail('Request origin does not match this site.', 403);
    }
    if (req.method === 'GET' && Object.hasOwn(assets, pathname)) {
      const [file, type] = assets[pathname];
      res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' });
      return res.end(readFileSync(new URL('./public/' + file, import.meta.url)));
    }
    const portal = /^\/api\/portal\/([\w-]+)$/.exec(pathname);
    const partner = /^\/api\/network-portal\/(buyer|publisher)\/([\w-]+)$/.exec(pathname);
    if (req.method === 'GET' && partner) return json(exchange.portal(partner[1], partner[2]));
    const publisherRequest = /^\/api\/publisher\/(ping|post)$/.exec(pathname);
    if (req.method === 'POST' && publisherRequest) {
      const token = /^Bearer ([\w-]+)$/.exec(req.headers.authorization || '')?.[1];
      if (!token) fail('Publisher credentials required.', 401);
      return json(exchange.publisherRequest(token, publisherRequest[1], await body(req)));
    }
    if (req.method === 'GET' && portal) {
      const [renter] = query('SELECT id, name FROM renters WHERE portal=?', portal[1]);
      if (!renter) fail('Portal link not found', 404);
      return json({ renter: renter.name, invoices: invoices.forRenter(renter.id), calls: query(routes.calls + ' WHERE a.renter=? AND s.account=(SELECT account FROM renters WHERE id=?) ORDER BY c.created DESC', renter.id, renter.id) });
    }
    if (req.method === 'POST' && pathname === '/api/login') {
      return json(access.login(req, res, await body(req), fail));
    }
    if (req.method === 'POST' && pathname === '/api/logout') {
      access.logout(req, res);
      return json({ signedOut: true });
    }
    const user = access.session(req) || (localKey && req.headers['x-ringonyx-operator'] === localKey
      ? { account: 'legacy', role: 'owner', workspace: 'Original workspace' } : null);
    if (!user) fail('Sign in to continue.', 401);
    if (req.method === 'GET' && pathname === '/api/session') {
      return json({ email: user.email, role: user.role, workspace: user.workspace });
    }
    if (req.method === 'POST' && user.role === 'viewer') fail('This account has read-only access.', 403);
    if (req.method === 'GET' && pathname === '/api/communications') return json(comms.list(user.account));
    if (req.method === 'POST' && pathname.startsWith('/api/communications/')) {
      return json(comms.write(user.account, pathname.slice('/api/communications/'.length), await body(req)));
    }
    if (pathname === '/api/tracking-pool') {
      if (req.method === 'GET') return json(tracking.list(user.account));
      if (req.method === 'POST') {
        const data = await body(req);
        return json(tracking.add(user.account, required(data.site, 'site'), data.number), 201);
      }
      fail('Method not allowed.', 405);
    }
    if (req.method === 'GET' && pathname === '/api/routing') return json(routingPlans.list(user.account));
    if (pathname === '/api/routing/menu') {
      if (req.method === 'GET') return json(routingPlans.menus(user.account));
      if (req.method === 'POST') {
        const data = await body(req);
        return json(routingPlans.saveMenu(user.account, required(data.site, 'site'), data));
      }
      fail('Method not allowed.', 405);
    }
    if (req.method === 'POST' && ['/api/routing', '/api/routing/preview'].includes(pathname)) {
      const data = await body(req);
      const site = required(data.site, 'site');
      return json(pathname.endsWith('/preview') ? routingPlans.preview(user.account, site, data.failed ?? [], data.digit)
        : routingPlans.save(user.account, site, data.routes));
    }
    if (req.method === 'GET' && pathname === '/api/network') return json(exchange.list(user.account, user.role));
    if (req.method === 'POST' && pathname.startsWith('/api/network/')) {
      return json(exchange.write(user.account, pathname.slice('/api/network/'.length), await body(req)));
    }
    if (pathname === '/api/rental-rates' && req.method === 'POST') {
      const data = await body(req);
      return json(invoices.setRent(user.account, required(data.renter, 'renter'),
        billingPeriod(data.period), whole(data.cents, 1_000_000_000)));
    }
    if (pathname === '/api/invoice-entries' && req.method === 'POST') {
      const data = await body(req);
      const cents = whole(data.cents, 1_000_000_000);
      if (!cents || !['payment', 'credit'].includes(data.kind)) fail('Choose a payment or credit and enter a positive amount.');
      const reference = required(data.reference, 'reference');
      if (reference.startsWith('dispute:')) fail('Choose a different reference.');
      return json(invoices.apply(user.account, required(data.invoice, 'invoice'), { cents, kind: data.kind, reference }));
    }
    if (pathname === '/api/bookings') {
      if (req.method === 'GET') return json(invoices.bookings(user.account));
      if (req.method === 'POST') {
        const data = await body(req);
        const cents = whole(data.cents, 1_000_000_000);
        if (!cents) fail('Enter a positive booking charge.');
        return json(invoices.verifyBooking(user.account, user.email ?? 'local operator', {
          call: required(data.call, 'call'), reference: required(data.reference, 'booking reference'),
          evidence: required(data.evidence, 'verification evidence'), cents
        }), 201);
      }
      fail('Method not allowed.', 405);
    }
    if (pathname === '/api/disputes') {
      if (req.method === 'GET') return json(invoices.disputes(user.account));
      if (req.method === 'POST') {
        const data = await body(req);
        return json(invoices.openDispute(user.account, required(data.invoice, 'invoice'), required(data.reason, 'reason')), 201);
      }
      fail('Method not allowed.', 405);
    }
    if (pathname === '/api/disputes/resolve' && req.method === 'POST') {
      const data = await body(req);
      return json(invoices.resolveDispute(user.account, required(data.dispute, 'dispute'),
        required(data.resolution, 'resolution'), whole(data.cents, 1_000_000_000)));
    }
    if (pathname === '/api/invoices') {
      if (req.method === 'GET') return json(invoices.list(user.account));
      if (req.method === 'POST') {
        const data = await body(req);
        const period = data.period === '' || data.period === undefined ? null : billingPeriod(data.period);
        return json(invoices.create(user.account, required(data.renter, 'renter'), period), 201);
      }
      fail('Method not allowed.', 405);
    }
    if (req.method === 'POST' && pathname === '/api/voice/numbers') {
      const data = await body(req);
      const site = required(data.site, 'site');
      const source = required(data.source, 'source');
      if (!query('SELECT id FROM sites WHERE id=? AND account=?', site, user.account).length) {
        fail('Unknown site.', 404);
      }
      enableNumber(db, site, source);
      return json({ site, source });
    }
    const done = /^\/api\/calls\/([\w-]+)\/complete$/.exec(pathname);
    if (req.method === 'POST' && done) {
      const data = await body(req);
      return json(transaction(() => {
        if (query('SELECT call FROM carrier_calls WHERE call=?', done[1]).length) fail('Unknown simulated call', 404);
        return complete(done[1], data, user.account);
      }));
    }
    const entity = pathname.split('/')[2];
    if (pathname !== '/api/' + entity || !Object.hasOwn(routes, entity)) fail('Unknown endpoint', 404);
    if (req.method === 'GET') {
      const sql = entity === 'renters' && user.role === 'viewer'
        ? 'SELECT id, name, destination FROM renters WHERE account=? ORDER BY name'
        : routes[entity];
      return json(query(sql + (entity === 'calls' ? ' WHERE s.account=? ORDER BY c.created DESC' : ''), user.account));
    }
    if (req.method === 'POST') return json(write(entity, await body(req), user.account), 201);
    fail('Method not allowed', 405);
  } catch (error) {
    if (!error.status) console.error(error);
    json({ error: error.status ? error.message : 'Internal server error' }, error.status || 500);
  }
});
server.listen(Number(process.env.PORT ?? 3000), '127.0.0.1', () => {
  console.log('Ringonyx listening on http://127.0.0.1:' + server.address().port);
});
