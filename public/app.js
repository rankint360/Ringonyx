const app = document.querySelector('#app');
const status = document.querySelector('#status');
const portal = new URLSearchParams(location.search).get('token');
const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
async function request(path, data) {
  const response = await fetch('/api/' + path, {
    method: data ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: data ? JSON.stringify(data) : undefined
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(Error(result.error), { status: response.status });
  return result;
}
function history(calls, operator) {
  return `<section><h2>${operator ? 'Call log' : 'Calls and charges'}</h2><p>Total qualified charges <strong>${money(calls.reduce((sum, call) => sum + call.cents, 0))}</strong></p>
    <div class="scroll"><table><thead><tr><th>Time</th><th>Site</th><th>Renter</th><th>Source</th><th>Outcome</th><th>Seconds</th><th>Charge</th></tr></thead>
    <tbody>${calls.map(call => `<tr>${[new Date(call.created).toLocaleString(), call.site_name,
      operator ? [call.renter_name, call.simulated_destination].filter(Boolean).join(' · ') : call.renter_name,
      [call.source, call.campaign].filter(Boolean).join(' · '),
      operator && call.simulated_menu_status === 'invalid-digit' ? 'Unrouted · invalid keypad choice' :
        [call.outcome, operator && call.simulated_disclosure ? 'Recording consent: ' + call.simulated_recording_decision : ''].filter(Boolean).join(' · '),
      call.duration ?? '—', money(call.cents)].map(value => '<td>' + escape(value) + '</td>').join('')}</tr>
      <tr><td colspan="7"><details><summary>Call details</summary>
      <p>Call reference ${escape(call.id)} · ${escape(call.tracking_number || call.site_name)}</p>
      <p>${call.qualification_minimum == null ? 'No renter billing rule was assigned.' :
        'Agreed rate ' + money(call.agreed_rate) + ' · Minimum ' + call.qualification_minimum + ' seconds'}</p>
      <p>${call.invoice ? 'Invoice ' + escape(call.invoice) : 'No invoice line yet'} · Charge ${money(call.cents)}</p>
      </details></td></tr>`).join('')}</tbody></table></div>
    ${calls.length ? '' : '<p>No calls yet.</p>'}</section>`;
}
const field = (name, label, options = '') => `<label>${label}<input name="${name}" required ${options}></label>`;
const select = (name, label, items, value, caption) => `<label>${label}<select required name="${name}"><option value="">Select</option>${items.map(item => `<option value="${escape(item[value])}">${escape(item[caption])}</option>`).join('')}</select></label>`;
const form = (title, action, fields, button) => `<section><h2>${title}</h2><form data-action="${action}">${fields}<button>${button}</button></form></section>`;
function invoiceList(invoices) {
  return `<section><h2>Invoices</h2>${invoices.length ? '<ul>' + invoices.map(invoice =>
    `<li>${escape(invoice.renter_name)} · ${escape(new Date(invoice.created).toLocaleDateString())}
      · ${invoice.calls} qualified calls · <strong>${money(invoice.cents)}</strong>
      · Balance ${money(invoice.cents - invoice.applied)}
      ${invoice.bookings ? ' · Bookings ' + invoice.bookings : ''}
      ${invoice.disputed ? ' · Disputed' : ''}
      ${invoice.period ? ' · ' + escape(invoice.period) + ' rent ' + money(invoice.rent) : ''}
      <details><summary>Invoice details</summary><small>Invoice ${escape(invoice.id)}</small>
      <ul>${invoice.lines.map(line => `<li>${escape(line.kind)} · ${escape(line.reference)} · ${money(line.cents)}</li>`).join('')}</ul>
      ${invoice.entries.length ? '<h3>Payments and credits</h3><ul>' + invoice.entries.map(entry =>
        `<li>${escape(entry.kind)} · ${escape(new Date(entry.created).toLocaleDateString())} · ${money(entry.cents)}</li>`).join('') + '</ul>' : ''}
      </details></li>`).join('') + '</ul>' : '<p>No invoices yet.</p>'}</section>`;
}
function networkTable(calls, partner = false) {
  if (!calls.length) return '<p>No calls yet.</p>';
  return '<div class="scroll"><table><thead><tr><th>Reference</th><th>Region</th><th>Outcome</th>' +
    (partner ? '<th>Amount</th>' : '<th>Publisher</th><th>Buyer</th><th>Routing decision</th><th>Revenue</th><th>Payout</th><th>Margin</th>') +
    '</tr></thead><tbody>' + calls.map(call => '<tr>' +
      [call.reference, call.region, call.outcome, ...(partner ? [money(call.cents)] : [
        call.publisher_name, call.buyer_name || '—', call.reason || '—', money(call.revenue), money(call.payout), money(call.revenue - call.payout)
      ])].map(value => '<td>' + escape(value) + '</td>').join('') + '</tr>' +
      (partner ? '' : networkEvidence(call))).join('') + '</tbody></table></div>';
}
function networkEvidence(call) {
  const candidates = JSON.parse(call.candidates ?? '[]');
  return `<tr><td colspan="9"><details><summary>Routing and settlement details</summary>
    <p>${escape(call.strategy ?? 'Unknown strategy')} · Bid floor ${money(call.floor ?? 0)}</p>
    ${call.minimum == null ? '' : `<p>Minimum ${call.minimum} seconds · Connected ${call.seconds ?? '—'} seconds
      · Selected bid ${money(call.bid)} · Offered payout ${money(call.offered_payout)}</p>`}
    ${call.invoice ? '<p>Invoice ' + escape(call.invoice) + '</p>' : ''}
    ${candidates.length ? '<ul>' + candidates.map(candidate =>
      `<li>${escape(candidate.name)} · ${money(candidate.bid)} · ${escape(candidate.decision)}
      ${candidate.expectedRevenue === null ? '' : ' · Expected revenue ' + money(candidate.expectedRevenue)}</li>`).join('') + '</ul>' : ''}
    </details></td></tr>`;
}
function networkInvoices(invoices) {
  return '<section><h2>Buyer invoices</h2>' + (invoices.map(invoice =>
    `<details><summary>${escape(invoice.buyer_name)} · ${escape(new Date(invoice.created).toLocaleDateString())}
      · ${invoice.calls} calls · ${money(invoice.cents)} · Due ${money(invoice.cents - invoice.applied)}</summary>
      <p>Invoice ${escape(invoice.id)}</p>
      ${invoice.reason ? '<p>Dispute ' + (invoice.resolved ? 'resolved' : 'open') + ' · ' + escape(invoice.reason) + '</p>' : ''}
      ${invoice.resolution ? '<p>Resolution · ' + escape(invoice.resolution) + '</p>' : ''}
      <ul>${invoice.lines.map(line =>
        `<li>${escape(line.reference)} · ${money(line.cents)}</li>`).join('')}</ul>
      ${invoice.entries.length ? '<h3>Payments and credits</h3><ul>' + invoice.entries.map(entry =>
        `<li>${escape(entry.kind)} · ${escape(entry.reference)} · ${money(entry.cents)}</li>`).join('') + '</ul>' : ''}
      </details>`
  ).join('') || '<p>No buyer invoices yet.</p>') + '</section>';
}
function renderNetwork(dashboard, data, canWrite) {
  const integer = (name, label, value) => field(name, label, 'type="number" min="0" step="1" value="' + value + '"');
  const region = field('region', 'Two-letter region', 'maxlength="2" placeholder="AZ"');
  const offer = select('offer', 'Publisher offer', data.publishers, 'id', 'name');
  const bid = offer + region + integer('floor', 'Bid floor in cents', 0) +
    '<label>Ranking<select name="strategy"><option value="price">Highest bid</option><option value="predictive">Historical yield</option></select></label>';
  const pending = data.calls.filter(call => call.outcome === 'pending');
  const partnerList = (kind, rows) => rows.map(row => '<p>' + (canWrite
    ? '<a href="/partner?kind=' + kind + '&token=' + encodeURIComponent(row.token) + '">' + escape(row.name) + '</a>'
    : escape(row.name)) + (data.pauses.some(pause => pause.kind === kind && pause.party === row.id) ? ' · Paused' : '') +
    '</p>' + (kind === 'buyer' ? '<p>Daily budget ' + (row.budget === null ? 'Unlimited' : money(row.budget)) +
      ' · Reserved ' + money(row.reserved) + ' · Spent ' + money(row.spent) + ' (UTC)</p>' +
      (row.funded === null ? '' : '<p>Available prepaid credit ' + money(row.funded - row.credit_used) + '</p>') : '') +
    (row.api_token ? '<details><summary>Publisher API token</summary><code>' +
      escape(row.api_token) + '</code></details>' : '')).join('') || '<p>None yet.</p>';
  dashboard.innerHTML = (canWrite ? '<div class="grid">' +
    form('Buyer contract', 'network/buyers', field('name', 'Buyer name') + field('destination', 'Destination number') + region +
      integer('price', 'Bid in cents', 6000) + integer('minimum', 'Minimum connected seconds', 90) +
      integer('cap', 'Daily cap', 20) + integer('concurrency', 'Concurrent calls', 2) +
      integer('budget', 'Daily budget in cents (0 for unlimited)', 0), 'Add buyer') +
    form('Edit buyer budget', 'network/budget', select('buyer', 'Buyer', data.buyers, 'id', 'name') +
      integer('budget', 'Daily budget in cents (0 for unlimited)', 0), 'Save budget') +
    form('Record prepaid credit', 'network/credit', select('buyer', 'Buyer', data.buyers, 'id', 'name') +
      field('reference', 'Deposit reference') + integer('cents', 'Credit in cents', 5000), 'Record credit') +
    form('Generate buyer invoice', 'network/invoices', select('buyer', 'Buyer', data.buyers, 'id', 'name'), 'Generate invoice') +
    form('Record buyer payment or credit', 'network/invoice-entry',
      select('invoice', 'Invoice', data.invoices.filter(row => row.cents > row.applied), 'id', 'id') +
      '<label>Entry type<select name="kind"><option value="payment">Payment</option><option value="credit">Credit</option></select></label>' +
      field('reference', 'Payment or credit reference') + integer('cents', 'Amount in cents', 0), 'Record entry') +
    form('Record buyer dispute', 'network/dispute', select('invoice', 'Invoice', data.invoices.filter(row => !row.opened), 'id', 'id') +
      field('reason', 'Reason', 'maxlength="200"'), 'Record dispute') +
    form('Resolve buyer dispute', 'network/resolve-dispute',
      select('invoice', 'Invoice', data.invoices.filter(row => row.opened && !row.resolved), 'id', 'id') +
      field('resolution', 'Resolution', 'maxlength="200"'), 'Resolve dispute') +
    form('Publisher offer', 'network/publishers', field('name', 'Offer name') + integer('payout', 'Payout in cents', 3000), 'Add offer') +
    form('Preview a bid', 'network/ping', bid, 'Preview match') +
    form('Submit a simulated call', 'network/post', bid + field('reference', 'Call reference'), 'Route call') +
    form('Settle a simulated call', 'network/complete', select('call', 'Pending call', pending, 'id', 'reference') +
      integer('seconds', 'Connected seconds', 95) +
      '<label>Outcome<select name="outcome"><option value="answered">Answered</option><option value="missed">Missed</option></select></label>', 'Settle call') +
    form('Region suppression', 'network/suppression', region +
      '<label>Action<select name="enabled"><option value="true">Suppress</option><option value="false">Allow</option></select></label>', 'Save rule') +
    [['buyer', data.buyers], ['publisher', data.publishers]].map(([kind, rows]) =>
      form('Pause or resume ' + kind, 'network/pause', '<input type="hidden" name="kind" value="' + kind + '">' +
        select('party', 'Partner', rows, 'id', 'name') +
        '<label>Action<select name="paused"><option value="true">Pause</option><option value="false">Resume</option></select></label>', 'Save partner status')).join('') +
    '</div>' : '') + '<div class="grid"><section><h2>Buyer contracts</h2>' + partnerList('buyer', data.buyers) +
    '</section><section><h2>Publisher offers</h2>' + partnerList('publisher', data.publishers) +
    '</section><section><h2>Suppressed regions</h2><p>' +
    (data.suppression.map(row => escape(row.region)).join(', ') || 'None') +
    '</p></section></div><section><h2>Prepaid credit history</h2>' +
    (data.credits.map(row => '<p>' + escape(row.buyer_name) + ' · ' + escape(row.reference) +
      ' · ' + money(row.cents) + '</p>').join('') || '<p>No credits recorded.</p>') +
    '</section>' + networkInvoices(data.invoices) +
    '<section><h2>Network call ledger</h2>' + networkTable(data.calls) + '</section>';
}
async function render() {
  if (location.pathname === '/partner') {
    const kind = new URLSearchParams(location.search).get('kind');
    if (!portal || !['buyer', 'publisher'].includes(kind)) throw Error('Open the partner link provided by your operator.');
    const result = await request('network-portal/' + kind + '/' + encodeURIComponent(portal));
    applyPortalBrand(result.brand);
    const total = result.calls.reduce((sum, call) => sum + call.cents, 0);
    app.innerHTML = '<h1>' + escape(result.name) + '</h1><section><h2>' +
      (kind === 'buyer' ? 'Buyer charges' : 'Publisher payout statement') + '</h2><p>Total ' +
      money(total) + '</p>' + networkTable(result.calls, true) + '</section>' +
      (kind === 'buyer' ? networkInvoices(result.invoices) +
        '<section><h2>Delivered leads</h2>' + leadTable(result.leads, true) + '</section>' : '');
    return;
  }
  if (location.pathname === '/portal') {
    if (!portal) throw Error('Open the portal link provided by your operator.');
    const result = await request('portal/' + encodeURIComponent(portal));
    applyPortalBrand(result.brand);
    app.innerHTML = '<h1>' + escape(result.renter) + '</h1>' + history(result.calls, false) + invoiceList(result.invoices);
    return;
  }
  let session;
  try {
    session = await request('session');
  } catch (error) {
    if (error.status !== 401) throw error;
    app.innerHTML = `<h1>Sign in</h1><section class="sign-in"><form id="access">
      ${field('email', 'Email', 'type="email" autocomplete="username"')}
      ${field('password', 'Password', 'type="password" autocomplete="current-password"')}
      <button>Sign in</button></form></section>`;
    return;
  }
  const canWrite = session.role !== 'viewer';
  app.innerHTML = `<div class="workspace-header"><div><h1>${escape(session.workspace)}</h1>
    <p>${escape(session.email)} · ${escape(session.role)}</p></div>
    <form id="sign-out"><button>Sign out</button></form></div>
    <p><a href="/app">Rentals and billing</a> · <a href="/communications">Communications</a> · <a href="/network">Buyer and publisher network</a> · <a href="/leads">Web leads</a> · <a href="/analytics">Analytics</a> · <a href="/operations">Operations</a></p><div id="dashboard"></div>`;
  if (location.pathname === '/operations') {
    renderOperations(document.querySelector('#dashboard'), await request('operations'), session.role === 'owner');
    return;
  }
  if (location.pathname === '/analytics') {
    const [sites, data] = await Promise.all([request('sites'), request('analytics')]);
    renderAnalytics(document.querySelector('#dashboard'), sites, data, canWrite);
    return;
  }
  if (location.pathname === '/leads') {
    const [sites, data, partners] = await Promise.all([request('sites'), request('leads'), request('network')]);
    renderLeads(document.querySelector('#dashboard'), sites, data, partners.buyers, canWrite);
    return;
  }
  if (location.pathname === '/communications') {
    const [sites, data] = await Promise.all([request('sites'), request('communications')]);
    renderCommunications(document.querySelector('#dashboard'), sites, data, canWrite);
    return;
  }
  if (location.pathname === '/network') {
    renderNetwork(document.querySelector('#dashboard'), await request('network'), canWrite);
    return;
  }
  const [sites, renters, assignments, calls, invoices, routing, menus, trackingPool, bookings, disputes] = await Promise.all(
    ['sites', 'renters', 'assignments', 'calls', 'invoices', 'routing', 'routing/menu', 'tracking-pool', 'bookings', 'disputes'].map(path => request(path))
  );
  const pending = calls.filter(call => call.outcome === 'pending' && !call.carrier).map(call => ({ id: call.id, label: call.site_name + ' · ' + new Date(call.created).toLocaleTimeString() }));
  const dashboard = document.querySelector('#dashboard');
  const bookingCalls = calls.filter(call => call.outcome === 'answered' && call.assignment).map(call => ({
    ...call, label: call.site_name + ' · ' + new Date(call.created).toLocaleString()
  }));
  const invoiceOptions = invoices.map(invoice => ({ ...invoice,
    label: invoice.renter_name + ' · ' + money(invoice.cents) + ' · ' + invoice.id.slice(0, 8)
  }));
  const openDisputes = disputes.filter(dispute => !dispute.resolved).map(dispute => ({
    ...dispute, label: dispute.renter_name + ' · ' + dispute.reason
  }));
  dashboard.innerHTML = (canWrite ? `<div class="grid">
    ${form('Tracking site', 'sites', field('name', 'Site name') + field('number', 'Tracking number', 'placeholder="+16025550100"'), 'Add site')}
    ${form('Renter', 'renters', field('name', 'Business name') + field('destination', 'Forwarding number', 'placeholder="+16025550101"'), 'Add renter')}
    ${form('Connect a tracking number', 'voice/numbers', select('site','Site',sites,'id','name') + field('source','Campaign source','placeholder="Google Ads"'), 'Save number mapping')}
    ${form('Add a pool number', 'tracking-pool', select('site','Site',sites,'id','name') +
      field('number', 'Tracking number', 'placeholder="+16025550106"'), 'Add pool number')}
    ${form('Fallback routing plan', 'routing', select('site', 'Site', sites, 'id', 'name') +
      '<label>Destinations in order, one per line as Label | +number<textarea name="routes" rows="3" placeholder="Backup desk | +16025550102"></textarea></label>', 'Replace fallback plan')}
    ${form('Preview routing', 'routing/preview', select('site', 'Site', sites, 'id', 'name') +
      '<label>Caller key (optional)<input name="digit" inputmode="numeric" maxlength="1"></label>' +
      '<label>Failed destinations, one per line<textarea name="failed" rows="2"></textarea></label>', 'Find next destination')}
    ${form('Phone menu', 'routing/menu', select('site', 'Site', sites, 'id', 'name') + field('prompt', 'Spoken prompt') +
      '<label>Options, one per line as Digit | Label | +number<textarea name="options" rows="3" required placeholder="1 | Sales | +16025550102"></textarea></label>', 'Save phone menu')}
    ${form('Set monthly rent', 'rental-rates', select('renter', 'Renter', renters, 'id', 'name') +
      field('period', 'Effective month (UTC)', 'type="month"') +
      field('cents', 'Monthly rent in cents', 'type="number" min="0"'), 'Save rent rate')}
    ${form('Create renter invoice', 'invoices', select('renter', 'Renter', renters, 'id', 'name') +
      '<label>Billing month (UTC, optional)<input name="period" type="month"></label>', 'Create invoice')}
    ${form('Verify a booking charge', 'bookings', select('call', 'Answered call', bookingCalls, 'id', 'label') +
      field('reference', 'Booking reference') + field('evidence', 'Evidence reviewed') +
      field('cents', 'Charge in cents', 'type="number" min="1"'), 'Verify booking')}
    ${form('Open an invoice dispute', 'disputes', select('invoice', 'Invoice', invoiceOptions, 'id', 'label') +
      field('reason', 'Dispute reason'), 'Open dispute')}
    ${form('Resolve a dispute', 'disputes/resolve', select('dispute', 'Open dispute', openDisputes, 'id', 'label') +
      field('resolution', 'Resolution') + field('cents', 'Credit in cents', 'type="number" min="0" value="0"'), 'Resolve dispute')}
    ${form('Record payment or credit', 'invoice-entries',
      select('invoice', 'Open invoice', invoices.filter(invoice => invoice.cents > invoice.applied).map(invoice => ({
        ...invoice, label: invoice.renter_name + ' · ' + money(invoice.cents - invoice.applied)
      })), 'id', 'label') +
      '<label>Entry type<select name="kind"><option value="payment">Payment</option><option value="credit">Credit</option></select></label>' +
      field('cents', 'Amount in cents', 'type="number" min="1"') + field('reference', 'Payment or credit reference'), 'Record entry')}
    ${form('Assign or replace renter', 'assignments', select('site','Site',sites,'id','name') + select('renter','Renter',renters,'id','name') + field('rate','Charge in cents','type="number" min="0" value="4500"') + field('minimum','Minimum talk time (seconds)','type="number" min="0" value="90"'), 'Save assignment')}
    ${form('Simulate incoming call', 'calls', select('number','Tracking number', [...sites, ...trackingPool.map(row => ({
      ...row, name: row.number + ' · Visitor pool'
    }))], 'number','name') + field('source','Attribution source for fixed numbers','value="Google Ads"') +
      '<label>Caller key (optional)<input name="digit" inputmode="numeric" maxlength="1"></label>' +
      '<label>Simulated recording consent<select name="recordingConsent"><option value="">No response</option><option value="granted">Granted</option><option value="declined">Declined</option></select></label>' +
      '<label>Failed destinations (optional)<textarea name="failed" rows="2"></textarea></label>', 'Simulate arrival')}
    ${form('Simulate call completion', 'complete', select('id','Pending call',pending,'id','label') + field('duration','Talk time (seconds)','type="number" min="0" value="95"') + '<label>Outcome<select name="outcome"><option>answered</option><option>missed</option></select></label>', 'Finalize call')}
    </div>` : '') + `<div class="grid"><section><h2>Tracking sites</h2>${sites.map(site => `<p>${escape(site.name)} · ${escape(site.number)}<br><small>${escape(renters.find(renter => renter.id === assignments.find(row => row.site === site.id && !row.ended)?.renter)?.name || 'Unassigned')}</small></p>`).join('') || '<p>No sites yet.</p>'}</section>
    <section><h2>${canWrite ? 'Renter portals' : 'Renters'}</h2>${renters.map(renter => canWrite ? `<p><a href="/portal?token=${encodeURIComponent(renter.portal)}">${escape(renter.name)}</a></p>` : `<p>${escape(renter.name)}</p>`).join('') || '<p>No renters yet.</p>'}</section></div><section><h2>Assignment history</h2>${assignments.map(row => `<p>${escape(sites.find(site => site.id === row.site)?.name)} · ${escape(renters.find(renter => renter.id === row.renter)?.name)} · ${money(row.rate)} · ${row.minimum}s minimum <small>${escape(new Date(row.started).toLocaleString())} → ${row.ended ? escape(new Date(row.ended).toLocaleString()) : 'Active'}</small></p>`).join('') || '<p>No assignments yet.</p>'}</section>${history(calls, true)}`;
  dashboard.insertAdjacentHTML('beforeend', '<section><h2>Fallback destinations</h2>' +
    (routing.map(row => '<p>' + escape(sites.find(site => site.id === row.site)?.name) + ' · ' +
      row.position + '. ' + escape(row.label) + ' · ' + escape(row.destination) + '</p>').join('') ||
      '<p>No fallback destinations configured.</p>') + '</section><section><h2>Phone menus</h2>' +
    (menus.map(row => '<p>' + escape(sites.find(site => site.id === row.site)?.name) + ' · ' +
      escape(row.prompt) + ' · ' + escape(row.digit) + ' → ' + escape(row.label) + ' · ' +
      escape(row.destination) + '</p>').join('') || '<p>No phone menus configured.</p>') + '</section><section><h2>Visitor number pools</h2>' +
    (trackingPool.map(row => '<p>' + escape(sites.find(site => site.id === row.site)?.name) + ' · ' + escape(row.number) +
      ' · Site ID <code>' + escape(row.site) + '</code></p>').join('') || '<p>No visitor pool numbers configured.</p>') +
    '</section>' + invoiceList(invoices) + '<section><h2>Verified bookings</h2>' +
    (bookings.map(row => '<p>' + escape(row.reference) + ' · ' + money(row.cents) + ' · ' +
      escape(row.evidence) + ' · ' + (row.invoice ? 'Invoiced' : 'Unbilled') + '</p>').join('') || '<p>No verified bookings.</p>') +
    '</section><section><h2>Invoice disputes</h2>' +
    (disputes.map(row => '<p>' + escape(row.renter_name) + ' · ' + escape(row.reason) + ' · ' +
      (row.resolved ? escape(row.resolution) + ' · Credit ' + money(row.credit) : 'Open') + '</p>').join('') || '<p>No disputes.</p>') + '</section>');
}
function leadTable(leads, partner = false) {
  if (!leads.length) return '<p>No leads yet.</p>';
  return '<div class="scroll"><table><thead><tr><th>Contact</th><th>Channel</th><th>Source</th><th>Region</th><th>Message</th>' +
    (partner ? '' : '<th>Site</th><th>Delivery</th>') + '</tr></thead><tbody>' + leads.map(lead => '<tr>' +
    [[lead.name, lead.email, lead.phone].filter(Boolean).join(' · '), lead.channel,
      [lead.source, lead.campaign].filter(Boolean).join(' · '), lead.region, lead.message,
      ...(partner ? [] : [lead.site_name, lead.buyer_name ? lead.buyer_name + ' · ' + lead.mode : 'Unassigned'])
    ].map(value => '<td>' + escape(value) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
}
function renderLeads(dashboard, sites, data, buyers, canWrite) {
  const pending = data.leads.filter(lead => !lead.delivered).map(lead => ({
    ...lead, label: lead.name + ' · ' + lead.region + ' · ' + lead.channel
  }));
  const lead = select('lead', 'Unassigned lead', pending, 'id', 'label');
  const quotes = data.quotes.map(quote => ({
    ...quote, value: quote.lead + ':' + quote.id,
    label: (pending.find(row => row.id === quote.lead)?.name ?? 'Lead') + ' · ' + quote.buyer_name + ' · ' + money(quote.cents)
  }));
  const counts = new Map(data.callSources.map(row => [row.source, { calls: row.count, form: 0, chat: 0 }]));
  for (const row of data.leads) {
    if (!counts.has(row.source)) counts.set(row.source, { calls: 0, form: 0, chat: 0 });
    counts.get(row.source)[row.channel]++;
  }
  const report = '<div class="scroll"><table><thead><tr><th>Source</th><th>Calls</th><th>Forms</th><th>Chat</th></tr></thead><tbody>' +
    [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([source, row]) =>
      '<tr><td>' + escape(source) + '</td><td>' + row.calls + '</td><td>' + row.form + '</td><td>' + row.chat + '</td></tr>').join('') +
    '</tbody></table></div>';
  dashboard.innerHTML = (canWrite ? '<div class="grid">' +
    form('Capture a lead', 'leads/capture', select('site', 'Tracking site', sites, 'id', 'name') +
      '<label>Channel<select name="channel"><option value="form">Web form</option><option value="chat">Chat</option></select></label>' +
      field('name', 'Contact name') + '<label>Email<input name="email" type="email"></label><label>Phone<input name="phone" type="tel"></label>' +
      field('region', 'Two-letter region', 'maxlength="2"') + field('source', 'Source') +
      '<label>Campaign<input name="campaign"></label><label>Message<textarea name="message" required maxlength="2000"></textarea></label>', 'Capture lead') +
    form('Direct delivery', 'leads/direct', lead + select('buyer', 'Buyer', buyers, 'id', 'name'), 'Deliver lead') +
    form('Request a quote', 'leads/ping', lead + field('floor', 'Bid floor in cents', 'type="number" min="0" value="0"'), 'Ping buyers') +
    form('Accept a quote', 'leads/post', select('selection', 'Available quote', quotes, 'value', 'label'), 'Post lead') + '</div>' : '') +
    '<section><h2>Intake links</h2>' + (sites.map(site => '<p>' + escape(site.name) + ' · <a href="/intake?site=' +
      encodeURIComponent(site.id) + '">Web form</a> · <a href="/intake?site=' + encodeURIComponent(site.id) +
      '&amp;channel=chat">Chat intake</a></p>').join('') || '<p>Create a tracking site to get intake links.</p>') + '</section>' +
    '<section><h2>Lead inbox</h2>' + leadTable(data.leads) + '</section><section><h2>Calls and web leads by source</h2>' + report + '</section>';
}
function applyPortalBrand(brand) {
  if (!brand) return;
  const header = document.querySelector('header .brand');
  header.textContent = brand.name;
  header.style.borderBottom = '3px solid ' + brand.accent;
  document.title = brand.name;
}
function renderOperations(dashboard, data, owner) {
  dashboard.innerHTML = '<section><h2>Exports</h2><p><a href="/api/exports/crm.csv">CRM contacts CSV</a> · ' +
    '<a href="/api/exports/conversions.csv">Conversion CSV</a> · <a href="/health">Service health</a></p></section>' +
    (owner ? '<div class="grid">' +
      form('Portal branding', 'operations/brand', field('name', 'Display name') +
        field('accent', 'Accent color', 'placeholder="#C6FF38" maxlength="7"'), 'Save branding') +
      form('Import tracking sites', 'operations/import-sites',
        '<label>CSV with name,number header<textarea name="csv" required rows="5"></textarea></label>', 'Import sites') +
      form('Create developer key', 'operations/key',
        '<label>Read scope<select name="scope"><option value="sites">Sites</option><option value="campaigns">Campaigns</option></select></label>', 'Create key') +
      form('Revoke developer key', 'operations/revoke',
        select('id', 'Key', data.keys.map(key => ({ ...key, label: key.scope + ' · ' + key.id.slice(0, 8) })), 'id', 'label'), 'Revoke key') +
      form('Webhook signing', 'operations/signing-key', '<p>Creating a key replaces the current signing key.</p>', 'Create signing key') +
      form('Signed webhook payload', 'operations/webhook-preview',
        select('event', 'Audit event (optional)', data.audit.map(row => ({ ...row,
          label: row.operation + ' · ' + new Date(row.created).toLocaleString()
        })), 'id', 'label').replace('<select required', '<select').replace('>Select</option>', '>Test event</option>'),
        'Sign payload') + '</div>' : '') +
    '<section><h2>Audit log</h2>' + (data.audit.map(row => '<p>' +
      escape(new Date(row.created).toLocaleString() + ' · ' + row.actor + ' · ' + row.operation) + '</p>').join('') ||
      '<p>No audited operations yet.</p>') + '</section>';
}
function renderAnalytics(dashboard, sites, data, canWrite) {
  const calls = data.calls.filter(call => call.outcome === 'answered').map(call => ({
    ...call, label: call.site_name + ' · ' + new Date(call.created).toLocaleString() + ' · ' + call.id.slice(0, 8)
  }));
  const total = data.invoices.reduce((sum, invoice) => sum + invoice.cents, 0);
  const applied = data.invoices.reduce((sum, invoice) => sum + invoice.applied, 0);
  const table = (headers, rows) => rows.length ? '<div class="scroll"><table><thead><tr>' +
    headers.map(header => '<th scope="col">' + escape(header) + '</th>').join('') + '</tr></thead><tbody>' +
    rows.map(row => '<tr>' + row.map(value => '<td>' + escape(value) + '</td>').join('') + '</tr>').join('') +
    '</tbody></table></div>' : '<p>No records yet.</p>';
  const site = select('site', 'Tracking site', sites, 'id', 'name');
  const review = '<section><h2>Review a conversation</h2><form data-action="analytics/review">' +
    select('call', 'Answered call', calls, 'id', 'label') +
    '<label>Transcript<textarea name="transcript" rows="5" maxlength="6000" required placeholder="Caller: I would like to book a visit."></textarea></label>' +
    '<button type="submit" data-operation="analytics/analyze" formnovalidate>Preview analysis</button>' +
    field('summary', 'Reviewed summary', 'maxlength="200"') +
    '<label>Qualification<select name="qualification"><option value="review-required">Needs review</option><option value="qualified">Qualified</option><option value="unqualified">Unqualified</option></select></label>' +
    field('coaching', 'Coaching note', 'maxlength="200"') + '<button>Save review</button></form></section>';
  dashboard.innerHTML = '<div class="grid"><section><h2>Renter invoices</h2><p>Invoiced ' + money(total) +
    ' · Applied ' + money(applied) + ' · Balance ' + money(total - applied) + '</p></section>' +
    '<section><h2>Network settlement</h2><p>Buyer revenue ' + money(data.network.revenue) +
    ' · Publisher payouts ' + money(data.network.payout) + ' · Margin ' + money(data.network.revenue - data.network.payout) +
    '</p></section></div><section><h2>Campaign report</h2>' +
    table(['Source', 'Campaign', 'Calls', 'Forms', 'Chats', 'Call charges'], data.campaigns.map(row =>
      [row.source, row.campaign || '—', row.calls, row.forms, row.chats, money(row.call_charges)])) + '</section>' +
    (canWrite ? '<div class="grid">' + review +
      form('Configure an answering preview', 'analytics/profile', site + field('greeting', 'Greeting') +
        field('booking', 'Booking response') + field('escalation', 'Escalation response') +
        field('fallback', 'Fallback response'), 'Save answering profile') +
      form('Test answering responses', 'analytics/simulate', site + field('message', 'Sample caller message'), 'Simulate response') + '</div>' : '') +
    '<section><h2>Answering profiles</h2>' +
    table(['Site', 'Greeting', 'Booking', 'Escalation', 'Fallback'], data.profiles.map(row =>
      [row.site_name, row.greeting, row.booking, row.escalation, row.fallback])) + '</section>' +
    '<section><h2>Conversation records</h2>' + (data.calls.map(call =>
      '<details><summary>' + escape(call.site_name + ' · ' + call.source + ' · ' +
        new Date(call.created).toLocaleString() + ' · ' + call.outcome) + '</summary><p>' +
        escape('Campaign ' + (call.campaign || '—') + ' · Bookings ' + call.bookings + ' · Call charge ' + money(call.cents)) +
        '</p>' + (call.transcript ? '<p>' + escape(call.summary + ' · ' + call.qualification) + '</p><p>' +
          escape('Coaching · ' + call.coaching) + '</p><p>' + escape('Reviewed by ' + call.reviewed_by) +
          '</p><pre style="white-space:pre-wrap">' + escape(call.transcript) + '</pre>' : '<p>No transcript review.</p>') +
        '</details>').join('') || '<p>No calls yet.</p>') + '</section>';
}
function renderCommunications(dashboard, sites, data, canWrite) {
  const site = select('site', 'Tracking site', sites, 'id', 'name');
  const drafts = data.numberRequests.filter(row => row.state === 'draft').map(row => ({
    ...row, label: row.site_name + ' · ' + row.kind + ' · ' + row.requested
  }));
  const pending = data.callbacks.filter(row => row.state === 'queued').map(row => ({
    ...row, label: row.site_name + ' · ' + row.destination
  }));
  const list = (rows, describe) => rows.length
    ? '<ul>' + rows.map(row => '<li>' + escape(describe(row)) + '</li>').join('') + '</ul>'
    : '<p>No records yet.</p>';
  dashboard.innerHTML = (canWrite ? '<div class="grid">' +
    form('Prepare a number request', 'communications/numbers', site +
      '<label>Request type<select name="kind"><option value="provision">Provision a new number</option><option value="port">Port an existing number</option></select></label>' +
      field('requested', 'Area code or full port number', 'placeholder="602 or +16025550100"'), 'Save draft') +
    form('Cancel a number request', 'communications/cancel-number',
      select('id', 'Draft request', drafts, 'id', 'label'), 'Cancel draft') +
    form('Recording and disclosure', 'communications/recording', site +
      '<label>Recording preference<select name="enabled"><option value="false">Off</option><option value="true">On</option></select></label>' +
      '<label>Spoken disclosure<input name="disclosure" maxlength="200"></label>', 'Save preference') +
    form('Queue a callback', 'communications/callbacks', site + field('destination', 'Callback number'), 'Queue request') +
    form('Cancel a callback', 'communications/cancel-callback', select('id', 'Queued request', pending, 'id', 'label'), 'Cancel request') +
    form('Simulate incoming SMS', 'communications/sms', site + field('sender', 'Sender number') +
      '<label>Message<textarea name="message" maxlength="1600" required></textarea></label>', 'Add to inbox') +
    '</div>' : '') + '<div class="grid"><section><h2>Number request drafts</h2>' +
    list(data.numberRequests, row => row.site_name + ' · ' + row.kind + ' · ' + row.requested + ' · ' + row.state) +
    '</section><section><h2>Recording preferences</h2>' +
    list(data.recordings, row => row.site_name + ' · ' + (row.enabled ? 'On · ' + row.disclosure : 'Off')) +
    '</section><section><h2>Callback requests</h2>' +
    list(data.callbacks, row => row.site_name + ' · ' + row.destination + ' · ' + row.state) +
    '</section><section><h2>Simulated SMS inbox</h2>' +
    list(data.messages, row => row.site_name + ' · ' + row.sender + ' · ' + row.body) + '</section></div>';
}
app.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target;
  const data = Object.fromEntries(new FormData(form));
  const button = event.submitter || form.querySelector('button');
  button.disabled = true;
  status.textContent = '';
  try {
    if (form.id === 'access') {
      await request('login', data);
    } else if (form.id === 'sign-out') {
      await request('logout', {});
    } else {
      for (const key of ['rate', 'minimum', 'duration', 'cents', 'price', 'cap', 'concurrency', 'budget', 'payout', 'floor', 'seconds']) {
        if (Object.hasOwn(data, key)) data[key] = Number(data[key]);
      }
      if (Object.hasOwn(data, 'enabled')) data.enabled = data.enabled === 'true';
      if (Object.hasOwn(data, 'paused')) data.paused = data.paused === 'true';
      const action = event.submitter?.dataset.operation || form.dataset.action;
      if (action === 'leads/post') [data.lead, data.quote] = data.selection.split(':');
      if (action === 'routing') {
        data.routes = data.routes.split(/\r?\n/).filter(line => line.trim()).map(line => {
          const [label, destination] = line.split('|').map(value => value.trim());
          return { label, destination };
        });
      }
      if (action === 'routing/preview' || action === 'calls') data.failed = data.failed.split(/\s+/).filter(Boolean);
      if (action === 'routing/menu') {
        data.options = data.options.split(/\r?\n/).filter(line => line.trim()).map(line => {
          const [digit, label, destination] = line.split('|').map(value => value.trim());
          return { digit, label, destination };
        });
      }
      const result = await request(action === 'complete' ? 'calls/' + encodeURIComponent(data.id) + '/complete' : action, data);
      if (['operations/key', 'operations/signing-key', 'operations/webhook-preview'].includes(action)) {
        await render();
        status.textContent = result.token ? 'Copy this developer key: ' + result.token
          : result.secret ? 'Copy this signing key: ' + result.secret
            : 'Timestamp ' + result.timestamp + ' · Signature ' + result.signature + ' · Payload ' + result.payload;
        return;
      }
      if (action === 'analytics/analyze') {
        form.elements.summary.value = result.summary;
        form.elements.coaching.value = result.coaching;
        form.elements.qualification.value = 'review-required';
        status.textContent = result.qualification === 'booking-intent'
          ? 'Booking intent detected. Confirm the qualification before saving.'
          : 'Review the suggested summary and coaching note before saving.';
        return;
      }
      if (action === 'analytics/simulate') {
        status.textContent = result.greeting + ' · ' + result.intent + ' · ' + result.response;
        return;
      }
      if (action === 'routing/preview') {
        const outcome = result.menuStatus === 'invalid-digit' ? 'That key has no menu option.'
          : result.next ? 'Next destination · ' + result.next.label + ' · ' + result.next.destination
            : 'No remaining destinations.';
        status.textContent = result.prompt ? result.prompt + ' · ' + outcome : outcome;
        return;
      }
      if (action === 'network/ping') {
        status.textContent = result.buyer ? result.buyer + ' · ' + money(result.bid) : result.reason;
        return;
      }
      if (action === 'calls') {
        const route = result.destination ? 'Selected destination ' + result.destination : 'No destination selected';
        status.textContent = result.recording.disclosure
          ? route + ' · Disclosure: ' + result.recording.disclosure + ' · Consent: ' + result.recording.decision
          : route;
      } else {
        if (action === 'leads/ping') status.textContent = result.quote ? result.buyer + ' quoted ' + money(result.cents) : 'No eligible buyer met the bid floor.';
        else if (action === 'leads/capture' && result.duplicate) status.textContent = 'An existing lead matches this contact.';
        else status.textContent = 'Saved.';
      }
    }
    await render();
  } catch (error) {
    status.textContent = error.message;
    if (error.status === 401 && form.id !== 'access') await render();
  } finally {
    button.disabled = false;
  }
});
render().catch(error => { status.textContent = error.message; });
