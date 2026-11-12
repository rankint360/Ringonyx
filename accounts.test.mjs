import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { test } from 'node:test';

test('workspace sessions isolate reads, writes, assignments, and call completion', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'ringonyx-'));
  const env = { ...process.env, PORT: '0', NODE_ENV: 'production', RINGONYX_DB: join(directory, 'test.sqlite'), RINGONYX_OPERATOR_KEY: 'ignored-in-production' };
  const password = 'test-password-for-accounts';
  const provision = (...args) => {
    const result = spawnSync(process.execPath, ['server.mjs', '--provision', ...args], { env, input: password, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim().split(' ').at(-1);
  };
  let child;
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    rmSync(directory, { recursive: true, force: true });
  });
  const first = provision('owner@example.test', 'owner', '--new', 'First workspace');
  provision('viewer@example.test', 'viewer', '--account', first);
  provision('other@example.test', 'owner', '--new', 'Second workspace');
  child = spawn(process.execPath, ['server.mjs'], { env });
  const [message] = await once(child.stdout, 'data', { signal: AbortSignal.timeout(10000) });
  const origin = message.toString().trim().split(' ').at(-1);
  async function api(path, { cookie, body, status = 200 } = {}) {
    const response = await fetch(origin + '/api/' + path, {
      method: body ? 'POST' : 'GET',
      headers: { ...(cookie ? { Cookie: cookie } : {}), 'X-Ringonyx-Operator': 'ignored-in-production' },
      body: body && JSON.stringify(body)
    });
    const data = await response.json();
    assert.equal(response.status, status, JSON.stringify(data));
    return { data, response };
  }
  async function signIn(email) {
    const { response } = await api('login', { body: { email, password } });
    const cookie = response.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly; SameSite=Strict; Max-Age=43200; Secure/);
    return cookie.split(';')[0];
  }
  await api('sites', { status: 401 });
  const crossOrigin = await fetch(origin + '/api/login', {
    method: 'POST', headers: { Origin: 'https://other.example.test' },
    body: JSON.stringify({ email: 'owner@example.test', password })
  });
  assert.equal(crossOrigin.status, 403);
  await api('login', { body: { email: 'owner@example.test', password: 'wrong' }, status: 401 });
  const owner = await signIn('owner@example.test');
  const viewer = await signIn('viewer@example.test');
  const other = await signIn('other@example.test');
  const post = async (cookie, path, body, status = 201) => (await api(path, { cookie, body, status })).data;
  const number = '+16025550100';
  const site = await post(owner, 'sites', { name: 'Plumbing', number });
  const renter = await post(owner, 'renters', { name: 'Renter', destination: '+16025550101' });
  const foreignRenter = await post(other, 'renters', { name: 'Other', destination: '+16025550102' });
  const assignment = { site: site.id, renter: renter.id, rate: 4500, minimum: 90 };
  await post(other, 'voice/numbers', { site: site.id, source: 'Other campaign' }, 404);
  await post(viewer, 'voice/numbers', { site: site.id, source: 'Other campaign' }, 403);
  await post(owner, 'voice/numbers', { site: site.id, source: 'Google Ads' }, 200);
  assert.equal((await api('sites', { cookie: owner })).data[0].voice_source, 'Google Ads');
  await post(other, 'assignments', assignment, 404);
  await post(owner, 'assignments', { ...assignment, renter: foreignRenter.id }, 404);
  await post(viewer, 'assignments', assignment, 403);
  await post(owner, 'assignments', assignment);
  const call = await post(owner, 'calls', { number, source: 'Google Ads' });
  await post(other, 'calls', { number, source: 'Google Ads' }, 404);
  await post(other, 'calls/' + call.id + '/complete', { duration: 90, outcome: 'answered' }, 404);
  await post(owner, 'calls/' + call.id + '/complete', { duration: 90, outcome: 'answered' }, 200);
  await post(other, 'invoices', { renter: renter.id }, 404);
  await post(viewer, 'invoices', { renter: renter.id }, 403);
  const invoice = await post(owner, 'invoices', { renter: renter.id });
  assert.equal(invoice.cents, 4500);
  const payment = { invoice: invoice.id, reference: 'payment-001', cents: 3000, kind: 'payment' };
  await post(other, 'invoice-entries', payment, 404);
  await post(viewer, 'invoice-entries', payment, 403);
  assert.equal((await post(owner, 'invoice-entries', payment, 200)).balance, 1500);
  assert.equal((await post(owner, 'invoice-entries', payment, 200)).balance, 1500);
  await post(owner, 'invoice-entries', { ...payment, cents: 3100 }, 409);
  await post(owner, 'invoice-entries', { ...payment, reference: 'credit-001', kind: 'credit' }, 409);
  assert.equal((await post(owner, 'invoice-entries', { ...payment, reference: 'credit-001', cents: 1500, kind: 'credit' }, 200)).balance, 0);
  await post(owner, 'invoices', { renter: renter.id }, 409);
  assert.deepEqual((await api('invoices', { cookie: other })).data, []);
  const portal = (await api('renters', { cookie: owner })).data[0].portal;
  assert.equal((await api('portal/' + portal)).data.invoices[0].id, invoice.id);
  assert.equal((await api('portal/' + portal)).data.invoices[0].applied, 4500);
  const monthly = { renter: renter.id, period: '2026-11', cents: 75000 };
  await post(other, 'rental-rates', monthly, 404);
  await post(owner, 'rental-rates', monthly, 200);
  const rentInvoice = await post(owner, 'invoices', { renter: renter.id, period: '2026-12' });
  assert.equal(rentInvoice.cents, 75000);
  assert.equal(rentInvoice.rent, 75000);
  await post(owner, 'invoices', { renter: renter.id, period: '2026-12' }, 409);
  await post(owner, 'rental-rates', { ...monthly, period: '2027-01', cents: 0 }, 200);
  await post(owner, 'invoices', { renter: renter.id, period: '2027-01' }, 409);
  for (const path of ['sites', 'assignments', 'calls']) {
    assert.deepEqual((await api(path, { cookie: other })).data, []);
    assert.equal((await api(path, { cookie: viewer })).data.length, 1);
  }
  assert.equal((await api('renters', { cookie: viewer })).data[0].portal, undefined);
  const buyer = await post(owner, 'network/buyers', {
    name: 'Phoenix Buyer', destination: '+16025550112', region: 'AZ', price: 6000, minimum: 90, cap: 2, concurrency: 1
  }, 200);
  const offer = await post(owner, 'network/publishers', { name: 'Publisher', payout: 2500 }, 200);
  const route = { offer: offer.id, region: 'AZ', floor: 5500 };
  await post(other, 'network/post', { ...route, reference: 'call-1' }, 404);
  await post(viewer, 'network/post', { ...route, reference: 'call-1' }, 403);
  assert.equal((await post(owner, 'network/ping', route, 200)).bid, 6000);
  assert.equal((await api('network', { cookie: owner })).data.calls.length, 0);
  const submitted = await post(owner, 'network/post', { ...route, reference: 'call-1' }, 200);
  assert.equal(submitted.buyer, buyer.id);
  assert.deepEqual(await post(owner, 'network/post', { ...route, reference: 'call-1' }, 200), submitted);
  assert.equal((await post(owner, 'network/ping', route, 200)).outcome, 'unmatched');
  const settlement = { call: submitted.id, seconds: 90, outcome: 'answered' };
  await post(other, 'network/complete', settlement, 404);
  assert.deepEqual(await post(owner, 'network/complete', settlement, 200), { revenue: 6000, payout: 2500 });
  assert.deepEqual(await post(owner, 'network/complete', settlement, 200), { revenue: 6000, payout: 2500 });
  const network = (await api('network', { cookie: owner })).data;
  const publisher = network.publishers[0];
  const publisherView = await api('network-portal/publisher/' + publisher.token);
  assert.equal(publisherView.data.calls[0].cents, 2500);
  const buyerView = await api('network-portal/buyer/' + network.buyers[0].token);
  assert.equal(buyerView.data.calls[0].cents, 6000);
  const publisherPing = await fetch(origin + '/api/publisher/ping', {
    method: 'POST', headers: { Authorization: 'Bearer ' + publisher.api_token },
    body: JSON.stringify({ region: 'AZ', strategy: 'predictive' })
  });
  assert.equal(publisherPing.status, 200);
  assert.equal((await publisherPing.json()).bid, 6000);
  assert.equal((await api('network', { cookie: viewer })).data.publishers[0].api_token, undefined);
  assert.deepEqual((await api('network', { cookie: other })).data.calls, []);
  await post(owner, 'network/suppression', { region: 'AZ', enabled: true }, 200);
  assert.equal((await post(owner, 'network/ping', route, 200)).outcome, 'suppressed');
  await post(owner, 'logout', {}, 200);
  await api('session', { cookie: owner, status: 401 });
});
