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
const now = () => new Date().toISOString();
const routes = {
  sites: 'SELECT * FROM sites ORDER BY name',
  renters: 'SELECT * FROM renters ORDER BY name',
  assignments: 'SELECT * FROM assignments WHERE ended IS NULL',
  calls: `SELECT c.*, s.name AS site_name, r.name AS renter_name,
    COALESCE(ch.cents, 0) AS cents FROM calls c JOIN sites s ON s.id=c.site
    LEFT JOIN assignments a ON a.id=c.assignment LEFT JOIN renters r ON r.id=a.renter
    LEFT JOIN charges ch ON ch.call=c.id`
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
async function body(req) {
  let input = '';
  for await (const part of req) {
    input += part;
    if (input.length > 16384) fail('Request too large', 413);
  }
  let data;
  try { data = JSON.parse(input); } catch { fail('Invalid JSON'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('Expected a JSON object');
  return data;
}
function write(entity, data) {
  const id = randomUUID();
  if (entity === 'sites') {
    const number = phone(data.number);
    if (query('SELECT id FROM sites WHERE number=?', number).length) fail('Number already assigned', 409);
    run('INSERT INTO sites VALUES (?, ?, ?)', id, required(data.name, 'site name'), number);
    return { id };
  }
  if (entity === 'renters') {
    run('INSERT INTO renters VALUES (?, ?, ?, ?)', id, required(data.name, 'renter name'), phone(data.destination), randomUUID());
    return { id };
  }
  if (entity === 'assignments') {
    const site = required(data.site, 'site');
    const renter = required(data.renter, 'renter');
    if (!query('SELECT id FROM sites WHERE id=?', site).length ||
        !query('SELECT id FROM renters WHERE id=?', renter).length) fail('Unknown site or renter', 404);
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
    const [site] = query('SELECT id FROM sites WHERE number=?', phone(data.number));
    if (!site) fail('Unknown tracking number', 404);
    const [assignment] = query(`SELECT a.id, r.destination FROM assignments a
      JOIN renters r ON r.id=a.renter WHERE a.site=? AND a.ended IS NULL`, site.id);
    run('INSERT INTO calls VALUES (?, ?, ?, ?, ?, NULL, ?)', id, site.id,
      assignment?.id ?? null, required(data.source, 'source'), now(), assignment ? 'pending' : 'unrouted');
    return { id, destination: assignment?.destination ?? null };
  }
  fail('Unknown endpoint', 404);
}
function complete(id, data) {
  const duration = whole(data.duration, 86400);
  if (!['answered', 'missed'].includes(data.outcome)) fail('Invalid outcome');
  return transaction(() => {
    const [call] = query(`SELECT c.*, a.rate, a.minimum, COALESCE(ch.cents, 0) AS cents
      FROM calls c LEFT JOIN assignments a ON a.id=c.assignment
      LEFT JOIN charges ch ON ch.call=c.id WHERE c.id=?`, id);
    if (!call) fail('Unknown call', 404);
    if (call.outcome === data.outcome && call.duration === duration) return { cents: call.cents };
    if (call.outcome !== 'pending') fail('Call cannot be finalized', 409);
    const cents = data.outcome === 'answered' && duration >= call.minimum ? call.rate : 0;
    run('UPDATE calls SET outcome=?, duration=? WHERE id=?', data.outcome, duration, id);
    if (cents) run('INSERT INTO charges VALUES (?, ?)', id, cents);
    return { cents };
  });
}
const assets = {
  '/': ['index.html', 'text/html'],
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
    if (req.method === 'GET' && Object.hasOwn(assets, pathname)) {
      const [file, type] = assets[pathname];
      res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' });
      return res.end(readFileSync(new URL('./public/' + file, import.meta.url)));
    }
    const portal = /^\/api\/portal\/([\w-]+)$/.exec(pathname);
    if (req.method === 'GET' && portal) {
      const [renter] = query('SELECT id, name FROM renters WHERE portal=?', portal[1]);
      if (!renter) fail('Portal link not found', 404);
      return json({ renter: renter.name, calls: query(routes.calls + ' WHERE a.renter=? ORDER BY c.created DESC', renter.id) });
    }
    if (req.headers['x-ringonyx-operator'] !== (process.env.RINGONYX_OPERATOR_KEY || 'local-demo')) fail('Operator key required', 401);
    const done = /^\/api\/calls\/([\w-]+)\/complete$/.exec(pathname);
    if (req.method === 'POST' && done) return json(complete(done[1], await body(req)));
    const entity = pathname.split('/')[2];
    if (pathname !== '/api/' + entity || !Object.hasOwn(routes, entity)) fail('Unknown endpoint', 404);
    if (req.method === 'GET') return json(query(routes[entity] + (entity === 'calls' ? ' ORDER BY c.created DESC' : '')));
    if (req.method === 'POST') return json(write(entity, await body(req)), 201);
    fail('Method not allowed', 405);
  } catch (error) {
    if (!error.status) console.error(error);
    json({ error: error.status ? error.message : 'Internal server error' }, error.status || 500);
  }
});
server.listen(Number(process.env.PORT ?? 3000), '127.0.0.1', () => {
  console.log('Ringonyx listening on http://127.0.0.1:' + server.address().port);
});
