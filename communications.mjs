import { randomUUID } from 'node:crypto';

export function communications(db, { query, run, fail, required, phone, now }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS recording_settings (
      site TEXT PRIMARY KEY REFERENCES sites(id), enabled INTEGER NOT NULL, disclosure TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS callback_requests (
      id TEXT PRIMARY KEY, site TEXT NOT NULL REFERENCES sites(id), destination TEXT NOT NULL,
      created TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'queued'
    );
    CREATE TABLE IF NOT EXISTS inbound_messages (
      id TEXT PRIMARY KEY, site TEXT NOT NULL REFERENCES sites(id), sender TEXT NOT NULL,
      body TEXT NOT NULL, created TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS simulated_recording_decisions (
      call TEXT PRIMARY KEY REFERENCES calls(id), disclosure TEXT NOT NULL,
      decision TEXT NOT NULL CHECK(decision IN ('disabled','unrouted','awaiting-consent','declined','consented'))
    );
    CREATE TABLE IF NOT EXISTS number_requests (
      id TEXT PRIMARY KEY, site TEXT NOT NULL REFERENCES sites(id),
      kind TEXT NOT NULL CHECK(kind IN ('provision','port')),
      requested TEXT NOT NULL, created TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','canceled'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS open_number_request
      ON number_requests(site, kind, requested) WHERE state='draft';
  `);
  function scoped(table, account, order) {
    return query(`SELECT x.*, s.name AS site_name FROM ${table} x JOIN sites s ON s.id=x.site
      WHERE s.account=? ORDER BY ${order}`, account);
  }
  const operations = {
    numbers(site, data) {
      const kind = data.kind;
      if (!['provision', 'port'].includes(kind)) fail('Choose provision or port.');
      let requested;
      if (kind === 'port') requested = phone(data.requested);
      else {
        requested = required(data.requested, 'area code');
        if (!/^[2-9]\d{2}$/.test(requested)) fail('Enter a three-digit NANP area code.');
      }
      const id = randomUUID();
      run(`INSERT INTO number_requests (id, site, kind, requested, created) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(site, kind, requested) WHERE state='draft' DO NOTHING`, id, site, kind, requested, now());
      return query("SELECT id, state FROM number_requests WHERE site=? AND kind=? AND requested=? AND state='draft'",
        site, kind, requested)[0];
    },
    recording(site, data) {
      if (typeof data.enabled !== 'boolean') fail('Choose whether recording is enabled.');
      const disclosure = data.enabled ? required(data.disclosure, 'recording disclosure') : '';
      run(`INSERT INTO recording_settings VALUES (?, ?, ?) ON CONFLICT(site)
        DO UPDATE SET enabled=excluded.enabled, disclosure=excluded.disclosure`, site, Number(data.enabled), disclosure);
      return { site, enabled: data.enabled, disclosure };
    },
    callbacks(site, data) {
      const id = randomUUID();
      run('INSERT INTO callback_requests (id, site, destination, created) VALUES (?, ?, ?, ?)',
        id, site, phone(data.destination), now());
      return { id, state: 'queued' };
    },
    sms(site, data) {
      const id = randomUUID();
      const message = data.message;
      if (typeof message !== 'string' || !message.trim() || message.length > 1600) fail('Enter a message of 1 to 1,600 characters.');
      run('INSERT INTO inbound_messages VALUES (?, ?, ?, ?, ?)', id, site, phone(data.sender), message.trim(), now());
      return { id };
    }
  };
  return {
    simulateRecording(call, site, destination, consent) {
      if (consent !== undefined && consent !== '' && !['granted', 'declined'].includes(consent)) {
        fail('Choose a valid recording consent response.');
      }
      const [settings] = query('SELECT enabled, disclosure FROM recording_settings WHERE site=?', site);
      const disclosure = destination && settings?.enabled ? settings.disclosure : '';
      let decision = 'disabled';
      if (!destination) decision = 'unrouted';
      else if (disclosure) {
        decision = consent === 'granted' ? 'consented' : consent === 'declined' ? 'declined' : 'awaiting-consent';
      }
      run('INSERT INTO simulated_recording_decisions VALUES (?, ?, ?)', call, disclosure, decision);
      return { disclosure, decision };
    },
    list(account) {
      return {
        recordings: scoped('recording_settings', account, 's.name'),
        callbacks: scoped('callback_requests', account, 'x.created DESC, x.id'),
        messages: scoped('inbound_messages', account, 'x.created DESC, x.id'),
        numberRequests: scoped('number_requests', account, 'x.created DESC, x.id')
      };
    },
    write(account, action, data) {
      if (action === 'cancel-number') {
        const id = required(data.id, 'number request');
        const result = run(`UPDATE number_requests SET state='canceled' WHERE id=?
          AND site IN (SELECT id FROM sites WHERE account=?)`, id, account);
        if (!result.changes) fail('Unknown number request.', 404);
        return { id, state: 'canceled' };
      }
      if (action === 'cancel-callback') {
        const id = required(data.id, 'callback');
        const result = run(`UPDATE callback_requests SET state='canceled' WHERE id=? AND state='queued'
          AND site IN (SELECT id FROM sites WHERE account=?)`, id, account);
        if (!result.changes && !query(`SELECT c.id FROM callback_requests c JOIN sites s ON s.id=c.site
          WHERE c.id=? AND s.account=? AND c.state='canceled'`, id, account).length) fail('Unknown callback.', 404);
        return { id, state: 'canceled' };
      }
      if (!Object.hasOwn(operations, action)) fail('Unknown communications operation.', 404);
      const site = required(data.site, 'site');
      if (!query('SELECT id FROM sites WHERE id=? AND account=?', site, account).length) fail('Unknown site.', 404);
      return operations[action](site, data);
    }
  };
}
