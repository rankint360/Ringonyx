import { createHmac, timingSafeEqual } from 'node:crypto';

const inboundPath = '/webhooks/twilio/voice';
const completionPath = '/webhooks/twilio/voice/complete';
const phone = value => /^\+[1-9]\d{7,14}$/.test(value || '');
const callSid = value => /^CA[0-9a-f]{32}$/i.test(value || '');
const xml = value => String(value).replace(/[<>&"']/g, character => ({
  '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;'
})[character]);
const response = content => '<?xml version="1.0" encoding="UTF-8"?><Response>' + content + '</Response>';
const hangup = response('<Hangup/>');

export function initializeVoice(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS voice_numbers (
      site TEXT PRIMARY KEY REFERENCES sites(id), source TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS carrier_calls (
      sid TEXT PRIMARY KEY, call TEXT UNIQUE REFERENCES calls(id),
      destination TEXT, reply TEXT NOT NULL
    );
  `);
}

export function enableNumber(db, site, source) {
  if (!source?.trim() || source.length > 200) throw Error('Enter a source label of 1 to 200 characters.');
  if (!db.prepare('SELECT id FROM sites WHERE id=?').get(site)) throw Error('Unknown site.');
  db.prepare(`INSERT INTO voice_numbers VALUES (?, ?) ON CONFLICT(site) DO UPDATE SET source=excluded.source`)
    .run(site, source.trim());
}

export function voiceHandler({ query, run, transaction, arrive, complete, fail, readBody, config }) {
  const { token, sid, base } = config;
  if ([token, sid, base].some(Boolean)) {
    if (!token || !/^AC[0-9a-f]{32}$/i.test(sid || '') || !base) throw Error('Configure all three Twilio voice settings.');
    const url = new URL(base);
    if (url.protocol !== 'https:' || url.origin !== base || url.username || url.password) throw Error('Voice origin must be a bare HTTPS origin.');
  }
  async function signedForm(req, pathname) {
    if (!token) fail('Voice integration is not configured.', 503);
    if (req.url !== pathname) fail('Unexpected webhook URL.', 400);
    if (!/^application\/x-www-form-urlencoded(?:;|$)/i.test(req.headers['content-type'] || '')) {
      fail('Expected a carrier form.', 415);
    }
    const params = new URLSearchParams(await readBody(req));
    const values = new Map();
    for (const [key, value] of params) {
      if (!values.has(key)) values.set(key, new Set());
      values.get(key).add(value);
    }
    let payload = base + pathname;
    for (const key of [...values.keys()].sort()) {
      for (const value of [...values.get(key)].sort()) payload += key + value;
    }
    const expected = createHmac('sha1', token).update(payload).digest();
    const signature = Buffer.from(String(req.headers['x-twilio-signature'] || ''), 'base64');
    if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) fail('Invalid carrier signature.', 403);
    for (const field of ['CallSid', 'AccountSid', 'To', 'DialCallStatus', 'DialCallDuration']) {
      if (params.getAll(field).length > 1) fail('Ambiguous carrier form.', 400);
    }
    if (params.get('AccountSid') !== sid || !callSid(params.get('CallSid'))) fail('Unexpected carrier account or call.', 403);
    return params;
  }
  return async function handle(req, res, pathname) {
    if (pathname !== inboundPath && pathname !== completionPath) return false;
    if (req.method !== 'POST') fail('Method not allowed.', 405);
    const params = await signedForm(req, pathname);
    const providerId = params.get('CallSid');
    const reply = transaction(() => {
      const [known] = query(`SELECT cc.*, s.account FROM carrier_calls cc
        LEFT JOIN calls c ON c.id=cc.call LEFT JOIN sites s ON s.id=c.site WHERE cc.sid=?`, providerId);
      if (pathname === completionPath) {
        if (!known?.call || !known.destination) fail('Unknown dial attempt.', 404);
        const state = params.get('DialCallStatus');
        if (!['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(state)) fail('Unexpected dial status.', 400);
        const rawDuration = params.get('DialCallDuration');
        if (state === 'completed' && !/^\d{1,5}$/.test(rawDuration || '')) fail('Missing or invalid dial duration.', 400);
        complete(known.call, { outcome: state === 'completed' ? 'answered' : 'missed', duration: state === 'completed' ? Number(rawDuration) : 0 }, known.account);
        return hangup;
      }
      if (known) return known.reply;
      const to = params.get('To');
      if (!phone(to)) fail('Invalid tracking number.', 400);
      const [site] = query(`SELECT s.id, s.account, v.source FROM sites s JOIN voice_numbers v ON v.site=s.id WHERE s.number=?`, to);
      if (!site) return hangup;
      const call = arrive(site, site.source, true);
      const answer = call.destination
        ? response('<Dial answerOnBridge="true" method="POST" timeout="25" action="' +
          xml(base + completionPath) + '"><Number>' + xml(call.destination) + '</Number></Dial>')
        : response('<Say>This number has no available destination.</Say><Hangup/>');
      run('INSERT INTO carrier_calls VALUES (?, ?, ?, ?)', providerId, call.id, call.destination, answer);
      return answer;
    });
    res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
    res.end(reply);
    return true;
  };
}
