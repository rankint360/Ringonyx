import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
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
  const busyRoute = await post(owner, 'routing/preview', { site: site.id, scenario: 'busy' }, 200);
  assert.equal(busyRoute.next.destination, '+16025550103');
  assert.equal(busyRoute.steps[0].reason, 'busy');
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
  assert.ok((await api('portal/' + portal)).data.calls.some(row =>
    row.invoice === invoice.id && row.qualification_minimum === 90 && row.agreed_rate === 4500));
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
  const invoiceInput = { buyer: buyer.id };
  await post(other, 'network/invoices', invoiceInput, 404);
  await post(viewer, 'network/invoices', invoiceInput, 403);
  const buyerInvoice = await post(owner, 'network/invoices', invoiceInput, 200);
  assert.equal(buyerInvoice.cents, 6000);
  assert.equal(buyerInvoice.calls, 1);
  await post(owner, 'network/invoices', invoiceInput, 409);
  const invoiceNetwork = (await api('network', { cookie: owner })).data;
  assert.equal(invoiceNetwork.calls.find(row => row.id === submitted.id).invoice, buyerInvoice.id);
  const buyerToken = invoiceNetwork.buyers.find(row => row.id === buyer.id).token;
  const buyerInvoices = (await api('network-portal/buyer/' + buyerToken)).data.invoices;
  assert.deepEqual(buyerInvoices[0].lines, [{ reference: 'call-1', cents: 6000 }]);
  const networkComplaint = { invoice: buyerInvoice.id, reason: 'Review call qualification' };
  await post(other, 'network/dispute', networkComplaint, 404);
  await post(viewer, 'network/dispute', networkComplaint, 403);
  await post(owner, 'network-portal/buyer/unknown-token', networkComplaint, 404);
  await post(owner, 'network-portal/buyer/' + buyerToken, networkComplaint, 200);
  const networkResolution = { invoice: buyerInvoice.id, resolution: 'Call met the agreed minimum' };
  await post(other, 'network/resolve-dispute', networkResolution, 404);
  await post(owner, 'network/resolve-dispute', networkResolution, 200);
  await post(owner, 'network/resolve-dispute', networkResolution, 200);
  await post(owner, 'network/resolve-dispute', { ...networkResolution, resolution: 'Different outcome' }, 409);
  const disputedBuyerInvoice = (await api('network-portal/buyer/' + buyerToken)).data.invoices[0];
  assert.equal(disputedBuyerInvoice.reason, networkComplaint.reason);
  assert.equal(disputedBuyerInvoice.resolution, networkResolution.resolution);
  assert.ok(disputedBuyerInvoice.resolved);
  const buyerPayment = { invoice: buyerInvoice.id, reference: 'buyer-payment-1', cents: 2000, kind: 'payment' };
  await post(other, 'network/invoice-entry', buyerPayment, 404);
  await post(viewer, 'network/invoice-entry', buyerPayment, 403);
  await post(owner, 'network/invoice-entry', buyerPayment, 200);
  await post(owner, 'network/invoice-entry', buyerPayment, 200);
  await post(owner, 'network/invoice-entry', { ...buyerPayment, cents: 3000 }, 409);
  const buyerAdjustment = { ...buyerPayment, reference: 'buyer-credit-1', kind: 'credit' };
  await post(owner, 'network/invoice-entry', { ...buyerAdjustment, cents: 4001 }, 409);
  await post(owner, 'network/invoice-entry', { ...buyerAdjustment, cents: 500 }, 200);
  const reconciledInvoice = (await api('network-portal/buyer/' + buyerToken)).data.invoices[0];
  assert.equal(reconciledInvoice.cents - reconciledInvoice.applied, 3500);
  assert.equal(reconciledInvoice.entries.length, 2);
  assert.deepEqual(await post(owner, 'network/post', { ...route, reference: 'call-1' }, 200), submitted);
  await post(owner, 'network/post', { ...route, floor: 5000, reference: 'call-1' }, 409);
  const pause = { kind: 'buyer', party: buyer.id, paused: true };
  await post(other, 'network/pause', pause, 404);
  await post(owner, 'network/pause', pause, 200);
  assert.equal((await post(owner, 'network/ping', route, 200)).bid, null);
  await post(owner, 'network/pause', { ...pause, paused: false }, 200);
  await post(owner, 'network/pause', { kind: 'publisher', party: offer.id, paused: true }, 200);
  assert.equal((await post(owner, 'network/ping', route, 200)).reason, 'Publisher offer paused');
  await post(owner, 'network/pause', { kind: 'publisher', party: offer.id, paused: false }, 200);
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
  const formLead = { channel: 'form', name: 'Web contact', email: 'WEB@example.test',
    region: 'AZ', source: 'Search', campaign: 'Repair', message: 'Request a quote' };
  const captured = await api('intake/' + site.id, { body: formLead, status: 202 });
  assert.deepEqual(captured.data, { received: true });
  assert.equal((await post(owner, 'leads/capture', { ...formLead, site: site.id, email: 'web@example.test', channel: 'chat' }, 200)).duplicate, true);
  await post(owner, 'leads/capture', { ...formLead, site: site.id, email: 'bad' }, 400);
  const chat = await post(owner, 'leads/capture', {
    ...formLead, site: site.id, channel: 'chat', email: '', phone: '+16025550115', name: 'Chat contact'
  }, 200);
  const leadBoard = (await api('leads', { cookie: owner })).data;
  assert.equal(leadBoard.leads.length, 2);
  assert.ok(leadBoard.callSources.length);
  const web = leadBoard.leads.find(row => row.channel === 'form');
  assert.equal(web.campaign, 'Repair');
  await post(other, 'leads/direct', { lead: web.id, buyer: buyer.id }, 404);
  await post(viewer, 'leads/direct', { lead: web.id, buyer: buyer.id }, 403);
  const direct = await post(owner, 'leads/direct', { lead: web.id, buyer: buyer.id }, 200);
  assert.deepEqual(await post(owner, 'leads/direct', { lead: web.id, buyer: buyer.id }, 200), direct);
  assert.equal((await post(owner, 'leads/ping', { lead: chat.id, floor: 6001 }, 200)).quote, null);
  const quote = await post(owner, 'leads/ping', { lead: chat.id, floor: 5500 }, 200);
  assert.equal(quote.cents, 6000);
  await post(owner, 'network/pause', { kind: 'buyer', party: buyer.id, paused: true }, 200);
  await post(owner, 'leads/post', { lead: chat.id, quote: quote.quote }, 409);
  await post(owner, 'network/pause', { kind: 'buyer', party: buyer.id, paused: false }, 200);
  const delivered = await post(owner, 'leads/post', { lead: chat.id, quote: quote.quote }, 200);
  assert.deepEqual(await post(owner, 'leads/post', { lead: chat.id, quote: quote.quote }, 200), delivered);
  await post(owner, 'leads/direct', { lead: chat.id, buyer: buyer.id }, 409);
  const inbox = (await api('network-portal/buyer/' + network.buyers[0].token)).data.leads;
  assert.deepEqual(inbox.map(row => row.channel).sort(), ['chat', 'form']);
  assert.deepEqual((await api('leads', { cookie: other })).data.leads, []);
  await post(owner, 'network/suppression', { region: 'AZ', enabled: true }, 200);
  assert.equal((await post(owner, 'network/ping', route, 200)).outcome, 'suppressed');
  const transcript = { call: call.id, transcript: 'Agent: Hello.\nCaller: I would like to book a visit.' };
  await post(other, 'analytics/analyze', transcript, 404);
  await post(viewer, 'analytics/analyze', transcript, 403);
  const analysis = await post(owner, 'analytics/analyze', transcript, 200);
  assert.equal(analysis.qualification, 'booking-intent');
  await post(owner, 'analytics/review', { ...transcript, summary: analysis.summary,
    coaching: analysis.coaching, qualification: 'qualified' }, 200);
  const profile = { site: site.id, greeting: 'Hello', booking: 'What date works?', escalation: 'Please hold.', fallback: 'How can I help?' };
  await post(other, 'analytics/profile', profile, 404);
  await post(owner, 'analytics/profile', profile, 200);
  for (const [message, intent] of [['Book a visit', 'booking'], ['Human representative', 'escalation'], ['How are you?', 'fallback']]) {
    assert.equal((await post(owner, 'analytics/simulate', { site: site.id, message }, 200)).intent, intent);
  }
  const report = (await api('analytics', { cookie: owner })).data;
  const reviewed = report.calls.find(row => row.id === call.id);
  assert.equal(reviewed.qualification, 'qualified');
  assert.equal(reviewed.bookings, 1);
  assert.equal(report.campaigns.find(row => row.campaign === 'Repair').forms, 1);
  assert.equal(report.network.revenue, 6000);
  assert.ok(report.invoices.length);
  assert.deepEqual((await api('analytics', { cookie: other })).data.calls, []);
  await post(viewer, 'operations/key', { scope: 'sites' }, 403);
  const imported = await post(owner, 'operations/import-sites', { csv: 'name,number\r\n"Branch, West",+16025550120' }, 200);
  assert.equal(imported.imported, 1);
  await post(owner, 'operations/import-sites', { csv: 'name,number\nRollback,+16025550121\nDuplicate,+16025550120' }, 409);
  assert.equal((await api('sites', { cookie: owner })).data.some(row => row.name === 'Rollback'), false);
  await post(owner, 'operations/brand', { name: 'Workspace brand', accent: '#AABBCC' }, 200);
  assert.equal((await api('portal/' + portal)).data.brand.name, 'Workspace brand');
  const dev = await post(owner, 'operations/key', { scope: 'sites' }, 200);
  const headers = { Authorization: 'Bearer ' + dev.token };
  const scopedSites = await fetch(origin + '/api/v1/sites', { headers });
  assert.ok((await scopedSites.json()).some(row => row.name === 'Branch, West'));
  assert.equal((await fetch(origin + '/api/v1/campaigns', { headers })).status, 403);
  const mcp = spawnSync(process.execPath, ['mcp.mjs'], {
    env: { ...env, RINGONYX_API_ORIGIN: origin, RINGONYX_DEVELOPER_TOKEN: dev.token },
    input: [
      { jsonrpc: '2.0', id: 1, method: 'resources/list' },
      { jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: 'ringonyx://workspace/sites' } }
    ].map(value => JSON.stringify(value)).join('\n') + '\n',
    encoding: 'utf8', timeout: 10000
  });
  assert.equal(mcp.status, 0, mcp.stderr);
  const [mcpList, mcpRead] = mcp.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.equal(mcpList.result.resources[0].uri, 'ringonyx://workspace/sites');
  assert.ok(JSON.parse(mcpRead.result.contents[0].text).some(row => row.name === 'Branch, West'));
  await post(owner, 'operations/revoke', { id: dev.id }, 200);
  assert.equal((await fetch(origin + '/api/v1/sites', { headers })).status, 401);
  const ops = (await api('operations', { cookie: owner })).data;
  const event = ops.audit.find(row => row.operation === '/api/operations/import-sites');
  assert.ok(event);
  assert.equal((await api('operations', { cookie: other })).data.audit.some(row => row.id === event.id), false);
  const signing = await post(owner, 'operations/signing-key', {}, 200);
  const signed = await post(owner, 'operations/webhook-preview', { event: event.id }, 200);
  assert.equal(JSON.parse(signed.payload).id, event.id);
  assert.equal(signed.signature,
    createHmac('sha256', signing.secret).update(signed.timestamp + '.' + signed.payload).digest('hex'));
  const exportResponse = await fetch(origin + '/api/exports/crm.csv', { headers: { Cookie: owner } });
  assert.match(await exportResponse.text(), /Web contact/);
  assert.equal((await fetch(origin + '/health')).status, 200);
  const limited = await post(owner, 'network/buyers', {
    name: 'Budget buyer', destination: '+16025550109', region: 'NV', price: 5000,
    minimum: 90, cap: 10, concurrency: 10, budget: 5000
  }, 200);
  const budgetRoute = { ...route, region: 'NV', floor: 0 };
  const reserved = await post(owner, 'network/post', { ...budgetRoute, reference: 'budget-1' }, 200);
  assert.equal(reserved.buyer, limited.id);
  const buyerBudget = { buyer: limited.id, budget: 10000 };
  await post(other, 'network/budget', buyerBudget, 404);
  await post(viewer, 'network/budget', buyerBudget, 403);
  await post(owner, 'network/budget', buyerBudget, 200);
  assert.equal((await post(owner, 'network/ping', budgetRoute, 200)).bid, 5000);
  await post(owner, 'network/budget', { ...buyerBudget, budget: 5000 }, 200);
  const buyerUsage = (await api('network', { cookie: owner })).data.buyers.find(row => row.id === limited.id);
  assert.equal(buyerUsage.reserved, 5000);
  assert.equal(buyerUsage.spent, 0);
  assert.equal((await post(owner, 'network/ping', budgetRoute, 200)).reason, 'Buyer budget reached');
  await post(owner, 'network/complete', { call: reserved.id, outcome: 'missed', seconds: 0 }, 200);
  assert.equal((await post(owner, 'network/ping', budgetRoute, 200)).bid, 5000);
  const evidence = (await api('network', { cookie: owner })).data.calls.find(row => row.id === reserved.id);
  assert.equal(evidence.minimum, 90);
  assert.equal(JSON.parse(evidence.candidates)[0].decision, 'Selected');
  await post(owner, 'network/budget', { buyer: limited.id, budget: 0 }, 200);
  const credit = { buyer: limited.id, reference: 'deposit-1', cents: 5000 };
  await post(other, 'network/credit', credit, 404);
  await post(owner, 'network/credit', credit, 200);
  await post(owner, 'network/credit', credit, 200);
  await post(owner, 'network/credit', { ...credit, cents: 6000 }, 409);
  const prepaid = await post(owner, 'network/post', { ...budgetRoute, reference: 'prepaid-1' }, 200);
  assert.equal(prepaid.buyer, limited.id);
  assert.equal((await post(owner, 'network/ping', budgetRoute, 200)).reason, 'Buyer prepaid balance reached');
  await post(owner, 'network/complete', { call: prepaid.id, outcome: 'answered', seconds: 90 }, 200);
  assert.equal((await post(owner, 'network/ping', budgetRoute, 200)).bid, null);
  await post(owner, 'network/credit', { ...credit, reference: 'deposit-2' }, 200);
  assert.equal((await post(owner, 'network/ping', budgetRoute, 200)).bid, 5000);
  const backupPath = join(directory, 'backup.sqlite');
  const snapshot = spawnSync(process.execPath, ['server.mjs', '--backup', backupPath], { env, encoding: 'utf8' });
  assert.equal(snapshot.status, 0, snapshot.stderr);
  const integrity = spawnSync(process.execPath, ['--input-type=module', '-e',
    "import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync(process.argv[1], { readOnly: true }); console.log(db.prepare('PRAGMA integrity_check').get().integrity_check);",
    backupPath], { encoding: 'utf8' });
  assert.equal(integrity.stdout.trim(), 'ok', integrity.stderr);
  const existing = join(directory, 'existing.sqlite');
  writeFileSync(existing, '');
  const collision = spawnSync(process.execPath, ['server.mjs', '--backup', existing], { env, encoding: 'utf8' });
  assert.notEqual(collision.status, 0);
  assert.equal(statSync(existing).size, 0);
  const missing = join(directory, 'missing.sqlite');
  const unused = join(directory, 'unused.sqlite');
  const failedSnapshot = spawnSync(process.execPath, ['server.mjs', '--backup', unused], {
    env: { ...env, RINGONYX_DB: missing }, encoding: 'utf8'
  });
  assert.notEqual(failedSnapshot.status, 0);
  assert.equal(existsSync(missing), false);
  assert.equal(existsSync(unused), false);

  const restored = spawn(process.execPath, ['server.mjs'], { env: { ...env, RINGONYX_DB: backupPath } });
  try {
    const [startup] = await once(restored.stdout, 'data', { signal: AbortSignal.timeout(10000) });
    const restoredOrigin = startup.toString().trim().split(' ').at(-1);
    const login = await fetch(restoredOrigin + '/api/login', {
      method: 'POST', body: JSON.stringify({ email: 'owner@example.test', password })
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const restoredSites = await fetch(restoredOrigin + '/api/sites', { headers: { Cookie: cookie } });
    assert.equal(restoredSites.status, 200);
    assert.ok((await restoredSites.json()).some(row => row.id === site.id));
    const restoredCalls = await fetch(restoredOrigin + '/api/calls', { headers: { Cookie: cookie } });
    assert.equal(restoredCalls.status, 200);
    assert.deepEqual(await restoredCalls.json(), (await api('calls', { cookie: owner })).data);
  } finally {
    if (restored.exitCode === null && restored.signalCode === null) {
      const exited = once(restored, 'exit');
      restored.kill();
      await exited;
    }
  }
  const setup = await post(owner, 'voice/setup', {
    name: 'Guided setup', number: '+16025550999', source: 'Referral'
  });
  assert.equal((await api('sites', { cookie: owner })).data.find(row => row.id === setup.id).voice_source, 'Referral');
  const inviteData = { renter: renter.id, email: 'renter@example.test' };
  await post(other, 'renter-invite', inviteData, 404);
  const { invite } = await post(owner, 'renter-invite', inviteData, 200);
  await post(undefined, 'renter-accept', { invite, password }, 200);
  await post(undefined, 'renter-accept', { invite, password }, 404);
  const renterSession = await signIn(inviteData.email);
  await api('sites', { cookie: renterSession, status: 403 });
  const signedInPortal = (await api('renter-portal', { cookie: renterSession })).data;
  assert.equal(signedInPortal.renter, 'Renter');
  assert.ok(signedInPortal.invoices.some(row => row.id === invoice.id));
  await api('renter-portal', { cookie: owner, status: 401 });
  await post(owner, 'network/quality', { offer: offer.id, limit: 1 }, 200);
  await post(owner, 'network/credit', { ...credit, reference: 'deposit-3' }, 200);
  const qualityCall = await post(owner, 'network/post', { ...budgetRoute, reference: 'quality-1' }, 200);
  assert.equal(qualityCall.buyer, limited.id);
  await post(owner, 'network/complete', { call: qualityCall.id, outcome: 'missed', seconds: 0 }, 200);
  assert.equal((await post(owner, 'network/ping', budgetRoute, 200)).reason, 'Publisher offer paused');
  await post(owner, 'logout', {}, 200);
  await api('session', { cookie: owner, status: 401 });
});
