import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';

const lifetime = 12 * 60 * 60 * 1000;
const cookieName = 'ringonyx_session';
const digest = token => createHash('sha256').update(token).digest('hex');
const derive = (password, salt) => scryptSync(password, salt, 64);
const dummy = Buffer.alloc(64);
const roles = ['owner', 'operator', 'viewer'];

export function initializeAccounts(db) {
  db.exec(`
    BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    INSERT OR IGNORE INTO accounts VALUES ('legacy', 'Original workspace');
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id),
      email TEXT NOT NULL UNIQUE, role TEXT NOT NULL CHECK(role IN ('owner', 'operator', 'viewer')),
      salt TEXT NOT NULL, hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, user TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL
    );
  `);
  try {
    for (const table of ['sites', 'renters']) {
      if (!db.prepare('PRAGMA table_info(' + table + ')').all().some(column => column.name === 'account')) {
        db.exec("ALTER TABLE " + table + " ADD COLUMN account TEXT NOT NULL DEFAULT 'legacy'");
      }
      db.exec('CREATE INDEX IF NOT EXISTS ' + table + '_account ON ' + table + '(account)');
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function provision(db, { account, name, email, password, role }) {
  email = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw Error('Enter a valid email.');
  if (typeof password !== 'string' || password.length < 14 || password.length > 256) throw Error('Use a password between 14 and 256 characters.');
  if (!roles.includes(role)) throw Error('Role must be owner, operator, or viewer.');
  if (name && (account || role !== 'owner')) throw Error('New workspaces require an owner.');
  if (!name && !account) throw Error('Supply an existing workspace ID or a new workspace name.');
  if (!name && !db.prepare('SELECT id FROM accounts WHERE id=?').get(account)) throw Error('Unknown workspace.');
  const salt = randomBytes(16).toString('hex');
  const hash = derive(password, salt).toString('hex');
  const workspace = account || randomUUID();
  db.exec('BEGIN IMMEDIATE');
  try {
    if (name) db.prepare('INSERT INTO accounts VALUES (?, ?)').run(workspace, name);
    db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), workspace, email, role, salt, hash);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return workspace;
}

export function accountAccess(db, { secure }) {
  const attempts = new Map();
  const findUser = db.prepare(`SELECT u.*, a.name AS workspace FROM users u JOIN accounts a ON a.id=u.account WHERE u.email=?`);
  const findSession = db.prepare(`SELECT u.id, u.email, u.account, u.role, a.name AS workspace
    FROM sessions s JOIN users u ON u.id=s.user JOIN accounts a ON a.id=u.account
    WHERE s.token=? AND s.expires>?`);
  const token = req => /(?:^|;\s*)ringonyx_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  const cookie = (value, age) => cookieName + '=' + value + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + age + (secure ? '; Secure' : '');
  const session = req => {
    const value = token(req);
    return value && findSession.get(digest(value), Date.now());
  };
  function revoke(req) {
    const value = token(req);
    if (value) db.prepare('DELETE FROM sessions WHERE token=?').run(digest(value));
  }
  return {
    session,
    login(req, res, data, fail) {
      const now = Date.now();
      for (const [key, entry] of attempts) if (entry.expires <= now) attempts.delete(key);
      const address = req.socket.remoteAddress;
      const entry = attempts.get(address) || { count: 0, expires: now + 60_000 };
      if (entry.count >= 10) fail('Too many sign-in attempts. Try again in one minute.', 429);
      entry.count++;
      attempts.set(address, entry);
      const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
      const password = typeof data.password === 'string' && data.password.length <= 256 ? data.password : '';
      const user = findUser.get(email);
      const valid = timingSafeEqual(derive(password, user?.salt || 'ringonyx-sign-in'), user ? Buffer.from(user.hash, 'hex') : dummy);
      if (!user || !valid) fail('Invalid email or password.', 401);
      attempts.delete(address);
      revoke(req);
      db.prepare('DELETE FROM sessions WHERE expires<=?').run(now);
      const value = randomBytes(32).toString('hex');
      db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(digest(value), user.id, now + lifetime);
      res.setHeader('Set-Cookie', cookie(value, lifetime / 1000));
      return { email: user.email, role: user.role, workspace: user.workspace };
    },
    logout(req, res) {
      revoke(req);
      res.setHeader('Set-Cookie', cookie('', 0));
    }
  };
}
