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
    CREATE TABLE IF NOT EXISTS booking_charges (
      id TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id),
      call TEXT NOT NULL REFERENCES calls(id), reference TEXT NOT NULL, evidence TEXT NOT NULL,
      cents INTEGER NOT NULL CHECK(cents>0), verified_by TEXT NOT NULL,
      created TEXT NOT NULL, invoice TEXT REFERENCES invoices(id), UNIQUE(account, reference)
    );
    CREATE TABLE IF NOT EXISTS invoice_disputes (
      id TEXT PRIMARY KEY, invoice TEXT NOT NULL REFERENCES invoices(id),
      reason TEXT NOT NULL, opened TEXT NOT NULL, resolved TEXT,
      resolution TEXT, credit INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS open_invoice_dispute
      ON invoice_disputes(invoice) WHERE resolved IS NULL;
  `);
}

export function billing({ query, run, transaction, id, now, fail }) {
  const summary = `SELECT i.id, i.created, r.name AS renter_name,
    COALESCE(SUM(l.cents),0) + COALESCE(ir.cents,0) +
      COALESCE((SELECT SUM(b.cents) FROM booking_charges b WHERE b.invoice=i.id),0) AS cents, COUNT(l.call) AS calls,
    (SELECT COUNT(*) FROM booking_charges b WHERE b.invoice=i.id) AS bookings,
    EXISTS(SELECT 1 FROM invoice_disputes d WHERE d.invoice=i.id AND d.resolved IS NULL) AS disputed,
    ir.period, COALESCE(ir.cents,0) AS rent,
    COALESCE((SELECT SUM(e.cents) FROM invoice_entries e WHERE e.invoice=i.id), 0) AS applied
    FROM invoices i JOIN renters r ON r.id=i.renter
    LEFT JOIN invoice_lines l ON l.invoice=i.id LEFT JOIN invoice_rent ir ON ir.invoice=i.id`;
  function verifyRenter(account, renter) {
    if (!query('SELECT id FROM renters WHERE id=? AND account=?', renter, account).length) fail('Unknown renter.', 404);
  }
  function invoiceDetails(records) {
    return records.map(invoice => ({
      ...invoice,
      lines: query(`SELECT 'call' AS kind, c.created, c.source AS reference, l.cents
        FROM invoice_lines l JOIN calls c ON c.id=l.call WHERE l.invoice=?
        UNION ALL SELECT 'booking', created, reference, cents FROM booking_charges WHERE invoice=?
        UNION ALL SELECT 'rent', i.created, r.period, r.cents FROM invoice_rent r
          JOIN invoices i ON i.id=r.invoice WHERE r.invoice=?
        ORDER BY created, kind, reference`, invoice.id, invoice.id, invoice.id),
      entries: query('SELECT kind, cents, created FROM invoice_entries WHERE invoice=? ORDER BY created, reference', invoice.id)
    }));
  }
  return {
    bookings(account) {
      return query(`SELECT b.id, b.call, b.reference, b.evidence, b.cents, b.created, b.invoice, b.verified_by
        FROM booking_charges b WHERE b.account=? ORDER BY b.created DESC`, account);
    },
    verifyBooking(account, actor, data) {
      return transaction(() => {
        const [call] = query(`SELECT c.id FROM calls c JOIN sites s ON s.id=c.site
          JOIN assignments a ON a.id=c.assignment WHERE c.id=? AND s.account=? AND c.outcome='answered'`,
          data.call, account);
        if (!call) fail('An answered call assigned to a renter is required.', 404);
        const [prior] = query('SELECT id, call, cents, evidence FROM booking_charges WHERE account=? AND reference=?', account, data.reference);
        if (prior) {
          if (prior.call !== data.call || prior.cents !== data.cents || prior.evidence !== data.evidence) {
            fail('Booking reference is already in use.', 409);
          }
          return { id: prior.id };
        }
        const booking = id();
        run('INSERT INTO booking_charges VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)',
          booking, account, data.call, data.reference, data.evidence, data.cents, actor, now());
        return { id: booking };
      });
    },
    disputes(account) {
      return query(`SELECT d.*, r.name AS renter_name FROM invoice_disputes d JOIN invoices i ON i.id=d.invoice
        JOIN renters r ON r.id=i.renter WHERE i.account=? ORDER BY d.opened DESC`, account);
    },
    openDispute(account, invoice, reason) {
      return transaction(() => {
        if (!query('SELECT id FROM invoices WHERE id=? AND account=?', invoice, account).length) fail('Unknown invoice.', 404);
        const [prior] = query('SELECT id, reason FROM invoice_disputes WHERE invoice=? AND resolved IS NULL', invoice);
        if (prior) {
          if (prior.reason !== reason) fail('Invoice already has an open dispute.', 409);
          return { id: prior.id };
        }
        const dispute = id();
        run('INSERT INTO invoice_disputes (id, invoice, reason, opened) VALUES (?, ?, ?, ?)', dispute, invoice, reason, now());
        return { id: dispute };
      });
    },
    resolveDispute(account, dispute, resolution, credit) {
      return transaction(() => {
        const [record] = query(`SELECT d.* FROM invoice_disputes d JOIN invoices i ON i.id=d.invoice
          WHERE d.id=? AND i.account=?`, dispute, account);
        if (!record) fail('Unknown dispute.', 404);
        if (record.resolved) {
          if (record.resolution !== resolution || record.credit !== credit) fail('Dispute is already resolved.', 409);
          return { id: dispute, credit };
        }
        if (credit) {
          const [invoice] = query(summary + ' WHERE i.id=? GROUP BY i.id', record.invoice);
          if (credit > invoice.cents - invoice.applied) fail('Credit exceeds the invoice balance.', 409);
          run('INSERT INTO invoice_entries VALUES (?, ?, ?, ?, ?)', record.invoice, 'dispute:' + dispute, 'credit', credit, now());
        }
        run('UPDATE invoice_disputes SET resolved=?, resolution=?, credit=? WHERE id=?', now(), resolution, credit, dispute);
        return { id: dispute, credit };
      });
    },
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
      return invoiceDetails(query(summary + ' WHERE i.account=? GROUP BY i.id ORDER BY i.created DESC', account));
    },
    forRenter(renter) {
      return invoiceDetails(query(summary + ' WHERE i.renter=? GROUP BY i.id ORDER BY i.created DESC', renter));
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
        const bookings = query(`SELECT b.id, b.cents FROM booking_charges b
          JOIN calls c ON c.id=b.call JOIN assignments a ON a.id=c.assignment
          WHERE b.account=? AND a.renter=? AND b.invoice IS NULL AND (? IS NULL OR substr(b.created,1,7)=?)`,
        account, renter, period, period);
        if (!charges.length && !bookings.length && !rent) fail('There are no unbilled charges for this renter.', 409);
        const invoice = id();
        run('INSERT INTO invoices VALUES (?, ?, ?, ?)', invoice, account, renter, now());
        if (rent) run('INSERT INTO invoice_rent VALUES (?, ?, ?, ?)', invoice, renter, period, rent);
        for (const charge of charges) {
          run('INSERT INTO invoice_lines VALUES (?, ?, ?)', charge.call, invoice, charge.cents);
        }
        for (const booking of bookings) run('UPDATE booking_charges SET invoice=? WHERE id=?', invoice, booking.id);
        return { id: invoice, cents: [...charges, ...bookings].reduce((sum, charge) => sum + charge.cents, rent), rent };
      });
    }
  };
}
