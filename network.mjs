import { randomUUID } from 'node:crypto';

export function network(db, { query, run, transaction, fail, required, whole, phone, now }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS buyers (
      id TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id),
      name TEXT NOT NULL, destination TEXT NOT NULL, region TEXT NOT NULL,
      price INTEGER NOT NULL, minimum INTEGER NOT NULL, cap INTEGER NOT NULL,
      concurrency INTEGER NOT NULL, token TEXT UNIQUE NOT NULL
    );
    CREATE TABLE IF NOT EXISTS publisher_offers (
      id TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id),
      name TEXT NOT NULL, payout INTEGER NOT NULL, token TEXT UNIQUE NOT NULL,
      api_token TEXT UNIQUE NOT NULL
    );
    CREATE TABLE IF NOT EXISTS network_calls (
      id TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id),
      offer TEXT NOT NULL REFERENCES publisher_offers(id), buyer TEXT REFERENCES buyers(id),
      reference TEXT NOT NULL, region TEXT NOT NULL, created TEXT NOT NULL,
      outcome TEXT NOT NULL, seconds INTEGER, revenue INTEGER NOT NULL DEFAULT 0,
      payout INTEGER NOT NULL DEFAULT 0, UNIQUE(offer, reference)
    );
    CREATE INDEX IF NOT EXISTS network_buyer_activity ON network_calls(buyer, created, outcome);
    CREATE TABLE IF NOT EXISTS network_suppression (
      account TEXT NOT NULL REFERENCES accounts(id), region TEXT NOT NULL,
      PRIMARY KEY(account, region)
    );
  `);
  const region = value => {
    const result = required(value, 'region').toUpperCase();
    if (!/^[A-Z]{2}$/.test(result)) fail('Use a two-letter region code.');
    return result;
  };
  const details = `SELECT c.*, b.name AS buyer_name, o.name AS publisher_name
    FROM network_calls c LEFT JOIN buyers b ON b.id=c.buyer JOIN publisher_offers o ON o.id=c.offer`;
  const endpoints = {
    buyers(account, data) {
      const id = randomUUID();
      const cap = whole(data.cap, 100000);
      const concurrency = whole(data.concurrency, 10000);
      if (!cap || !concurrency) fail('Capacity limits must be positive.');
      run('INSERT INTO buyers VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', id, account,
        required(data.name, 'buyer name'), phone(data.destination), region(data.region),
        whole(data.price, 1000000), whole(data.minimum, 86400), cap, concurrency, randomUUID());
      return { id };
    },
    publishers(account, data) {
      const id = randomUUID();
      run('INSERT INTO publisher_offers VALUES (?, ?, ?, ?, ?, ?)', id, account,
        required(data.name, 'publisher offer'), whole(data.payout, 1000000), randomUUID(), randomUUID());
      return { id };
    },
    suppression(account, data) {
      const code = region(data.region);
      if (data.enabled === false) run('DELETE FROM network_suppression WHERE account=? AND region=?', account, code);
      else run('INSERT OR IGNORE INTO network_suppression VALUES (?, ?)', account, code);
      return { region: code };
    }
  };
  function match(account, data, commit) {
    const code = region(data.region);
    const offerId = required(data.offer, 'publisher offer');
    const floor = whole(data.floor ?? 0, 1000000);
    const strategy = data.strategy ?? 'price';
    if (!['price','predictive'].includes(strategy)) fail('Unknown routing strategy.');
    const [offer] = query('SELECT * FROM publisher_offers WHERE id=? AND account=?', offerId, account);
    if (!offer) fail('Unknown publisher offer.', 404);
    const reference = commit ? required(data.reference, 'call reference') : null;
    const [prior] = reference ? query('SELECT * FROM network_calls WHERE offer=? AND reference=?', offerId, reference) : [];
    if (prior) {
      if (prior.region !== code) fail('Call reference already used for another region.', 409);
      return { id: prior.id, outcome: prior.outcome, buyer: prior.buyer };
    }
    const timestamp = now();
    const suppressed = query('SELECT region FROM network_suppression WHERE account=? AND region=?', account, code).length > 0;
    const candidates = suppressed ? [] : query(`SELECT b.*,
      (SELECT COUNT(*) FROM network_calls c WHERE c.buyer=b.id AND c.created>=?) AS daily,
      (SELECT COUNT(*) FROM network_calls c WHERE c.buyer=b.id AND c.outcome='pending') AS active,
      (SELECT AVG(c.revenue) FROM network_calls c WHERE c.buyer=b.id AND c.outcome IN ('answered','missed')) AS yield
      FROM buyers b WHERE b.account=? AND b.region=? AND b.price>=?`, timestamp.slice(0,10), account, code, Math.max(floor, offer.payout))
      .filter(buyer => buyer.daily < buyer.cap && buyer.active < buyer.concurrency);
    candidates.sort((a, b) => (strategy === 'predictive' ? (b.yield ?? b.price) - (a.yield ?? a.price) : 0)
      || b.price - a.price || a.id.localeCompare(b.id));
    const buyer = candidates[0];
    const outcome = buyer ? 'pending' : suppressed ? 'suppressed' : 'unmatched';
    if (!commit) return { outcome, buyer: buyer?.name ?? null, bid: buyer?.price ?? null };
    const id = randomUUID();
    run(`INSERT INTO network_calls (id, account, offer, buyer, reference, region, created, outcome)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, id, account, offerId, buyer?.id ?? null, reference, code, timestamp, outcome);
    return { id, outcome, buyer: buyer?.id ?? null };
  }
  return {
    publisherRequest(token, action, data) {
      const [offer] = query('SELECT id, account FROM publisher_offers WHERE api_token=?', token);
      if (!offer) fail('Unknown publisher offer.', 404);
      const input = { ...data, offer: offer.id };
      return action === 'ping' ? match(offer.account, input, false)
        : transaction(() => match(offer.account, input, true));
    },
    portal(kind, token) {
      const buyer = kind === 'buyer';
      const table = buyer ? 'buyers' : 'publisher_offers';
      const [party] = query('SELECT id, name FROM ' + table + ' WHERE token=?', token);
      if (!party) fail('Portal not found.', 404);
      const field = buyer ? 'c.revenue' : 'c.payout';
      const calls = query(`SELECT c.reference, c.region, c.created, c.outcome, c.seconds, ${field} AS cents
        FROM network_calls c WHERE ${buyer ? 'c.buyer' : 'c.offer'}=? ORDER BY c.created DESC`, party.id);
      return { name: party.name, kind, calls };
    },
    list(account, role) {
      const buyers = query('SELECT * FROM buyers WHERE account=? ORDER BY name', account);
      const publishers = query('SELECT * FROM publisher_offers WHERE account=? ORDER BY name', account);
      if (role === 'viewer') for (const row of [...buyers, ...publishers]) {
        delete row.token;
        delete row.api_token;
      }
      return { buyers, publishers, calls: query(details + ' WHERE c.account=? ORDER BY c.created DESC', account),
        suppression: query('SELECT region FROM network_suppression WHERE account=? ORDER BY region', account) };
    },
    write(account, action, data) {
      if (Object.hasOwn(endpoints, action)) return endpoints[action](account, data);
      if (action === 'ping') return match(account, data, false);
      if (action === 'post') return transaction(() => match(account, data, true));
      if (action !== 'complete') fail('Unknown network operation.', 404);
      return transaction(() => {
        const [call] = query(details + ' WHERE c.id=? AND c.account=?', required(data.call, 'network call'), account);
        if (!call) fail('Unknown network call.', 404);
        const seconds = whole(data.seconds, 86400);
        if (!['answered','missed'].includes(data.outcome)) fail('Invalid call outcome.');
        if (call.outcome === data.outcome && call.seconds === seconds) return { revenue: call.revenue, payout: call.payout };
        if (call.outcome !== 'pending') fail('Call cannot be completed.', 409);
        const [buyer] = query('SELECT price, minimum FROM buyers WHERE id=?', call.buyer);
        const [offer] = query('SELECT payout FROM publisher_offers WHERE id=?', call.offer);
        const qualified = data.outcome === 'answered' && seconds >= buyer.minimum;
        const revenue = qualified ? buyer.price : 0;
        const payout = qualified ? offer.payout : 0;
        run('UPDATE network_calls SET outcome=?, seconds=?, revenue=?, payout=? WHERE id=?', data.outcome, seconds, revenue, payout, call.id);
        return { revenue, payout };
      });
    }
  };
}
