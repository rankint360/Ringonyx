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
      call.duration ?? '—', money(call.cents)].map(value => '<td>' + escape(value) + '</td>').join('')}</tr>`).join('')}</tbody></table></div>
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
    (partner ? '<th>Amount</th>' : '<th>Publisher</th><th>Buyer</th><th>Revenue</th><th>Payout</th><th>Margin</th>') +
    '</tr></thead><tbody>' + calls.map(call => '<tr>' +
      [call.reference, call.region, call.outcome, ...(partner ? [money(call.cents)] : [
        call.publisher_name, call.buyer_name || '—', money(call.revenue), money(call.payout), money(call.revenue - call.payout)
      ])].map(value => '<td>' + escape(value) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
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
    : escape(row.name)) + '</p>' + (row.api_token ? '<details><summary>Publisher API token</summary><code>' +
      escape(row.api_token) + '</code></details>' : '')).join('') || '<p>None yet.</p>';
  dashboard.innerHTML = (canWrite ? '<div class="grid">' +
    form('Buyer contract', 'network/buyers', field('name', 'Buyer name') + field('destination', 'Destination number') + region +
      integer('price', 'Bid in cents', 6000) + integer('minimum', 'Minimum connected seconds', 90) +
      integer('cap', 'Daily cap', 20) + integer('concurrency', 'Concurrent calls', 2), 'Add buyer') +
    form('Publisher offer', 'network/publishers', field('name', 'Offer name') + integer('payout', 'Payout in cents', 3000), 'Add offer') +
    form('Preview a bid', 'network/ping', bid, 'Preview match') +
    form('Submit a simulated call', 'network/post', bid + field('reference', 'Call reference'), 'Route call') +
    form('Settle a simulated call', 'network/complete', select('call', 'Pending call', pending, 'id', 'reference') +
      integer('seconds', 'Connected seconds', 95) +
      '<label>Outcome<select name="outcome"><option value="answered">Answered</option><option value="missed">Missed</option></select></label>', 'Settle call') +
    form('Region suppression', 'network/suppression', region +
      '<label>Action<select name="enabled"><option value="true">Suppress</option><option value="false">Allow</option></select></label>', 'Save rule') +
    '</div>' : '') + '<div class="grid"><section><h2>Buyer contracts</h2>' + partnerList('buyer', data.buyers) +
    '</section><section><h2>Publisher offers</h2>' + partnerList('publisher', data.publishers) +
    '</section><section><h2>Suppressed regions</h2><p>' +
    (data.suppression.map(row => escape(row.region)).join(', ') || 'None') +
    '</p></section></div><section><h2>Network call ledger</h2>' + networkTable(data.calls) + '</section>';
}
async function render() {
  if (location.pathname === '/partner') {
    const kind = new URLSearchParams(location.search).get('kind');
    if (!portal || !['buyer', 'publisher'].includes(kind)) throw Error('Open the partner link provided by your operator.');
    const result = await request('network-portal/' + kind + '/' + encodeURIComponent(portal));
    const total = result.calls.reduce((sum, call) => sum + call.cents, 0);
    app.innerHTML = '<h1>' + escape(result.name) + '</h1><section><h2>' +
      (kind === 'buyer' ? 'Buyer charges' : 'Publisher payout statement') + '</h2><p>Total ' +
      money(total) + '</p>' + networkTable(result.calls, true) + '</section>';
    return;
  }
  if (location.pathname === '/portal') {
    if (!portal) throw Error('Open the portal link provided by your operator.');
    const result = await request('portal/' + encodeURIComponent(portal));
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
    <p><a href="/app">Rentals and billing</a> · <a href="/communications">Communications</a> · <a href="/network">Buyer and publisher network</a></p><div id="dashboard"></div>`;
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
  const button = form.querySelector('button');
  button.disabled = true;
  status.textContent = '';
  try {
    if (form.id === 'access') {
      await request('login', data);
    } else if (form.id === 'sign-out') {
      await request('logout', {});
    } else {
      for (const key of ['rate', 'minimum', 'duration', 'cents', 'price', 'cap', 'concurrency', 'payout', 'floor', 'seconds']) {
        if (Object.hasOwn(data, key)) data[key] = Number(data[key]);
      }
      if (Object.hasOwn(data, 'enabled')) data.enabled = data.enabled === 'true';
      const action = form.dataset.action;
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
      if (action === 'routing/preview') {
        const outcome = result.menuStatus === 'invalid-digit' ? 'That key has no menu option.'
          : result.next ? 'Next destination · ' + result.next.label + ' · ' + result.next.destination
            : 'No remaining destinations.';
        status.textContent = result.prompt ? result.prompt + ' · ' + outcome : outcome;
        return;
      }
      if (action === 'network/ping') {
        status.textContent = result.buyer ? result.buyer + ' · ' + money(result.bid) : 'No match · ' + result.outcome;
        return;
      }
      if (action === 'calls') {
        const route = result.destination ? 'Selected destination ' + result.destination : 'No destination selected';
        status.textContent = result.recording.disclosure
          ? route + ' · Disclosure: ' + result.recording.disclosure + ' · Consent: ' + result.recording.decision
          : route;
      } else {
        status.textContent = 'Saved.';
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
