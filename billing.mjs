export function initializeBilling(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id),
      renter TEXT NOT NULL REFERENCES renters(id), created TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS invoice_lines (
      call TEXT PRIMARY KEY REFERENCES charges(call),
      invoice TEXT NOT NULL REFERENCES invoices(id), cents INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS invoices_account ON invoices(account);
    CREATE INDEX IF NOT EXISTS invoice_lines_invoice ON invoice_lines(invoice);
    CREATE TABLE IF NOT EXISTS invoice_entries (
      invoice TEXT NOT NULL REFERENCES invoices(id), reference TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('payment','credit')),
      cents INTEGER NOT NULL CHECK(cents>0), created TEXT NOT NULL,
      PRIMARY KEY(invoice, reference)
    );
    CREATE TABLE IF NOT EXISTS rental_rates (
      renter TEXT NOT NULL REFERENCES renters(id), effective TEXT NOT NULL,
      cents INTEGER NOT NULL CHECK(cents>=0), PRIMARY KEY(renter, effective)
    );
    CREATE TABLE IF NOT EXISTS invoice_rent (
      invoice TEXT PRIMARY KEY REFERENCES invoices(id), renter TEXT NOT NULL REFERENCES renters(id),
      period TEXT NOT NULL, cents INTEGER NOT NULL CHECK(cents>0), UNIQUE(renter, period)
    );
  `);
}

export function billing({ query, run, transaction, id, now, fail }) {
  const summary = `SELECT i.id, i.created, r.name AS renter_name,
    COALESCE(SUM(l.cents),0) + COALESCE(ir.cents,0) AS cents, COUNT(l.call) AS calls,
    ir.period, COALESCE(ir.cents,0) AS rent,
    COALESCE((SELECT SUM(e.cents) FROM invoice_entries e WHERE e.invoice=i.id), 0) AS applied
    FROM invoices i JOIN renters r ON r.id=i.renter
    LEFT JOIN invoice_lines l ON l.invoice=i.id LEFT JOIN invoice_rent ir ON ir.invoice=i.id`;
  function verifyRenter(account, renter) {
    if (!query('SELECT id FROM renters WHERE id=? AND account=?', renter, account).length) fail('Unknown renter.', 404);
  }
  return {
    setRent(account, renter, period, cents) {
      return transaction(() => {
        verifyRenter(account, renter);
        run('INSERT INTO rental_rates VALUES (?, ?, ?) ON CONFLICT(renter, effective) DO UPDATE SET cents=excluded.cents', renter, period, cents);
        return { renter, period, cents };
      });
    },
    apply(account, invoice, entry) {
      return transaction(() => {
        const [record] = query(summary + ' WHERE i.id=? AND i.account=? GROUP BY i.id', invoice, account);
        if (!record) fail('Unknown invoice.', 404);
        const [prior] = query('SELECT kind, cents FROM invoice_entries WHERE invoice=? AND reference=?', invoice, entry.reference);
        if (prior) {
          if (prior.cents !== entry.cents || prior.kind !== entry.kind) fail('Reference already used for another entry.', 409);
          return { balance: record.cents - record.applied };
        }
        if (entry.cents > record.cents - record.applied) fail('Amount exceeds the invoice balance.', 409);
        run('INSERT INTO invoice_entries VALUES (?, ?, ?, ?, ?)', invoice, entry.reference, entry.kind, entry.cents, now());
        return { balance: record.cents - record.applied - entry.cents };
      });
    },
    list(account) {
      return query(summary + ' WHERE i.account=? GROUP BY i.id ORDER BY i.created DESC', account);
    },
    forRenter(renter) {
      return query(summary + ' WHERE i.renter=? GROUP BY i.id ORDER BY i.created DESC', renter);
    },
    create(account, renter, period) {
      return transaction(() => {
        verifyRenter(account, renter);
        const [rate] = period ? query(`SELECT cents FROM rental_rates WHERE renter=? AND effective<=?
          ORDER BY effective DESC LIMIT 1`, renter, period) : [];
        const rent = rate?.cents && !query('SELECT invoice FROM invoice_rent WHERE renter=? AND period=?', renter, period).length ? rate.cents : 0;
        const charges = query(`SELECT ch.call, ch.cents FROM charges ch
          JOIN calls c ON c.id=ch.call JOIN sites s ON s.id=c.site
          JOIN assignments a ON a.id=c.assignment
          LEFT JOIN invoice_lines l ON l.call=ch.call
          WHERE a.renter=? AND s.account=? AND l.call IS NULL AND (? IS NULL OR substr(c.created,1,7)=?)`,
        renter, account, period, period);
        if (!charges.length && !rent) fail('There are no unbilled charges for this renter.', 409);
        const invoice = id();
        run('INSERT INTO invoices VALUES (?, ?, ?, ?)', invoice, account, renter, now());
        if (rent) run('INSERT INTO invoice_rent VALUES (?, ?, ?, ?)', invoice, renter, period, rent);
        for (const charge of charges) {
          run('INSERT INTO invoice_lines VALUES (?, ?, ?)', charge.call, invoice, charge.cents);
        }
        return { id: invoice, cents: charges.reduce((sum, charge) => sum + charge.cents, rent), rent };
      });
    }
  };
}
