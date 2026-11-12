import { randomUUID } from 'node:crypto';

export function webLeads(db, { query, run, transaction, required, phone, whole, fail, now }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS web_leads (
      id TEXT PRIMARY KEY, site TEXT NOT NULL REFERENCES sites(id), channel TEXT NOT NULL,
      name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL, message TEXT NOT NULL,
      region TEXT NOT NULL, source TEXT NOT NULL, campaign TEXT NOT NULL, created TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS web_leads_site ON web_leads(site, created);
    CREATE TABLE IF NOT EXISTS lead_quotes (
      id TEXT PRIMARY KEY, lead TEXT NOT NULL REFERENCES web_leads(id),
      buyer TEXT NOT NULL REFERENCES buyers(id), cents INTEGER NOT NULL, expires TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lead_deliveries (
      lead TEXT PRIMARY KEY REFERENCES web_leads(id), buyer TEXT NOT NULL REFERENCES buyers(id),
      mode TEXT NOT NULL, quote TEXT REFERENCES lead_quotes(id), cents INTEGER, created TEXT NOT NULL
    );
  `);
  const siteLead = (account, id) => {
    const [lead] = query(`SELECT l.* FROM web_leads l JOIN sites s ON s.id=l.site WHERE l.id=? AND s.account=?`, id, account);
    if (!lead) fail('Unknown lead.', 404);
    return lead;
  };
  function eligible(account, lead, buyer, floor = 0) {
    return query(`SELECT b.id, b.name, b.price FROM buyers b WHERE b.account=? AND b.region=? AND b.price>=?
      AND (? IS NULL OR b.id=?)
      AND NOT EXISTS (SELECT 1 FROM network_pauses p WHERE p.account=b.account AND p.kind='buyer' AND p.party=b.id)
      AND NOT EXISTS (SELECT 1 FROM network_suppression n WHERE n.account=b.account AND n.region=b.region)
      ORDER BY b.price DESC, b.id LIMIT 1`, account, lead.region, floor, buyer, buyer)[0];
  }
  return {
    capturePublic(site, data) {
      const [record] = query('SELECT account FROM sites WHERE id=?', site);
      if (!record) fail('Unknown intake page.', 404);
      this.capture(record.account, { ...data, site });
      return { received: true };
    },
    quotes(account) {
      return query(`SELECT q.id, q.lead, q.cents, q.expires, b.name AS buyer_name
        FROM lead_quotes q JOIN web_leads l ON l.id=q.lead JOIN sites s ON s.id=l.site
        JOIN buyers b ON b.id=q.buyer LEFT JOIN lead_deliveries d ON d.lead=l.id
        WHERE s.account=? AND d.lead IS NULL AND q.expires>? ORDER BY q.expires DESC`, account, now());
    },
    list(account) {
      return query(`SELECT l.*, s.name AS site_name, d.mode, d.cents AS bid, d.created AS delivered,
        b.name AS buyer_name FROM web_leads l JOIN sites s ON s.id=l.site
        LEFT JOIN lead_deliveries d ON d.lead=l.id LEFT JOIN buyers b ON b.id=d.buyer
        WHERE s.account=? ORDER BY l.created DESC, l.id`, account);
    },
    buyerInbox(token) {
      return query(`SELECT l.channel, l.name, l.email, l.phone, l.message, l.region, l.source, l.campaign,
        d.created AS delivered, d.mode FROM lead_deliveries d JOIN web_leads l ON l.id=d.lead
        JOIN buyers b ON b.id=d.buyer WHERE b.token=? ORDER BY d.created DESC`, token);
    },
    capture(account, data) {
      const site = required(data.site, 'site');
      if (!query('SELECT id FROM sites WHERE id=? AND account=?', site, account).length) fail('Unknown site.', 404);
      const channel = data.channel;
      if (!['form', 'chat'].includes(channel)) fail('Choose form or chat intake.');
      const name = required(data.name, 'name');
      const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
      const number = data.phone ? phone(data.phone) : '';
      if ((email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) || (!email && !number)) {
        fail('Enter a valid email or international phone number.');
      }
      const region = required(data.region, 'region').toUpperCase();
      if (!/^[A-Z]{2}$/.test(region)) fail('Use a two-letter region code.');
      const source = required(data.source, 'source');
      const campaign = data.campaign ? required(data.campaign, 'campaign') : '';
      const message = typeof data.message === 'string' ? data.message.trim() : '';
      if (!message || message.length > 2000) fail('Enter a message of 1 to 2,000 characters.');
      return transaction(() => {
        const since = new Date(Date.parse(now()) - 86400000).toISOString();
        const [duplicate] = query(`SELECT id FROM web_leads WHERE site=? AND created>=?
          AND ((email<>'' AND email=?) OR (phone<>'' AND phone=?)) ORDER BY created, id LIMIT 1`, site, since, email, number);
        if (duplicate) return { id: duplicate.id, duplicate: true };
        const id = randomUUID();
        run('INSERT INTO web_leads VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          id, site, channel, name, email, number, message, region, source, campaign, now());
        return { id, duplicate: false };
      });
    },
    ping(account, data) {
      const lead = siteLead(account, required(data.lead, 'lead'));
      const floor = whole(data.floor ?? 0, 1000000);
      return transaction(() => {
        if (query('SELECT lead FROM lead_deliveries WHERE lead=?', lead.id).length) fail('Lead already delivered.', 409);
        const buyer = eligible(account, lead, null, floor);
        if (!buyer) return { quote: null };
        const quote = randomUUID();
        const expires = new Date(Date.parse(now()) + 5 * 60 * 1000).toISOString();
        run('INSERT INTO lead_quotes VALUES (?, ?, ?, ?, ?)', quote, lead.id, buyer.id, buyer.price, expires);
        return { quote, buyer: buyer.name, cents: buyer.price, expires };
      });
    },
    deliver(account, data, mode) {
      const lead = siteLead(account, required(data.lead, 'lead'));
      return transaction(() => {
        const [prior] = query('SELECT * FROM lead_deliveries WHERE lead=?', lead.id);
        const target = required(mode === 'direct' ? data.buyer : data.quote, mode === 'direct' ? 'buyer' : 'quote');
        if (prior) {
          if (prior.mode !== mode || (mode === 'direct' ? prior.buyer : prior.quote) !== target) fail('Lead already delivered.', 409);
          return prior;
        }
        const [quote] = mode === 'quoted' ? query('SELECT * FROM lead_quotes WHERE id=? AND lead=? AND expires>?', target, lead.id, now()) : [];
        if (mode === 'quoted' && !quote) fail('Quote is invalid or expired.', 409);
        const buyer = eligible(account, lead, mode === 'direct' ? target : quote.buyer);
        if (!buyer) fail('Buyer is unavailable for this lead.', 409);
        const created = now();
        run('INSERT INTO lead_deliveries VALUES (?, ?, ?, ?, ?, ?)', lead.id, buyer.id, mode, quote?.id ?? null, quote?.cents ?? null, created);
        return { lead: lead.id, buyer: buyer.id, mode, quote: quote?.id ?? null, cents: quote?.cents ?? null, created };
      });
    }
  };
}
