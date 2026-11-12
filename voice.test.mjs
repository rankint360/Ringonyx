import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';

test('signed carrier calls preserve routing and qualify only once', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'ringonyx-voice-'));
  const base = 'https://ringonyx.example.test';
  const token = 'test-credential';
  const accountSid = 'AC' + 'a'.repeat(32);
  const env = { ...process.env, NODE_ENV: 'test', PORT: '0', RINGONYX_DB: join(directory, 'voice.sqlite'),
    TWILIO_ACCOUNT_SID: accountSid, TWILIO_AUTH_TOKEN: token, RINGONYX_VOICE_ORIGIN: base, RINGONYX_OPERATOR_KEY: 'test' };
  const child = spawn(process.execPath, ['server.mjs'], { env });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    rmSync(directory, { recursive: true, force: true });
  });
  const [message] = await once(child.stdout, 'data', { signal: AbortSignal.timeout(10000) });
  const origin = message.toString().trim().split(' ').at(-1);
  async function api(path, body, expected = body ? 201 : 200) {
    const result = await fetch(origin + '/api/' + path, { method: body ? 'POST' : 'GET',
      headers: { 'X-Ringonyx-Operator': 'test' }, body: body && JSON.stringify(body) });
    assert.equal(result.status, expected);
    return result.json();
  }
  const number = '+16025550100';
  const site = await api('sites', { name: 'Phoenix', number });
  const first = await api('renters', { name: 'First', destination: '+16025550101' });
  const second = await api('renters', { name: 'Second', destination: '+16025550102' });
  const assign = renter => api('assignments', { site: site.id, renter: renter.id, rate: 4500, minimum: 90 });
  await assign(first);
  const bind = spawnSync(process.execPath, ['server.mjs', '--enable-voice', site.id, 'Google Ads'], { env, encoding: 'utf8' });
  assert.equal(bind.status, 0, bind.stderr);
  const voice = '/webhooks/twilio/voice';
  const fields = { CallSid: 'CA' + '1'.repeat(32), AccountSid: accountSid, To: number };
  async function callback(path, values, valid = true, expected = 200) {
    const payload = base + path + Object.keys(values).sort().map(key => key + values[key]).join('');
    const signature = createHmac('sha1', token).update(payload).digest('base64');
    const result = await fetch(origin + path, { method: 'POST', headers: { 'X-Twilio-Signature': valid ? signature : 'invalid' },
      body: new URLSearchParams(values) });
    assert.equal(result.status, expected);
    return result.text();
  }
  await callback(voice, fields, false, 403);
  const answer = await callback(voice, fields);
  assert.match(answer, /<Number>\+16025550101<\/Number>/);
  await assign(second);
  assert.equal(await callback(voice, fields), answer);
  const [call] = await api('calls');
  await api('calls/' + call.id + '/complete', { duration: 95, outcome: 'answered' }, 404);
  const completion = { ...fields, DialCallStatus: 'completed', DialCallDuration: '95' };
  await callback(voice + '/complete', completion);
  await callback(voice + '/complete', completion);
  const [charged] = await api('calls');
  assert.equal(charged.cents, 4500);
  assert.equal(charged.source, 'Google Ads');
  assert.equal(charged.renter_name, 'First');
  const check = new DatabaseSync(env.RINGONYX_DB, { readOnly: true });
  assert.equal(check.prepare('SELECT count(*) AS count FROM charges').get().count, 1);
  check.close();
});
