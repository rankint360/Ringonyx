import { accountAccess, initializeAccounts, provision } from './accounts.mjs';
import { billing, initializeBilling } from './billing.mjs';
import { network } from './network.mjs';
import { webLeads } from './leads.mjs';
import { analytics } from './analytics.mjs';
import { operations, csvExport } from './operations.mjs';
import { routing } from './routing.mjs';
import { attribution } from './attribution.mjs';
import { communications } from './communications.mjs';
import { enableNumber, initializeVoice, voiceHandler } from './voice.mjs';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';

const path = process.env.RINGONYX_DB || 'data/ringonyx.sqlite';
if (process.argv[2] === '--backup') {
  const destination = process.argv[3];
  if (!destination) throw Error('Provide a new backup path.');
  const source = new DatabaseSync(path, { readOnly: true });
  try {
    writeFileSync(destination, '', { flag: 'wx', mode: 0o600 });
    try {
      source.prepare('VACUUM INTO ?').run(destination);
    } catch (error) {
      unlinkSync(destination);
      throw error;
    }
  } finally {
    source.close();
  }
  console.log('Backup written.');
  process.exit(0);
}
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
    CREATE TABLE IF NOT EXISTS call_completion_times (call TEXT PRIMARY KEY REFERENCES calls(id), created TEXT NOT NULL);
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
    COALESCE(ch.cents, 0) AS cents, a.minimum AS qualification_minimum, a.rate AS agreed_rate,
    il.invoice, cc.sid IS NOT NULL AS carrier, ca.campaign, ca.number AS tracking_number,
    sr.destination AS simulated_destination, sr.menu_status AS simulated_menu_status, sr.steps AS routing_steps,
    rd.disclosure AS simulated_disclosure, rd.decision AS simulated_recording_decision
    FROM calls c JOIN sites s ON s.id=c.site
    LEFT JOIN assignments a ON a.id=c.assignment LEFT JOIN renters r ON r.id=a.renter
    LEFT JOIN charges ch ON ch.call=c.id LEFT JOIN invoice_lines il ON il.call=c.id
    LEFT JOIN carrier_calls cc ON cc.call=c.id
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
  if (typeof value !== 'string' || !/^\+[1-9]\d{7,14}$/.test(value)) fail('Use a phone number in international format');
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
  const decoder = new StringDecoder('utf8');
  let bytes = 0;
  let input = '';
  for await (const part of req.iterator({ destroyOnReturn: false })) {
    bytes += part.length;
    if (bytes > 16384) {
      req.resume();
      fail('Request too large', 413);
    }
    input += decoder.write(part);
  }
  return input + decoder.end();
}
async function body(req) {
  const input = await readBody(req);
  let data;
  try { data = JSON.parse(input); } catch { fail('Invalid JSON'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('Expected a JSON object');
  return data;
}
function addSite(account, data) {
  const number = phone(data.number);
  const name = required(data.name, 'site name');
  if (query('SELECT id FROM sites WHERE number=?', number).length || tracking.contains(number)) fail('Number already assigned', 409);
  const id = randomUUID();
  run('INSERT INTO sites (id, name, number, account) VALUES (?, ?, ?, ?)', id, name, number, account);
  return { id };
}
function write(entity, data, account) {
  const id = randomUUID();
  if (entity === 'sites') return transaction(() => addSite(account, data));
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
  const decision = routingPlans.preview(account, site.id, data.failed ?? [], data.digit, data.scenario);
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
  run('INSERT INTO call_completion_times VALUES (?, ?)', id, now());
  if (cents) run('INSERT INTO charges VALUES (?, ?)', id, cents);
  return { cents };
}
const handleVoice = voiceHandler({
  query, run, transaction, arrive, complete, fail, readBody,
  config: { token: process.env.TWILIO_AUTH_TOKEN, sid: process.env.TWILIO_ACCOUNT_SID, base: process.env.RINGONYX_VOICE_ORIGIN }
});
const invoices = billing({ query, run, transaction, id: randomUUID, now, fail });
const exchange = network(db, { query, run, transaction, fail, required, whole, phone, now });
const leads = webLeads(db, { query, run, transaction, required, phone, whole, fail, now });
const routingPlans = routing(db, { query, run, transaction, required, phone, fail });
const tracking = attribution(db, { query, run, transaction, fail, phone });
const comms = communications(db, { query, run, fail, required, phone, now });
const insights = analytics(db, { query, run, required, fail, now });
const ops = operations(db, { query, run, transaction, required, fail, now, addSite,
  readSites: account => query(routes.sites, account),
  campaigns: account => insights.report(account).campaigns });
const assets = {
  '/call': ['index.html', 'text/html'],
  '/activity': ['index.html', 'text/html'],
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
  '/leads': ['index.html', 'text/html'],
  '/analytics': ['index.html', 'text/html'],
  '/operations': ['index.html', 'text/html'],
  '/intake': ['intake.html', 'text/html'],
  '/intake.js': ['intake.js', 'text/javascript'],
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
    if (req.method === 'GET' && pathname === '/health') {
      query('SELECT 1');
      return json({ status: 'ok' });
    }
    if (req.method === 'GET' && ['/api/v1/sites', '/api/v1/campaigns', '/api/v1/scopes'].includes(pathname)) {
      return json(ops.resource(req, pathname === '/api/v1/scopes' ? null : pathname.split('/').at(-1)));
    }
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
    if (req.method === 'POST' && pathname === '/api/renter-accept') {
      const data = await body(req);
      return json(access.accept(required(data.invite, 'invitation'), data.password, fail));
    }
    const partner = /^\/api\/network-portal\/(buyer|publisher)\/([\w-]+)$/.exec(pathname);
    if (req.method === 'POST' && partner?.[1] === 'buyer') {
      return json(exchange.buyerDispute(partner[2], await body(req)));
    }
    if (req.method === 'GET' && partner) {
      const result = exchange.portal(partner[1], partner[2]);
      const table = partner[1] === 'buyer' ? 'buyers' : 'publisher_offers';
      const [workspace] = query('SELECT account FROM ' + table + ' WHERE token=?', partner[2]);
      result.brand = ops.brand(workspace.account);
      if (partner[1] === 'buyer') result.leads = leads.buyerInbox(partner[2]);
      return json(result);
    }
    const intake = /^\/api\/intake\/([\w-]+)$/.exec(pathname);
    if (req.method === 'POST' && intake) return json(leads.capturePublic(intake[1], await body(req)), 202);
    const publisherRequest = /^\/api\/publisher\/(ping|post)$/.exec(pathname);
    if (req.method === 'POST' && publisherRequest) {
      const token = /^Bearer ([\w-]+)$/.exec(req.headers.authorization || '')?.[1];
      if (!token) fail('Publisher credentials required.', 401);
      return json(exchange.publisherRequest(token, publisherRequest[1], await body(req)));
    }
    if (req.method === 'GET' && (portal || pathname === '/api/renter-portal')) {
      const renterId = access.session(req)?.renter;
      if (!portal && !renterId) fail('Sign in as a renter to continue.', 401);
      const [renter] = portal ? query('SELECT id, name, account FROM renters WHERE portal=?', portal[1])
        : query('SELECT id, name, account FROM renters WHERE id=?', renterId);
      if (!renter) fail('Portal link not found', 404);
      const calls = query(routes.calls + ' WHERE a.renter=? AND s.account=? ORDER BY c.created DESC', renter.id, renter.account);
      for (const call of calls) delete call.routing_steps;
      return json({ renter: renter.name, brand: ops.brand(renter.account), invoices: invoices.forRenter(renter.id), calls });
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
      return json({ email: user.email, role: user.renter ? 'renter' : user.role, workspace: user.workspace });
    }
    if (req.method === 'POST' && user.role === 'viewer') fail('This account has read-only access.', 403);
    if (user.renter) fail('Use your renter portal.', 403);
    if (req.method === 'GET' && pathname === '/api/call-detail') {
      const id = required(new URL(req.url, 'http://localhost').searchParams.get('id'), 'call');
      const [call] = query(routes.calls + ' WHERE s.account=? AND c.id=?', user.account, id);
      if (!call) fail('Unknown call.', 404);
      return json(call);
    }
    if (req.method === 'GET' && pathname === '/api/activity') {
      return json(query(`WITH scope(account) AS (VALUES (?))
        SELECT c.created AS time, 'Call received' AS event, c.id AS reference, c.source AS detail, NULL AS cents, 'call' AS channel
          FROM calls c JOIN sites s ON s.id=c.site JOIN scope x ON x.account=s.account
        UNION ALL SELECT t.created, 'Call completed', c.id, c.outcome, ch.cents, 'call'
          FROM call_completion_times t JOIN calls c ON c.id=t.call JOIN sites s ON s.id=c.site
          JOIN scope x ON x.account=s.account LEFT JOIN charges ch ON ch.call=c.id
        UNION ALL SELECT i.created, 'Renter call invoiced', l.call, i.id, l.cents, 'call'
          FROM invoice_lines l JOIN invoices i ON i.id=l.invoice JOIN scope x ON x.account=i.account
        UNION ALL SELECT e.created, 'Renter invoice ' || e.kind, i.id, e.reference, e.cents, 'invoice'
          FROM invoice_entries e JOIN invoices i ON i.id=e.invoice JOIN scope x ON x.account=i.account
        UNION ALL SELECT b.created, 'Booking verified', b.call, b.reference, b.cents, 'call'
          FROM booking_charges b JOIN scope x ON x.account=b.account
        UNION ALL SELECT l.created, 'Web lead captured', l.id, l.source, NULL, 'web'
          FROM web_leads l JOIN sites s ON s.id=l.site JOIN scope x ON x.account=s.account
        UNION ALL SELECT d.created, 'Web lead delivered', l.id, b.name, d.cents, 'web'
          FROM lead_deliveries d JOIN web_leads l ON l.id=d.lead JOIN sites s ON s.id=l.site
          JOIN scope x ON x.account=s.account JOIN buyers b ON b.id=d.buyer
        UNION ALL SELECT c.created, 'Network routing decision', c.id, d.reason, d.bid, 'network'
          FROM network_calls c JOIN scope x ON x.account=c.account LEFT JOIN network_decisions d ON d.call=c.id
        UNION ALL SELECT t.created, 'Network call settled', c.id, c.outcome, c.revenue, 'network'
          FROM network_settlement_times t JOIN network_calls c ON c.id=t.call JOIN scope x ON x.account=c.account
        UNION ALL SELECT t.created, 'Publisher payout accrued', c.id, o.name, c.payout, 'network'
          FROM network_settlement_times t JOIN network_calls c ON c.id=t.call JOIN scope x ON x.account=c.account
          JOIN publisher_offers o ON o.id=c.offer WHERE c.payout>0
        UNION ALL SELECT e.created, 'Buyer prepaid deposit', b.id, e.reference, e.cents, 'buyer'
          FROM network_buyer_credit e JOIN buyers b ON b.id=e.buyer JOIN scope x ON x.account=b.account
        UNION ALL SELECT i.created, 'Network call invoiced', c.id, i.id, l.cents, 'network'
          FROM network_invoice_lines l JOIN network_invoices i ON i.id=l.invoice
          JOIN network_calls c ON c.id=l.call JOIN scope x ON x.account=c.account
        UNION ALL SELECT e.created, 'Buyer invoice ' || e.kind, i.id, e.reference, e.cents, 'invoice'
          FROM network_invoice_entries e JOIN network_invoices i ON i.id=e.invoice
          JOIN buyers b ON b.id=i.buyer JOIN scope x ON x.account=b.account
        ORDER BY time DESC, channel, reference, event LIMIT 200`, user.account));
    }
    if (req.method === 'POST' && pathname.startsWith('/api/')) {
      res.once('finish', () => {
        if (res.statusCode >= 300) return;
        try { ops.audit(user, pathname.replace(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi, ':id')); }
        catch (error) { console.error('Audit record failed:', error.message); }
      });
    }
    if (req.method === 'POST' && pathname === '/api/renter-invite') {
      if (user.role !== 'owner') fail('Workspace owner access required.', 403);
      const data = await body(req);
      return json(access.invite(user.account, required(data.renter, 'renter'), data.email, fail));
    }
    if (req.method === 'GET' && pathname === '/api/operations') return json(ops.read(user.account));
    if (req.method === 'POST' && pathname.startsWith('/api/operations/')) {
      return json(ops.write(user, pathname.slice('/api/operations/'.length), await body(req)));
    }
    if (req.method === 'GET' && ['/api/exports/crm.csv', '/api/exports/conversions.csv'].includes(pathname)) {
      const crm = pathname.endsWith('/crm.csv');
      const rows = crm ? leads.list(user.account) : insights.report(user.account).calls.filter(call => call.bookings > 0 || call.cents > 0);
      const fields = crm ? ['id', 'name', 'email', 'phone', 'source', 'campaign', 'channel', 'delivered']
        : ['id', 'created', 'source', 'campaign', 'cents', 'bookings'];
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="' + (crm ? 'crm.csv' : 'conversions.csv') + '"' });
      return res.end(csvExport(rows, fields));
    }
    if (req.method === 'GET' && pathname === '/api/analytics') {
      return json({ ...insights.report(user.account), invoices: invoices.list(user.account).map(({ cents, applied }) => ({ cents, applied })) });
    }
    if (req.method === 'POST' && pathname.startsWith('/api/analytics/')) {
      const data = await body(req);
      if (pathname.endsWith('/analyze')) return json(insights.analyze(user.account, data));
      if (pathname.endsWith('/review')) return json(insights.saveReview(user.account, user.email ?? 'local operator', data));
      if (pathname.endsWith('/profile')) return json(insights.profile(user.account, data));
      if (pathname.endsWith('/simulate')) return json(insights.simulate(user.account, data));
      fail('Unknown analytics operation.', 404);
    }
    if (req.method === 'GET' && pathname === '/api/leads') {
      return json({ leads: leads.list(user.account), quotes: leads.quotes(user.account),
        callSources: query(`SELECT c.source, COUNT(*) AS count FROM calls c
          JOIN sites s ON s.id=c.site WHERE s.account=? GROUP BY c.source`, user.account) });
    }
    if (req.method === 'POST' && pathname.startsWith('/api/leads/')) {
      const data = await body(req);
      if (pathname === '/api/leads/capture') return json(leads.capture(user.account, data));
      if (pathname === '/api/leads/ping') return json(leads.ping(user.account, data));
      if (pathname === '/api/leads/direct') return json(leads.deliver(user.account, data, 'direct'));
      if (pathname === '/api/leads/post') return json(leads.deliver(user.account, data, 'quoted'));
      fail('Unknown lead operation.', 404);
    }
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
      return json(pathname.endsWith('/preview') ? routingPlans.preview(user.account, site, data.failed ?? [], data.digit, data.scenario)
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
    if (req.method === 'POST' && pathname === '/api/voice/setup') {
      const data = await body(req);
      const source = required(data.source, 'source');
      return json(transaction(() => {
        const site = addSite(user.account, data);
        enableNumber(db, site.id, source);
        return { ...site, source };
      }), 201);
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
const host = process.env.RINGONYX_HOST || '127.0.0.1';
server.listen(Number(process.env.PORT ?? 3000), host, () => {
  console.log('Ringonyx listening on http://' + host + ':' + server.address().port);
});
