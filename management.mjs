import { randomBytes, randomUUID, createHash, scryptSync, timingSafeEqual } from 'node:crypto';
import { security } from './security.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
export function management(db, { query, run, transaction, fail, required, now }) {
  const factors = security(db);
  const attempts = new Map();
  db.exec(`
    CREATE TABLE IF NOT EXISTS business_settings (
      account TEXT PRIMARY KEY REFERENCES accounts(id), timezone TEXT NOT NULL, alert_terms TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_profiles (user TEXT PRIMARY KEY REFERENCES users(id), name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS team_invites (
      token TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id), email TEXT NOT NULL,
      role TEXT NOT NULL, expires INTEGER NOT NULL, UNIQUE(account,email)
    );
    CREATE TABLE IF NOT EXISTS customer_states (
      account TEXT NOT NULL REFERENCES accounts(id), kind TEXT NOT NULL, party TEXT NOT NULL,
      state TEXT NOT NULL, PRIMARY KEY(account,kind,party)
    );
  `);
  function owner(user) {
    if (user.role !== 'owner') fail('Workspace owner access required.', 403);
  }
  function password(user, value) {
    const [record] = query('SELECT * FROM users WHERE id=?', user.id);
    if (!record || typeof value !== 'string' || value.length > 256 ||
        !timingSafeEqual(scryptSync(value, record.salt, 64), Buffer.from(record.hash, 'hex'))) fail('Current password is incorrect.', 403);
    return record;
  }
  return {
    accept(data) {
      const token = required(data.token, 'invitation');
      if (typeof data.password !== 'string' || data.password.length < 14 || data.password.length > 256) fail('Use a password between 14 and 256 characters.');
      return transaction(() => {
        const [invite] = query('SELECT * FROM team_invites WHERE token=? AND expires>?', hash(token), Date.now());
        if (!invite) fail('Invalid or expired invitation.', 404);
        if (query('SELECT id FROM users WHERE email=?', invite.email).length) fail('Email already registered.', 409);
        const salt = randomBytes(16).toString('hex');
        run('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)', randomUUID(), invite.account, invite.email,
          invite.role, salt, scryptSync(data.password, salt, 64).toString('hex'));
        run('DELETE FROM team_invites WHERE token=?', invite.token);
        return { accepted: true };
      });
    },
    read(user) {
      return {
        business: query('SELECT * FROM business_settings WHERE account=?', user.account)[0] ??
          { timezone: 'America/Los_Angeles', alert_terms: '' },
        name: query('SELECT name FROM user_profiles WHERE user=?', user.id)[0]?.name ?? '',
        email: user.email,
        twoFactor: factors.enabled(user.id),
        team: user.role === 'owner' ? query(`SELECT u.id,u.email,u.role,p.name FROM users u
          LEFT JOIN user_profiles p ON p.user=u.id LEFT JOIN renter_users r ON r.user=u.id
          WHERE u.account=? AND r.user IS NULL ORDER BY u.email`, user.account) : [],
        invitations: user.role === 'owner' ? query('SELECT email,role,expires FROM team_invites WHERE account=?', user.account) : [],
        states: query('SELECT kind,party,state FROM customer_states WHERE account=?', user.account),
        sessions: query('SELECT token,expires FROM sessions WHERE user=? ORDER BY expires DESC', user.id)
          .map(row => ({ id: row.token, expires: row.expires }))
      };
    },
    write(user, action, data) {
      if (action.startsWith('totp-')) {
        const entry = attempts.get(user.id) ?? { count: 0, until: Date.now() + 60000 };
        if (entry.until < Date.now()) { entry.count = 0; entry.until = Date.now() + 60000; }
        if (++entry.count > 10) fail('Too many security attempts. Try again in one minute.', 429);
        attempts.set(user.id, entry);
        password(user, data.current);
        if (action === 'totp-setup') return factors.setup(user, fail);
        if (action === 'totp-enable') return factors.enable(user.id, data.code, fail);
        if (action === 'totp-disable') return factors.disable(user.id, data.code, fail);
        fail('Unknown security operation.');
      }
      if (action === 'profile') {
        const name = required(data.name, 'display name');
        run('INSERT INTO user_profiles VALUES (?, ?) ON CONFLICT(user) DO UPDATE SET name=excluded.name', user.id, name);
        return { saved: true };
      }
      if (action === 'password') {
        password(user, data.current);
        if (typeof data.password !== 'string' || data.password.length < 14 || data.password.length > 256) fail('Use a password between 14 and 256 characters.');
        if (data.password !== data.confirm) fail('New passwords must match.');
        return transaction(() => {
          const salt = randomBytes(16).toString('hex');
          run('UPDATE users SET salt=?,hash=? WHERE id=?', salt, scryptSync(data.password, salt, 64).toString('hex'), user.id);
          run('DELETE FROM sessions WHERE user=?', user.id);
          return { signedOut: true };
        });
      }
      if (action === 'revoke-session') {
        run('DELETE FROM sessions WHERE token=? AND user=?', required(data.id, 'session'), user.id);
        return { saved: true };
      }
      owner(user);
      if (action === 'business') {
        const name = required(data.name, 'business name');
        const timezone = required(data.timezone, 'time zone');
        try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { fail('Invalid time zone.'); }
        const terms = typeof data.terms === 'string' ? data.terms.trim() : '';
        if (terms.length > 1000) fail('Alert terms must be at most 1,000 characters.');
        return transaction(() => {
          run('UPDATE accounts SET name=? WHERE id=?', name, user.account);
          run(`INSERT INTO business_settings VALUES (?, ?, ?) ON CONFLICT(account)
            DO UPDATE SET timezone=excluded.timezone,alert_terms=excluded.alert_terms`, user.account, timezone, terms);
          return { saved: true };
        });
      }
      if (action === 'invite') {
        const email = required(data.email, 'email').toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Enter a valid email.');
        if (!['operator','viewer'].includes(data.role)) fail('Choose operator or viewer.');
        if (query('SELECT id FROM users WHERE email=?', email).length) fail('Email already registered.', 409);
        const token = randomBytes(32).toString('hex');
        run(`INSERT INTO team_invites VALUES (?, ?, ?, ?, ?) ON CONFLICT(account,email)
          DO UPDATE SET token=excluded.token,role=excluded.role,expires=excluded.expires`,
          hash(token), user.account, email, data.role, Date.now() + 86400000);
        return { token };
      }
      if (action === 'role') {
        if (!['operator','viewer'].includes(data.role)) fail('Choose operator or viewer.');
        const [member] = query(`SELECT u.id,u.role FROM users u LEFT JOIN renter_users r ON r.user=u.id
          WHERE u.id=? AND u.account=? AND r.user IS NULL`, required(data.id, 'member'), user.account);
        if (!member) fail('Unknown team member.', 404);
        if (member.role === 'owner') fail('Use ownership transfer for an owner.');
        run('UPDATE users SET role=? WHERE id=?', data.role, member.id);
        run('DELETE FROM sessions WHERE user=?', member.id);
        return { saved: true };
      }
      if (action === 'transfer') {
        password(user, data.current);
        return transaction(() => {
          const [member] = query(`SELECT u.id FROM users u LEFT JOIN renter_users r ON r.user=u.id
            WHERE u.id=? AND u.account=? AND u.id<>? AND r.user IS NULL`, required(data.id, 'member'), user.account, user.id);
          if (!member) fail('Choose another team member.', 404);
          run("UPDATE users SET role='owner' WHERE id=?", member.id);
          run("UPDATE users SET role='operator' WHERE id=?", user.id);
          run('DELETE FROM sessions WHERE user IN (?,?)', member.id, user.id);
          return { signedOut: true };
        });
      }
      if (action === 'customer-state') {
        if (!['renter','buyer'].includes(data.kind) || !['active','paused','archived'].includes(data.state)) fail('Choose a customer and valid status.');
        const table = data.kind === 'renter' ? 'renters' : 'buyers';
        const id = required(data.id, 'customer');
        return transaction(() => {
          if (!query('SELECT id FROM ' + table + ' WHERE id=? AND account=?', id, user.account).length) fail('Unknown customer.', 404);
          run(`INSERT INTO customer_states VALUES (?, ?, ?, ?) ON CONFLICT(account,kind,party)
            DO UPDATE SET state=excluded.state`, user.account, data.kind, id, data.state);
          if (data.kind === 'buyer') {
            if (data.state === 'active') run("DELETE FROM network_pauses WHERE account=? AND kind='buyer' AND party=?", user.account, id);
            else run("INSERT OR IGNORE INTO network_pauses VALUES (?, 'buyer', ?)", user.account, id);
          } else if (data.state !== 'active') run('UPDATE assignments SET ended=? WHERE renter=? AND ended IS NULL', now(), id);
          return { saved: true };
        });
      }
      fail('Unknown management operation.', 404);
    }
  };
}
