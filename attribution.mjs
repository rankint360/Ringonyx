import { randomUUID } from 'node:crypto';

export function attribution(db, { query, run, transaction, fail, phone }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tracking_pool (
      number TEXT PRIMARY KEY, site TEXT NOT NULL REFERENCES sites(id)
    );
    CREATE TABLE IF NOT EXISTS number_leases (
      number TEXT PRIMARY KEY REFERENCES tracking_pool(number) ON DELETE CASCADE,
      visitor TEXT NOT NULL, source TEXT NOT NULL, campaign TEXT NOT NULL,
      expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS call_attribution (
      call TEXT PRIMARY KEY REFERENCES calls(id), number TEXT NOT NULL,
      source TEXT NOT NULL, campaign TEXT NOT NULL
    );
  `);
  const owned = (account, site) => {
    if (!query('SELECT id FROM sites WHERE id=? AND account=?', site, account).length) fail('Unknown site.', 404);
  };
  const clean = value => typeof value === 'string' ? value.trim().slice(0, 100) : '';
  return {
    list(account) {
      return query(`SELECT p.site, p.number FROM tracking_pool p
        JOIN sites s ON s.id=p.site WHERE s.account=? ORDER BY p.site, p.number`, account);
    },
    contains(number) {
      return Boolean(query('SELECT number FROM tracking_pool WHERE number=?', number).length);
    },
    add(account, site, value) {
      owned(account, site);
      const number = phone(value);
      return transaction(() => {
        if (query('SELECT number FROM sites WHERE number=? UNION ALL SELECT number FROM tracking_pool WHERE number=?', number, number).length) {
          fail('Number already assigned.', 409);
        }
        run('INSERT INTO tracking_pool VALUES (?, ?)', number, site);
        return { site, number };
      });
    },
    lease(site, data) {
      const [record] = query('SELECT number FROM sites WHERE id=?', site);
      if (!record) fail('Unknown tracking site.', 404);
      const visitor = typeof data.visitor === 'string' && /^[0-9a-f-]{36}$/i.test(data.visitor) ? data.visitor : randomUUID();
      return transaction(() => {
        const now = Date.now();
        const expires = now + 30 * 60 * 1000;
        const [existing] = query(`SELECT l.number, l.expires FROM number_leases l
          JOIN tracking_pool p ON p.number=l.number
          WHERE p.site=? AND l.visitor=? AND l.expires>? ORDER BY l.expires DESC LIMIT 1`, site, visitor, now);
        if (existing) return { visitor, number: existing.number, fallback: record.number, expires: existing.expires, dynamic: true };
        const [available] = query(`SELECT p.number FROM tracking_pool p LEFT JOIN number_leases l ON l.number=p.number
          WHERE p.site=? AND (l.number IS NULL OR l.expires<=?) ORDER BY p.number LIMIT 1`, site, now);
        if (!available) return { visitor, number: record.number, dynamic: false };
        run(`INSERT INTO number_leases VALUES (?, ?, ?, ?, ?) ON CONFLICT(number) DO UPDATE SET
          visitor=excluded.visitor, source=excluded.source, campaign=excluded.campaign, expires=excluded.expires`,
        available.number, visitor, clean(data.source) || 'Direct', clean(data.campaign), expires);
        return { visitor, number: available.number, fallback: record.number, expires, dynamic: true };
      });
    },
    resolve(account, number) {
      return query(`SELECT s.id, l.source, l.campaign FROM tracking_pool p JOIN sites s ON s.id=p.site
        LEFT JOIN number_leases l ON l.number=p.number AND l.expires>?
        WHERE p.number=? AND s.account=?`, Date.now(), number, account)[0];
    },
    snapshot(call, number, match) {
      run('INSERT INTO call_attribution VALUES (?, ?, ?, ?)', call, number, match.source ?? 'Unattributed', match.campaign ?? '');
    }
  };
}
