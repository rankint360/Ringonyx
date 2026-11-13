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
    CREATE TABLE IF NOT EXISTS network_pauses (
      account TEXT NOT NULL REFERENCES accounts(id), kind TEXT NOT NULL,
      party TEXT NOT NULL, PRIMARY KEY(account, kind, party)
    );
    CREATE TABLE IF NOT EXISTS network_decisions (
      call TEXT PRIMARY KEY REFERENCES network_calls(id),
      strategy TEXT NOT NULL, floor INTEGER NOT NULL, bid INTEGER,
      outcome TEXT NOT NULL, reason TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS network_buyer_budgets (
      buyer TEXT PRIMARY KEY REFERENCES buyers(id), daily_cents INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS network_call_evidence (
      call TEXT PRIMARY KEY REFERENCES network_calls(id),
      minimum INTEGER, payout INTEGER NOT NULL, candidates TEXT NOT NULL
    );
  `);
  const region = value => {
    const result = required(value, 'region').toUpperCase();
    if (!/^[A-Z]{2}$/.test(result)) fail('Use a two-letter region code.');
    return result;
  };
  const details = `SELECT c.*, b.name AS buyer_name, o.name AS publisher_name,
    d.strategy, d.floor, d.bid, d.reason, e.minimum, e.payout AS offered_payout, e.candidates
    FROM network_calls c LEFT JOIN buyers b ON b.id=c.buyer JOIN publisher_offers o ON o.id=c.offer
    LEFT JOIN network_decisions d ON d.call=c.id LEFT JOIN network_call_evidence e ON e.call=c.id`;
  const endpoints = {
    budget(account, data) {
      const id = required(data.buyer, 'buyer');
      const budget = whole(data.budget, 100000000);
      return transaction(() => {
        if (!query('SELECT id FROM buyers WHERE id=? AND account=?', id, account).length) fail('Unknown buyer.', 404);
        if (budget === 0) run('DELETE FROM network_buyer_budgets WHERE buyer=?', id);
        else run(`INSERT INTO network_buyer_budgets VALUES (?, ?)
          ON CONFLICT(buyer) DO UPDATE SET daily_cents=excluded.daily_cents`, id, budget);
        return { id, budget: budget || null };
      });
    },
    buyers(account, data) {
      const id = randomUUID();
      const cap = whole(data.cap, 100000);
      const concurrency = whole(data.concurrency, 10000);
      if (!cap || !concurrency) fail('Capacity limits must be positive.');
      const budget = whole(data.budget ?? 0, 100000000);
      return transaction(() => {
        run('INSERT INTO buyers VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', id, account,
          required(data.name, 'buyer name'), phone(data.destination), region(data.region),
          whole(data.price, 1000000), whole(data.minimum, 86400), cap, concurrency, randomUUID());
        if (budget) run('INSERT INTO network_buyer_budgets VALUES (?, ?)', id, budget);
        return { id };
      });
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
    },
    pause(account, data) {
      const kind = data.kind;
      if (!['buyer', 'publisher'].includes(kind) || typeof data.paused !== 'boolean') fail('Choose a partner and a pause state.');
      const party = required(data.party, 'partner');
      const table = kind === 'buyer' ? 'buyers' : 'publisher_offers';
      return transaction(() => {
        if (!query('SELECT id FROM ' + table + ' WHERE id=? AND account=?', party, account).length) fail('Unknown partner.', 404);
        if (data.paused) run('INSERT OR IGNORE INTO network_pauses VALUES (?, ?, ?)', account, kind, party);
        else run('DELETE FROM network_pauses WHERE account=? AND kind=? AND party=?', account, kind, party);
        return { party, paused: data.paused };
      });
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
      const [decision] = query('SELECT strategy, floor, outcome FROM network_decisions WHERE call=?', prior.id);
      if (prior.region !== code || (decision && (decision.floor !== floor || decision.strategy !== strategy))) {
        fail('Call reference already used for different routing inputs.', 409);
      }
      return { id: prior.id, outcome: decision?.outcome ?? prior.outcome, buyer: prior.buyer };
    }
    const timestamp = now();
    const suppressed = query('SELECT region FROM network_suppression WHERE account=? AND region=?', account, code).length > 0;
    const paused = query("SELECT party FROM network_pauses WHERE account=? AND kind='publisher' AND party=?", account, offerId).length > 0;
    const candidates = suppressed || paused ? [] : query(`SELECT b.*, limits.daily_cents,
      (SELECT COALESCE(SUM(CASE WHEN c.outcome='pending' THEN b.price ELSE c.revenue END), 0)
        FROM network_calls c WHERE c.buyer=b.id AND c.created>=?) AS committed,
      (SELECT COUNT(*) FROM network_calls c WHERE c.buyer=b.id AND c.created>=?) AS daily,
      (SELECT COUNT(*) FROM network_calls c WHERE c.buyer=b.id AND c.outcome='pending') AS active,
      (SELECT AVG(c.revenue) FROM network_calls c WHERE c.buyer=b.id AND c.outcome IN ('answered','missed')) AS yield
      FROM buyers b LEFT JOIN network_buyer_budgets limits ON limits.buyer=b.id
      WHERE b.account=? AND b.region=? AND b.price>=?
      AND NOT EXISTS(SELECT 1 FROM network_pauses p WHERE p.account=b.account AND p.kind='buyer' AND p.party=b.id)`,
    timestamp.slice(0,10), timestamp.slice(0,10), account, code, Math.max(floor, offer.payout));
    const excluded = buyer => {
      if (buyer.daily >= buyer.cap) return 'Daily call cap reached';
      if (buyer.active >= buyer.concurrency) return 'Concurrent call cap reached';
      if (buyer.daily_cents !== null && buyer.committed + buyer.price > buyer.daily_cents) return 'Daily budget reached';
      return null;
    };
    const eligible = candidates.filter(buyer => !excluded(buyer));
    eligible.sort((a, b) => (strategy === 'predictive' ? (b.yield ?? b.price) - (a.yield ?? a.price) : 0)
      || b.price - a.price || a.id.localeCompare(b.id));
    const buyer = eligible[0];
    const outcome = buyer ? 'pending' : suppressed || paused ? 'suppressed' : 'unmatched';
    const reason = buyer ? 'Matched' : paused ? 'Publisher offer paused' : suppressed ? 'Region suppressed'
      : candidates.length && candidates.every(candidate => excluded(candidate) === 'Daily budget reached')
        ? 'Buyer budget reached' : candidates.length ? 'Buyer capacity reached' : 'No active buyer meets coverage and floor';
    if (!commit) return { outcome, buyer: buyer?.name ?? null, bid: buyer?.price ?? null, reason };
    const id = randomUUID();
    run(`INSERT INTO network_calls (id, account, offer, buyer, reference, region, created, outcome)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, id, account, offerId, buyer?.id ?? null, reference, code, timestamp, outcome);
    run('INSERT INTO network_decisions VALUES (?, ?, ?, ?, ?, ?)', id, strategy, floor, buyer?.price ?? null, outcome, reason);
    const evidence = candidates.map(candidate => ({
      name: candidate.name, bid: candidate.price,
      expectedRevenue: strategy === 'predictive' ? Math.round(candidate.yield ?? candidate.price) : null,
      decision: candidate === buyer ? 'Selected' : excluded(candidate) ?? 'Ranked below winner'
    }));
    run('INSERT INTO network_call_evidence VALUES (?, ?, ?, ?)', id, buyer?.minimum ?? null, offer.payout, JSON.stringify(evidence));
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
      const buyers = query(`SELECT b.*, limits.daily_cents AS budget,
        COALESCE(SUM(CASE WHEN c.outcome='pending' THEN COALESCE(d.bid,b.price) ELSE 0 END),0) AS reserved,
        COALESCE(SUM(c.revenue),0) AS spent
        FROM buyers b LEFT JOIN network_buyer_budgets limits ON limits.buyer=b.id
        LEFT JOIN network_calls c ON c.buyer=b.id AND c.created>=?
        LEFT JOIN network_decisions d ON d.call=c.id
        WHERE b.account=? GROUP BY b.id ORDER BY b.name`, now().slice(0,10), account);
      const publishers = query('SELECT * FROM publisher_offers WHERE account=? ORDER BY name', account);
      if (role === 'viewer') for (const row of [...buyers, ...publishers]) {
        delete row.token;
        delete row.api_token;
      }
      return { buyers, publishers, calls: query(details + ' WHERE c.account=? ORDER BY c.created DESC', account),
        suppression: query('SELECT region FROM network_suppression WHERE account=? ORDER BY region', account),
        pauses: query('SELECT kind, party FROM network_pauses WHERE account=?', account) };
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
        const qualified = data.outcome === 'answered' && seconds >= (call.minimum ?? buyer.minimum);
        const revenue = qualified ? (call.bid ?? buyer.price) : 0;
        const payout = qualified ? (call.offered_payout ?? offer.payout) : 0;
        run('UPDATE network_calls SET outcome=?, seconds=?, revenue=?, payout=? WHERE id=?', data.outcome, seconds, revenue, payout, call.id);
        return { revenue, payout };
      });
    }
  };
}
