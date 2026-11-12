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
  const plan = { site: site.id, routes: [{ label: 'Backup', destination: '+16025550103' }] };
  await post(other, 'routing', plan, 404);
  await post(viewer, 'routing', plan, 403);
  await post(owner, 'routing', plan, 200);
  const fallback = await post(owner, 'routing/preview', { site: site.id, failed: ['+16025550101'] }, 200);
  assert.equal(fallback.next.destination, '+16025550103');
  assert.deepEqual((await api('routing', { cookie: other })).data, []);
  const menu = { site: site.id, prompt: 'Press one for sales.', options: [
    { digit: '1', label: 'Sales', destination: '+16025550104' }
  ] };
  await post(other, 'routing/menu', menu, 404);
  await post(viewer, 'routing/menu', menu, 403);
  await post(owner, 'routing/menu', menu, 200);
  await post(owner, 'routing/menu', { ...menu, options: [...menu.options, ...menu.options] }, 400);
  assert.deepEqual((await api('routing/menu', { cookie: other })).data, []);
  const selection = await post(owner, 'routing/preview', { site: site.id, digit: '1' }, 200);
  assert.equal(selection.next.destination, '+16025550104');
  assert.equal((await post(owner, 'routing/preview', { site: site.id, digit: '9' }, 200)).menuStatus, 'invalid-digit');
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
  const booking = { call: call.id, reference: 'booking-001', evidence: 'Confirmed by dispatch', cents: 2500 };
  await post(other, 'bookings', booking, 404);
  await post(viewer, 'bookings', booking, 403);
  const verified = await post(owner, 'bookings', booking);
  assert.deepEqual(await post(owner, 'bookings', booking), verified);
  await post(owner, 'bookings', { ...booking, cents: 3000 }, 409);
  const bookingInvoice = await post(owner, 'invoices', { renter: renter.id });
  assert.equal(bookingInvoice.cents, 2500);
  await post(owner, 'invoices', { renter: renter.id }, 409);
  const complaint = { invoice: bookingInvoice.id, reason: 'Service was rescheduled' };
  await post(other, 'disputes', complaint, 404);
  const dispute = await post(owner, 'disputes', complaint);
  const portalInvoice = async () => (await api('portal/' + portal)).data.invoices.find(row => row.id === bookingInvoice.id);
  assert.equal((await portalInvoice()).disputed, 1);
  const resolution = { dispute: dispute.id, resolution: 'Partial credit approved', cents: 1000 };
  await post(other, 'disputes/resolve', resolution, 404);
  await post(owner, 'disputes/resolve', { ...resolution, cents: 2501 }, 409);
  await post(owner, 'disputes/resolve', resolution, 200);
  await post(owner, 'disputes/resolve', resolution, 200);
  assert.equal((await portalInvoice()).applied, 1000);
  assert.equal((await portalInvoice()).disputed, 0);
  assert.equal((await portalInvoice()).bookings, 1);
  assert.deepEqual((await portalInvoice()).lines.map(({ kind, reference, cents }) => ({ kind, reference, cents })),
    [{ kind: 'booking', reference: 'booking-001', cents: 2500 }]);
  assert.deepEqual((await portalInvoice()).entries.map(({ kind, cents }) => ({ kind, cents })),
    [{ kind: 'credit', cents: 1000 }]);
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
  const poolNumber = '+16025550106';
  await post(other, 'tracking-pool', { site: site.id, number: poolNumber }, 404);
  await post(owner, 'tracking-pool', { site: site.id, number: poolNumber });
  await post(other, 'sites', { name: 'Duplicate number', number: poolNumber }, 409);
  const lease = async data => {
    const response = await fetch(origin + '/tracking/' + site.id, {
      method: 'POST', headers: { Origin: 'https://example.test' }, body: JSON.stringify(data)
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    return response.json();
  };
  const assigned = await lease({ source: 'Paid search', campaign: 'Spring sale' });
  assert.equal(assigned.number, poolNumber);
  assert.equal((await lease({ visitor: assigned.visitor })).number, poolNumber);
  assert.deepEqual((await lease({})).number, number);
  await post(other, 'calls', { number: poolNumber, source: 'Fake' }, 404);
  const tracked = await post(owner, 'calls', { number: poolNumber, source: 'Manual override' });
  const attributed = (await api('calls', { cookie: owner })).data.find(row => row.id === tracked.id);
  assert.equal(attributed.source, 'Paid search');
  assert.equal(attributed.campaign, 'Spring sale');
  const menuCall = await post(owner, 'calls', { number, source: 'Test', digit: '1' });
  assert.equal(menuCall.destination, '+16025550104');
  assert.equal((await post(owner, 'calls/' + menuCall.id + '/complete', { duration: 120, outcome: 'answered' }, 200)).cents, 0);
  const backup = await post(owner, 'calls', { number, source: 'Test', digit: '1', failed: ['+16025550104', '+16025550101'] });
  assert.equal(backup.destination, '+16025550103');
  const invalid = await post(owner, 'calls', { number, source: 'Test', digit: '9' });
  assert.equal(invalid.destination, null);
  const routingLog = (await api('calls', { cookie: owner })).data;
  assert.equal(routingLog.find(row => row.id === menuCall.id).simulated_menu_status, 'selected');
  assert.equal(routingLog.find(row => row.id === backup.id).simulated_destination, '+16025550103');
  const recording = { site: site.id, enabled: true, disclosure: 'This call may be recorded.' };
  await post(other, 'communications/recording', recording, 404);
  await post(viewer, 'communications/recording', recording, 403);
  await post(owner, 'communications/recording', { ...recording, disclosure: '' }, 400);
  await post(owner, 'communications/recording', recording, 200);
  const consented = await post(owner, 'calls', { number, source: 'Consent test', recordingConsent: 'granted' });
  assert.deepEqual(consented.recording, { disclosure: recording.disclosure, decision: 'consented' });
  const declined = await post(owner, 'calls', { number, source: 'Consent test', recordingConsent: 'declined' });
  assert.equal(declined.recording.decision, 'declined');
  const unansweredConsent = await post(owner, 'calls', { number, source: 'Consent test' });
  assert.equal(unansweredConsent.recording.decision, 'awaiting-consent');
  const beforeInvalid = (await api('calls', { cookie: owner })).data.length;
  await post(owner, 'calls', { number, source: 'Consent test', recordingConsent: 'invalid' }, 400);
  assert.equal((await api('calls', { cookie: owner })).data.length, beforeInvalid);
  await post(owner, 'communications/recording', { site: site.id, enabled: false }, 200);
  assert.equal((await post(owner, 'calls', { number, source: 'Consent test' })).recording.decision, 'disabled');
  const saved = (await api('calls', { cookie: owner })).data.find(row => row.id === consented.id);
  assert.equal(saved.simulated_disclosure, recording.disclosure);
  assert.equal(saved.simulated_recording_decision, 'consented');
  await post(owner, 'communications/recording', recording, 200);
  const callback = await post(owner, 'communications/callbacks', { site: site.id, destination: '+16025550107' }, 200);
  await post(other, 'communications/cancel-callback', { id: callback.id }, 404);
  await post(owner, 'communications/cancel-callback', { id: callback.id }, 200);
  await post(owner, 'communications/sms', { site: site.id, sender: '+16025550107', message: 'Please call me back.' }, 200);
  const comms = (await api('communications', { cookie: owner })).data;
  assert.equal(comms.recordings[0].disclosure, recording.disclosure);
  assert.equal(comms.callbacks[0].state, 'canceled');
  assert.equal(comms.messages[0].body, 'Please call me back.');
  const numberRequest = { site: site.id, kind: 'provision', requested: '602' };
  await post(other, 'communications/numbers', numberRequest, 404);
  await post(viewer, 'communications/numbers', numberRequest, 403);
  await post(owner, 'communications/numbers', { ...numberRequest, requested: '001' }, 400);
  const draft = await post(owner, 'communications/numbers', numberRequest, 200);
  assert.deepEqual(await post(owner, 'communications/numbers', numberRequest, 200), draft);
  await post(other, 'communications/cancel-number', { id: draft.id }, 404);
  await post(owner, 'communications/cancel-number', { id: draft.id }, 200);
  const port = await post(owner, 'communications/numbers', { ...numberRequest, kind: 'port', requested: number }, 200);
  assert.equal(port.state, 'draft');
  const numberRequests = (await api('communications', { cookie: owner })).data.numberRequests;
  assert.equal(numberRequests.find(row => row.id === draft.id).state, 'canceled');
  assert.equal(numberRequests.find(row => row.id === port.id).requested, number);
  assert.deepEqual((await api('communications', { cookie: other })).data,
    { recordings: [], callbacks: [], messages: [], numberRequests: [] });
  await post(owner, 'network/suppression', { region: 'AZ', enabled: true }, 200);
  assert.equal((await post(owner, 'network/ping', route, 200)).outcome, 'suppressed');
  await post(owner, 'logout', {}, 200);
  await api('session', { cookie: owner, status: 401 });
});
