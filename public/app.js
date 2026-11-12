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
    <tbody>${calls.map(call => `<tr>${[new Date(call.created).toLocaleString(), call.site_name, call.renter_name, call.source, call.outcome, call.duration ?? '—', money(call.cents)].map(value => '<td>' + escape(value) + '</td>').join('')}</tr>`).join('')}</tbody></table></div>
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
      ${invoice.period ? ' · ' + escape(invoice.period) + ' rent ' + money(invoice.rent) : ''}
      <small>Invoice ${escape(invoice.id)}</small></li>`).join('') + '</ul>' : '<p>No invoices yet.</p>'}</section>`;
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
    <p><a href="/app">Rentals and billing</a> · <a href="/network">Buyer and publisher network</a></p><div id="dashboard"></div>`;
  if (location.pathname === '/network') {
    renderNetwork(document.querySelector('#dashboard'), await request('network'), canWrite);
    return;
  }
  const [sites, renters, assignments, calls, invoices] = await Promise.all(
    ['sites', 'renters', 'assignments', 'calls', 'invoices'].map(path => request(path))
  );
  const pending = calls.filter(call => call.outcome === 'pending' && !call.carrier).map(call => ({ id: call.id, label: call.site_name + ' · ' + new Date(call.created).toLocaleTimeString() }));
  const dashboard = document.querySelector('#dashboard');
  dashboard.innerHTML = (canWrite ? `<div class="grid">
    ${form('Tracking site', 'sites', field('name', 'Site name') + field('number', 'Tracking number', 'placeholder="+16025550100"'), 'Add site')}
    ${form('Renter', 'renters', field('name', 'Business name') + field('destination', 'Forwarding number', 'placeholder="+16025550101"'), 'Add renter')}
    ${form('Connect a tracking number', 'voice/numbers', select('site','Site',sites,'id','name') + field('source','Campaign source','placeholder="Google Ads"'), 'Save number mapping')}
    ${form('Set monthly rent', 'rental-rates', select('renter', 'Renter', renters, 'id', 'name') +
      field('period', 'Effective month (UTC)', 'type="month"') +
      field('cents', 'Monthly rent in cents', 'type="number" min="0"'), 'Save rent rate')}
    ${form('Create renter invoice', 'invoices', select('renter', 'Renter', renters, 'id', 'name') +
      '<label>Billing month (UTC, optional)<input name="period" type="month"></label>', 'Create invoice')}
    ${form('Record payment or credit', 'invoice-entries',
      select('invoice', 'Open invoice', invoices.filter(invoice => invoice.cents > invoice.applied).map(invoice => ({
        ...invoice, label: invoice.renter_name + ' · ' + money(invoice.cents - invoice.applied)
      })), 'id', 'label') +
      '<label>Entry type<select name="kind"><option value="payment">Payment</option><option value="credit">Credit</option></select></label>' +
      field('cents', 'Amount in cents', 'type="number" min="1"') + field('reference', 'Payment or credit reference'), 'Record entry')}
    ${form('Assign or replace renter', 'assignments', select('site','Site',sites,'id','name') + select('renter','Renter',renters,'id','name') + field('rate','Charge in cents','type="number" min="0" value="4500"') + field('minimum','Minimum talk time (seconds)','type="number" min="0" value="90"'), 'Save assignment')}
    ${form('Simulate incoming call', 'calls', select('number','Tracking number',sites,'number','name') + field('source','Attribution source','value="Google Ads"'), 'Simulate arrival')}
    ${form('Simulate call completion', 'complete', select('id','Pending call',pending,'id','label') + field('duration','Talk time (seconds)','type="number" min="0" value="95"') + '<label>Outcome<select name="outcome"><option>answered</option><option>missed</option></select></label>', 'Finalize call')}
    </div>` : '') + `<div class="grid"><section><h2>Tracking sites</h2>${sites.map(site => `<p>${escape(site.name)} · ${escape(site.number)}<br><small>${escape(renters.find(renter => renter.id === assignments.find(row => row.site === site.id && !row.ended)?.renter)?.name || 'Unassigned')}</small></p>`).join('') || '<p>No sites yet.</p>'}</section>
    <section><h2>${canWrite ? 'Renter portals' : 'Renters'}</h2>${renters.map(renter => canWrite ? `<p><a href="/portal?token=${encodeURIComponent(renter.portal)}">${escape(renter.name)}</a></p>` : `<p>${escape(renter.name)}</p>`).join('') || '<p>No renters yet.</p>'}</section></div><section><h2>Assignment history</h2>${assignments.map(row => `<p>${escape(sites.find(site => site.id === row.site)?.name)} · ${escape(renters.find(renter => renter.id === row.renter)?.name)} · ${money(row.rate)} · ${row.minimum}s minimum <small>${escape(new Date(row.started).toLocaleString())} → ${row.ended ? escape(new Date(row.ended).toLocaleString()) : 'Active'}</small></p>`).join('') || '<p>No assignments yet.</p>'}</section>${history(calls, true)}`;
  dashboard.insertAdjacentHTML('beforeend', invoiceList(invoices));
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
      const result = await request(action === 'complete' ? 'calls/' + encodeURIComponent(data.id) + '/complete' : action, data);
      if (action === 'network/ping') {
        status.textContent = result.buyer ? result.buyer + ' · ' + money(result.bid) : 'No match · ' + result.outcome;
        return;
      }
      status.textContent = action === 'calls' ? (result.destination ? 'Selected destination ' + result.destination : 'No active renter') : 'Saved.';
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
