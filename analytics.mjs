export function analytics(db, { query, run, required, fail, now }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS call_reviews (
      call TEXT PRIMARY KEY REFERENCES calls(id), transcript TEXT NOT NULL,
      summary TEXT NOT NULL, qualification TEXT NOT NULL, coaching TEXT NOT NULL,
      reviewed_by TEXT NOT NULL, updated TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS answering_profiles (
      site TEXT PRIMARY KEY REFERENCES sites(id), greeting TEXT NOT NULL,
      booking TEXT NOT NULL, escalation TEXT NOT NULL, fallback TEXT NOT NULL
    );
  `);
  function ownSite(account, site) {
    if (!query('SELECT id FROM sites WHERE id=? AND account=?', site, account).length) fail('Unknown site.', 404);
  }
  return {
    report(account) {
      return {
        calls: query(`SELECT c.id, c.created, c.source, COALESCE(a.campaign,'') AS campaign, s.name AS site_name,
          c.outcome, COALESCE(ch.cents,0) AS cents, r.transcript, r.summary, r.qualification, r.coaching,
          r.reviewed_by, r.updated,
          (SELECT COUNT(*) FROM booking_charges b WHERE b.call=c.id) AS bookings
          FROM calls c JOIN sites s ON s.id=c.site
          LEFT JOIN charges ch ON ch.call=c.id LEFT JOIN call_attribution a ON a.call=c.id
          LEFT JOIN call_reviews r ON r.call=c.id WHERE s.account=? ORDER BY c.created DESC, c.id`, account),
        campaigns: query(`SELECT source, campaign, SUM(calls) AS calls, SUM(forms) AS forms, SUM(chats) AS chats,
          SUM(charges) AS call_charges FROM (
            SELECT c.source, COALESCE(a.campaign,'') AS campaign, 1 AS calls, 0 AS forms, 0 AS chats,
              COALESCE(ch.cents,0) AS charges FROM calls c JOIN sites s ON s.id=c.site
              LEFT JOIN call_attribution a ON a.call=c.id LEFT JOIN charges ch ON ch.call=c.id WHERE s.account=?
            UNION ALL
            SELECT l.source, l.campaign, 0, l.channel='form', l.channel='chat', 0
              FROM web_leads l JOIN sites s ON s.id=l.site WHERE s.account=?
          ) GROUP BY source, campaign ORDER BY source, campaign`, account, account),
        network: query(`SELECT COUNT(*) AS calls, COALESCE(SUM(revenue),0) AS revenue,
          COALESCE(SUM(payout),0) AS payout FROM network_calls WHERE account=?`, account)[0],
        profiles: query(`SELECT p.*, s.name AS site_name FROM answering_profiles p
          JOIN sites s ON s.id=p.site WHERE s.account=? ORDER BY s.name, s.id`, account)
      };
    },
    analyze(account, data) {
      const call = required(data.call, 'call');
      const [record] = query(`SELECT c.outcome FROM calls c JOIN sites s ON s.id=c.site
        WHERE c.id=? AND s.account=?`, call, account);
      if (!record) fail('Unknown call.', 404);
      if (record.outcome !== 'answered') fail('Select an answered call.', 409);
      const transcript = typeof data.transcript === 'string' ? data.transcript.trim() : '';
      if (!transcript || transcript.length > 6000) fail('Enter a transcript of 1 to 6,000 characters.');
      const lines = transcript.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      const callerLines = lines.filter(line => /^caller\s*:/i.test(line));
      const excerpt = (callerLines[0] || lines[0]).slice(0, 200);
      const caller = callerLines.join(' ');
      const signal = /\b(?:i (?:want|need|would like) to (?:book|schedule)|can (?:i|we) (?:book|schedule))\b/i.test(caller);
      const qualification = signal ? 'booking-intent' : 'review-required';
      const coaching = signal ? 'Confirm the requested date, service, and next steps.' :
        'Review caller intent and confirm a specific next step.';
      return { call, transcript, summary: excerpt, qualification, coaching };
    },
    saveReview(account, actor, data) {
      const analysis = this.analyze(account, data);
      if (!['qualified','unqualified','review-required'].includes(data.qualification)) fail('Choose a review outcome.');
      const summary = required(data.summary, 'review summary');
      const coaching = required(data.coaching, 'coaching note');
      run(`INSERT INTO call_reviews VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(call) DO UPDATE SET
        transcript=excluded.transcript, summary=excluded.summary, qualification=excluded.qualification,
        coaching=excluded.coaching, reviewed_by=excluded.reviewed_by, updated=excluded.updated`,
      analysis.call, analysis.transcript, summary, data.qualification, coaching, actor, now());
      return { call: analysis.call };
    },
    profile(account, data) {
      const site = required(data.site, 'site');
      ownSite(account, site);
      const lines = ['greeting','booking','escalation','fallback'].map(key => required(data[key], key));
      run(`INSERT INTO answering_profiles VALUES (?, ?, ?, ?, ?) ON CONFLICT(site) DO UPDATE SET
        greeting=excluded.greeting, booking=excluded.booking, escalation=excluded.escalation, fallback=excluded.fallback`,
      site, ...lines);
      return { site };
    },
    simulate(account, data) {
      const site = required(data.site, 'site');
      ownSite(account, site);
      const [profile] = query('SELECT * FROM answering_profiles WHERE site=?', site);
      if (!profile) fail('Save an answering profile first.', 409);
      const message = required(data.message, 'caller message');
      let intent = 'fallback';
      if (/\b(?:human|person|representative|emergency)\b/i.test(message)) intent = 'escalation';
      else if (/\b(?:book|schedule|appointment)\b/i.test(message)) intent = 'booking';
      return { greeting: profile.greeting, intent, response: profile[intent] };
    }
  };
}
