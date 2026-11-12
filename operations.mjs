import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
const hash = value => createHash('sha256').update(value).digest('hex');
const resources = ['sites', 'campaigns'];
export function operations(db, { query, run, transaction, required, fail, now, readSites, campaigns, addSite }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS developer_keys (
      id TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id), digest TEXT UNIQUE NOT NULL,
      scope TEXT NOT NULL, created TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspace_brand (
      account TEXT PRIMARY KEY REFERENCES accounts(id), name TEXT NOT NULL, accent TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspace_audit (
      id TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id), actor TEXT NOT NULL,
      operation TEXT NOT NULL, created TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS workspace_audit_account ON workspace_audit(account, created);
    CREATE TABLE IF NOT EXISTS webhook_signing (
      account TEXT PRIMARY KEY REFERENCES accounts(id), secret TEXT NOT NULL
    );
  `);
  function owner(user) {
    if (user.role !== 'owner') fail('Workspace owner access required.', 403);
  }
  return {
    audit(user, operation) {
      run('INSERT INTO workspace_audit VALUES (?, ?, ?, ?, ?)', randomUUID(), user.account,
        user.email ?? 'local operator', operation, now());
    },
    brand(account) {
      return query('SELECT name, accent FROM workspace_brand WHERE account=?', account)[0] ?? null;
    },
    read(account) {
      return {
        keys: query('SELECT id, scope, created FROM developer_keys WHERE account=? ORDER BY created DESC', account),
        brand: this.brand(account),
        audit: query('SELECT id, actor, operation, created FROM workspace_audit WHERE account=? ORDER BY created DESC, id LIMIT 100', account)
      };
    },
    resource(req, resource) {
      const token = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization ?? '')?.[1];
      if (!token) fail('Developer token required.', 401);
      const [key] = query('SELECT account, scope FROM developer_keys WHERE digest=?', hash(token));
      if (!key) fail('Invalid developer token.', 401);
      if (!resource) return { resources: [key.scope] };
      if (key.scope !== resource) fail('Token does not grant this scope.', 403);
      return resource === 'sites' ? readSites(key.account) : campaigns(key.account);
    },
    write(user, action, data) {
      owner(user);
      const { account } = user;
      if (action === 'key') {
        if (!resources.includes(data.scope)) fail('Choose a valid read scope.');
        const token = randomBytes(32).toString('hex');
        const id = randomUUID();
        run('INSERT INTO developer_keys VALUES (?, ?, ?, ?, ?)', id, account, hash(token), data.scope, now());
        return { id, token };
      }
      if (action === 'revoke') {
        if (!run('DELETE FROM developer_keys WHERE id=? AND account=?', required(data.id, 'key'), account).changes) fail('Unknown key.', 404);
        return { revoked: true };
      }
      if (action === 'brand') {
        const name = required(data.name, 'display name');
        const accent = data.accent;
        if (typeof accent !== 'string' || !/^#[0-9a-f]{6}$/i.test(accent)) fail('Use a six-digit hex color.');
        run(`INSERT INTO workspace_brand VALUES (?, ?, ?) ON CONFLICT(account)
          DO UPDATE SET name=excluded.name, accent=excluded.accent`, account, name, accent);
        return { name, accent };
      }
      if (action === 'signing-key') {
        const secret = randomBytes(32).toString('hex');
        run('INSERT INTO webhook_signing VALUES (?, ?) ON CONFLICT(account) DO UPDATE SET secret=excluded.secret', account, secret);
        return { secret };
      }
      if (action === 'webhook-preview') {
        const [key] = query('SELECT secret FROM webhook_signing WHERE account=?', account);
        if (!key) fail('Create a signing key first.', 409);
        const timestamp = Math.floor(Date.parse(now()) / 1000);
        const event = data.event ? query(`SELECT id, operation, created FROM workspace_audit
          WHERE id=? AND account=?`, required(data.event, 'event'), account)[0] : null;
        if (data.event && !event) fail('Unknown audit event.', 404);
        const payload = JSON.stringify(event ? { ...event, type: 'ringonyx.operation' }
          : { id: randomUUID(), type: 'ringonyx.test', created: now() });
        return { timestamp, payload, signature: createHmac('sha256', key.secret).update(timestamp + '.' + payload).digest('hex') };
      }
      if (action === 'import-sites') {
        const rows = parseCsv(data.csv);
        if (rows[0]?.join(',') !== 'name,number' || rows.length < 2 || rows.length > 101 || rows.some(row => row.length !== 2)) {
          fail('Provide a name,number header and 1 to 100 site rows.');
        }
        return transaction(() => {
          for (const [name, number] of rows.slice(1)) addSite(account, { name, number });
          return { imported: rows.length - 1 };
        });
      }
      fail('Unknown operations action.', 404);
    }
  };
  function parseCsv(csv) {
    if (typeof csv !== 'string') fail('Enter CSV text.');
    const rows = [];
    let row = [], field = '', quoted = false, closed = false;
    const pushField = () => { row.push(field); field = ''; closed = false; };
    for (let i = 0; i < csv.length; i++) {
      const char = csv[i];
      if (quoted) {
        if (char !== '"') field += char;
        else if (csv[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closed = true; }
      } else if (char === ',') pushField();
      else if (char === '\n' || char === '\r') {
        pushField(); rows.push(row); row = [];
        if (char === '\r' && csv[i + 1] === '\n') i++;
      } else if (closed) fail('Invalid CSV quoting.');
      else if (char === '"') {
        if (field) fail('Invalid CSV quoting.');
        quoted = true;
      } else field += char;
    }
    if (quoted) fail('Unclosed CSV field.');
    if (row.length || field || closed) { pushField(); rows.push(row); }
    return rows;
  }
}
export function csvExport(rows, fields) {
  const cell = value => {
    const raw = String(value ?? '');
    const safe = typeof value === 'string' && /^[\s\uFEFF]*[=+\-@\t\r\n]/.test(raw) ? "'" + raw : raw;
    return '"' + safe.replaceAll('"', '""') + '"';
  };
  return [fields.map(cell).join(','), ...rows.map(row => fields.map(key => cell(row[key])).join(','))].join('\r\n') + '\r\n';
}
