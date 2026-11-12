const app = document.querySelector('#app');
const status = document.querySelector('#status');
const portal = new URLSearchParams(location.search).get('token');
const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
async function request(path, data) {
  const response = await fetch('/api/' + path, {
    method: data ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Ringonyx-Operator': sessionStorage.getItem('operator') || 'local-demo' },
    body: data ? JSON.stringify(data) : undefined
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error);
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
async function render() {
  if (location.pathname === '/portal') {
    if (!portal) throw Error('Open the portal link provided by your operator.');
    const result = await request('portal/' + encodeURIComponent(portal));
    app.innerHTML = '<h1>' + escape(result.renter) + '</h1>' + history(result.calls, false);
    return;
  }
  app.innerHTML = '<h1>Call operations</h1><form id="access"><label>Operator key<input id="key" type="password" name="key" required></label><button style="width:max-content">Connect</button></form><div id="dashboard"></div>';
  document.querySelector('#key').value = sessionStorage.getItem('operator') || 'local-demo';
  const [sites, renters, assignments, calls] = await Promise.all(['sites','renters','assignments','calls'].map(path => request(path)));
  const pending = calls.filter(call => call.outcome === 'pending').map(call => ({ id: call.id, label: call.site_name + ' · ' + new Date(call.created).toLocaleTimeString() }));
  const dashboard = document.querySelector('#dashboard');
  dashboard.innerHTML = `<div class="grid">
    ${form('Tracking site', 'sites', field('name', 'Site name') + field('number', 'Tracking number', 'placeholder="+16025550100"'), 'Add site')}
    ${form('Renter', 'renters', field('name', 'Business name') + field('destination', 'Forwarding number', 'placeholder="+16025550101"'), 'Add renter')}
    ${form('Assign or replace renter', 'assignments', select('site','Site',sites,'id','name') + select('renter','Renter',renters,'id','name') + field('rate','Charge in cents','type="number" min="0" value="4500"') + field('minimum','Minimum talk time (seconds)','type="number" min="0" value="90"'), 'Save assignment')}
    ${form('Simulate incoming call', 'calls', select('number','Tracking number',sites,'number','name') + field('source','Attribution source','value="Google Ads"'), 'Simulate arrival')}
    ${form('Simulate call completion', 'complete', select('id','Pending call',pending,'id','label') + field('duration','Talk time (seconds)','type="number" min="0" value="95"') + '<label>Outcome<select name="outcome"><option>answered</option><option>missed</option></select></label>', 'Finalize call')}
    </div><div class="grid"><section><h2>Tracking sites</h2>${sites.map(site => `<p>${escape(site.name)} · ${escape(site.number)}<br><small>${escape(renters.find(renter => renter.id === assignments.find(row => row.site === site.id)?.renter)?.name || 'Unassigned')}</small></p>`).join('') || '<p>No sites yet.</p>'}</section>
    <section><h2>Renter portals</h2>${renters.map(renter => `<p><a href="/portal?token=${encodeURIComponent(renter.portal)}">${escape(renter.name)}</a></p>`).join('') || '<p>No renters yet.</p>'}</section></div>${history(calls, true)}`;
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
      sessionStorage.setItem('operator', data.key);
    } else {
      for (const key of ['rate', 'minimum', 'duration']) if (Object.hasOwn(data, key)) data[key] = Number(data[key]);
      const action = form.dataset.action;
      const result = await request(action === 'complete' ? 'calls/' + encodeURIComponent(data.id) + '/complete' : action, data);
      status.textContent = action === 'calls' ? (result.destination ? 'Selected destination ' + result.destination : 'No active renter') : 'Saved.';
    }
    await render();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
render().catch(error => { status.textContent = error.message; });
