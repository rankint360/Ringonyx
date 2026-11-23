import { businessDay, inDateRange } from './dates.js';
const links = [
  ['Home', '/overview', '⌂'], ['Calls', '/calls', '↙'], ['Dialer', '/dialer', '♧'],
  ['Messages', '/messages', '□'], ['Leads', '/leads', '▤'], ['Reports', '/reports', '▦'],
  ['Numbers', '/numbers', '#'], ['Websites', '/websites', '◎'], ['Tenants / Renters', '/renters', '♙'],
  ['Buyers', '/buyers', '▥'], ['Call handling', '/handling', '⑂'],
  ['Invoices', '/invoices', '▧'], ['Settings', '/settings', '☷'], ['Workspace tools','/workspace-tools','⚙']
];
const encode = value => String(value ?? '').replace(/[&<>"']/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
export function mountConsole(session) {
  document.body.classList.add('workspace-console');
  let sidebar = document.querySelector('.console-sidebar');
  sidebar?.remove();
  document.querySelector('.console-top')?.remove();
  sidebar = document.createElement('aside');
  sidebar.className = 'console-sidebar';
  sidebar.innerHTML = '<a class="console-logo" href="/overview">◔ <strong>ringonyx</strong></a>' +
    '<div class="workspace-switch"><strong>' + encode(session.workspace) + '</strong><small>My business</small></div>' +
    '<nav>' + links.map(([label, path, icon], index) =>
      (index === 6 ? '<small class="nav-group">Set up</small>' : '') +
      '<a class="' + (location.pathname === path.split('#')[0] && !path.includes('#') ? 'selected' : '') +
      '" href="' + path + '"><span>' + icon + '</span>' + label + '</a>').join('') + '</nav>' +
    '<a class="getting-started" href="/overview">Getting started →</a><div class="console-user">' +
    encode(session.email) + '<small>' + encode(session.role) + '</small></div>';
  document.body.prepend(sidebar);
  const top = document.createElement('div');
  top.className = 'console-top';
  top.innerHTML = '<strong>' + (links.find(row => row[1] === location.pathname)?.[0] || 'Workspace') +
    '</strong><input aria-label="Find a page" placeholder="Search pages…" list="console-pages">' +
    '<datalist id="console-pages">' + links.map(row => '<option value="' + row[0] + '">').join('') +
    '</datalist><a class="console-button" href="/numbers">＋ Get a number</a>';
  top.querySelector('input').addEventListener('change', event => {
    const match = links.find(row => row[0].toLowerCase() === event.target.value.toLowerCase());
    if (match) location.assign(match[1]);
  });
  document.body.prepend(top);
}
export function unmountConsole() {
  document.querySelector('.console-sidebar')?.remove();
  document.querySelector('.console-top')?.remove();
  document.body.classList.remove('workspace-console');
}
function table(headers, rows, empty) {
  return '<div class="console-table"><table><thead><tr>' + headers.map(h => '<th>' + h + '</th>').join('') +
    '</tr></thead><tbody>' + rows.map(row => '<tr>' + row.map(value => '<td>' + value + '</td>').join('') +
    '</tr>').join('') + '</tbody></table>' + (!rows.length ? '<div class="console-empty">' + empty + '</div>' : '') + '</div>';
}
function download(rows) {
  const fields = Object.keys(rows[0] || {});
  const cell = value => '"' + String(value ?? '').replaceAll('"', '""').replace(/^([=+@-])/, "'$1") + '"';
  const csv = [fields, ...rows.map(row => fields.map(key => row[key]))].map(row => row.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'ringonyx-export.csv';
  link.click();
  URL.revokeObjectURL(url);
}
export async function renderConsole({ request, escape: e, money, history, session }) {
  const path = location.pathname;
  if (!['/overview', '/calls', '/numbers', '/dialer', '/messages', '/reports'].includes(path)) return false;
  const dashboard = document.querySelector('#dashboard');
  const [calls, sites] = await Promise.all([request('calls'), request('sites')]);
  const settings = await request('management');
  const timezone = settings.business.timezone;
  const title = (heading, description) => '<h1>' + heading + '</h1><p class="console-muted">' + description + '</p>';
  const panel = content => '<section class="console-panel">' + content + '</section>';
  const tools = '<div class="console-toolbar"><label>Date range <select id="period"><option value="7">7 days</option>' +
    '<option value="1">Today</option><option value="2">Yesterday</option><option value="30">30 days</option>' +
    '<option value="0">All time</option><option value="month">This month</option><option value="last-month">Last month</option>' +
    '<option value="custom">Custom dates</option></select></label>' +
    '<label>From<input type="date" id="report-start"></label><label>Through<input type="date" id="report-end"></label>' +
    '<button type="button" id="export">↓ CSV</button></div>' +
    '<div class="console-toolbar"><select id="saved-view" aria-label="Saved report view"><option value="">Saved views</option>' +
    settings.reportViews.map(row=>'<option value="'+e(row.name)+'">'+e(row.name)+'</option>').join('')+'</select>' +
    (session.role!=='viewer'?'<input id="view-name" aria-label="View name" placeholder="View name"><button type="button" id="save-view">Save view</button>':'')+'</div>'+
    '<input type="hidden" id="report-columns" value="0,1,2,3,4,5,6"><details><summary>Call log columns</summary><div class="console-toolbar">'+
    ['Time','Site','Renter','Source','Outcome','Seconds','Charge'].map((label,index)=>'<label><input type="checkbox" data-call-column="'+index+'" checked>'+label+'</label>').join('')+'</div></details>';
  let filtered = calls;
  function applyColumns() {
    const selected=(document.getElementById('report-columns')?.value||'0,1,2,3,4,5,6').split(',');
    for (const checkbox of document.querySelectorAll('[data-call-column]')) checkbox.checked=selected.includes(checkbox.dataset.callColumn);
    for (const row of document.querySelectorAll('#dashboard .scroll table tr')) {
      if (row.cells.length===1) row.cells[0].colSpan=selected.length;
      else for (let index=0;index<row.cells.length;index++) row.cells[index].hidden=!selected.includes(String(index));
    }
  }
  function heatmap(rows) {
    const buckets = Array.from({ length: 7 }, () => Array(24).fill(0));
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', hour: 'numeric', hourCycle: 'h23' });
    for (const call of rows) {
      const parts = formatter.formatToParts(new Date(call.created));
      const day = days.indexOf(parts.find(part => part.type === 'weekday').value);
      const hour = Number(parts.find(part => part.type === 'hour').value);
      buckets[day][hour]++;
    }
    const max = Math.max(1, ...buckets.flat());
    return '<h3>When people call</h3><p>Calls by day and hour · ' + e(timezone) + '</p>' +
      '<div class="heatmap">' + buckets.map((hours, day) => '<span>' + days[day] + '</span>' +
        hours.map((count, hour) => '<button type="button" class="heat-cell" style="--intensity:' +
          (count ? .2 + .8 * count / max : 0) + '" aria-label="' + days[day] + ' ' + hour + ':00 · ' + count +
          ' calls" title="' + days[day] + ' ' + hour + ':00 · ' + count + ' calls" data-hour="' + hour +
          '" data-day="' + day + '">' + (count || '') + '</button>').join('')).join('') +
      '</div><p id="heat-selection" role="status">Select a square to inspect its call count.</p>';
  }
  function dateFilter() {
    const period = document.querySelector('#period').value;
    if (['month','last-month','custom'].includes(period)) {
      let start=document.querySelector('#report-start').value, end=document.querySelector('#report-end').value;
      const today=businessDay(new Date(),timezone);
      if (period==='month') { start=today.slice(0,7)+'-01'; end=today; }
      if (period==='last-month') {
        const month=new Date(today.slice(0,7)+'-01T12:00:00Z');
        month.setUTCDate(0);
        end=month.toISOString().slice(0,10); start=end.slice(0,7)+'-01';
      }
      return calls.filter(call=>{
        const day=businessDay(call.created,timezone);
        return (!start||day>=start)&&(!end||day<=end);
      });
    }
    const days = Number(period);
    return calls.filter(call => inDateRange(call.created, days, timezone));
  }
  if (path === '/overview' || path === '/reports') {
    dashboard.innerHTML = title(path === '/overview' ? 'Overview' : 'Reports', 'Calls, outcomes and qualified revenue') +
      tools + '<div id="overview-data"></div>';
    const draw = () => {
      filtered = dateFilter();
      const answered = filtered.filter(call => call.outcome === 'answered');
      const revenue = filtered.reduce((sum, call) => sum + call.cents, 0);
      const billable = filtered.filter(call => call.cents > 0).length;
      const groups = new Map();
      for (const call of filtered) {
        const day = businessDay(call.created, timezone);
        groups.set(day, (groups.get(day) || 0) + 1);
      }
      const chart = groups.size ? [...groups].reverse().map(([day, count]) =>
        '<div class="chart-row"><span>' + e(day) + '</span><meter min="0" max="' +
        Math.max(...groups.values()) + '" value="' + count + '">' + count + '</meter><b>' + count + '</b></div>').join('') :
        '<div class="console-empty">No calls in this range yet.</div>';
      document.querySelector('#overview-data').innerHTML = (path === '/overview' ? panel('<h3>Get your first calls</h3>' +
        '<div class="setup-grid"><div><h4>Get a tracking number</h4><p>Add an existing number or prepare a carrier request.</p><a href="/numbers">Open numbers →</a></div>' +
        '<div><h4>Set up your ring tree</h4><p>Assign a renter and test fallback destinations.</p><a href="/app#routing">Open call handling →</a></div>' +
        '<div><h4>Check the result</h4><p>Inspect qualification and the invoice line.</p><a href="/calls">Open calls →</a></div></div>') : '') +
        '<div class="metric-grid">' + [['Calls', filtered.length], ['Answer rate', filtered.length ? Math.round(answered.length / filtered.length * 100) + '%' : '—'],
          ['Billable calls', billable], ['Revenue', money(revenue)]].map(([label, value]) =>
          panel('<small>' + label + '</small><strong class="metric">' + value + '</strong>')).join('') + '</div>' +
        '<div class="report-grid">' + panel('<h3>Calls per day</h3>' + chart) +
        panel('<h3>What happened to calls</h3>' + ['answered', 'missed', 'pending', 'unrouted'].map(outcome =>
          '<p class="outcome-row"><span>' + outcome + '</span><b>' + filtered.filter(call => call.outcome === outcome).length + '</b></p>').join('')) + '</div>' +
        panel(heatmap(filtered)) +
        (path === '/reports' ? panel('<h3>Group results</h3><select id="report-group" aria-label="Group results">' +
          '<option value="source">Traffic source</option><option value="site_name">Website</option>' +
          '<option value="renter_name">Tenant / renter</option><option value="campaign">Campaign</option>' +
          '<option value="outcome">Call status</option></select><div id="group-results"></div>') : '') +
        panel('<h3>Call log</h3>' + history(filtered, true));
      for (const cell of document.querySelectorAll('.heat-cell')) cell.onclick = () => {
        document.querySelector('#heat-selection').textContent = cell.getAttribute('aria-label');
      };
      const groupControl = document.querySelector('#report-group');
      if (groupControl) {
        const group = () => {
          const totals = new Map();
          for (const call of filtered) {
            const key = call[groupControl.value] || 'Unassigned';
            const row = totals.get(key) || { calls: 0, billable: 0, revenue: 0 };
            row.calls++;
            row.billable += Number(call.cents > 0);
            row.revenue += call.cents;
            totals.set(key, row);
          }
          document.querySelector('#group-results').innerHTML = table(['Group', 'Calls', 'Billable', 'Revenue'],
            [...totals].map(([key, row]) => [e(key), row.calls, row.billable, money(row.revenue)]), 'No calls in this range.');
        };
        groupControl.onchange = group;
        group();
      }
      applyColumns();
    };
    document.querySelector('#period').addEventListener('change', draw);
    document.querySelector('#export').onclick = () => download(filtered);
    draw();
  } else if (path === '/calls') {
    dashboard.innerHTML = title('Call log', 'Inspect incoming calls and qualified charges') + tools +
      panel('<div class="console-toolbar"><input id="call-search" placeholder="Search site, source or destination" aria-label="Search calls">' +
        '<select id="outcome" aria-label="Call status"><option value="">Any status</option>' +
        ['answered', 'missed', 'pending', 'unrouted'].map(x => '<option>' + x + '</option>').join('') +
        '</select><select id="billable" aria-label="Billable"><option value="">All calls</option><option value="yes">Billable</option><option value="no">Not billable</option></select></div><div id="call-results"></div>');
    const draw = () => {
      const search = document.querySelector('#call-search').value.toLowerCase();
      const outcome = document.querySelector('#outcome').value;
      const billable = document.querySelector('#billable').value;
      filtered = dateFilter().filter(call => (!outcome || call.outcome === outcome) &&
        (!billable || (call.cents > 0) === (billable === 'yes')) &&
        [call.site_name, call.source, call.simulated_destination,call.caller_number,call.caller_zip].join(' ').toLowerCase().includes(search));
      document.querySelector('#call-results').innerHTML = history(filtered, true);
      applyColumns();
    };
    for (const id of ['period', 'call-search', 'outcome', 'billable']) document.getElementById(id).addEventListener('input', draw);
    document.querySelector('#export').onclick = () => download(filtered);
    draw();
  } else if (path === '/numbers') {
    const assignments = await request('assignments');
    const renters = await request('renters');
    const active = site => assignments.find(row => row.site === site.id && !row.ended);
    dashboard.innerHTML = title('Numbers', sites.length + ' registered tracking numbers') +
      '<div class="console-toolbar"><input id="number-search" placeholder="Search by number or name" aria-label="Search numbers">' +
      '<select id="number-filter" aria-label="Number status"><option value="">All numbers</option><option value="unset">Not set up</option>' +
      '<option value="renter">Tenants / Renters</option><option value="inactive">No calls in 60 days</option></select>' +
      '<a class="console-button" href="/communications">Porting and number setup</a></div><div id="number-results"></div>';
    const draw = () => {
      const term = document.querySelector('#number-search').value.toLowerCase();
      const filter = document.querySelector('#number-filter').value;
      document.querySelector('#number-results').innerHTML = panel(table(['Number', 'Name', 'Calls go to', 'Calls (30 days)', 'Last call', 'Status'],
        sites.filter(site => (site.number + site.name + (site.voice_source || '')).toLowerCase().includes(term))
          .filter(site => !filter || (filter === 'unset' ? !active(site) : filter === 'renter' ? Boolean(active(site)) :
            !calls.some(call => call.site === site.id && Date.now() - Date.parse(call.created) < 60 * 86400000))).map(site => {
          const activity = calls.filter(call => call.site === site.id);
          return [e(site.number), e(site.name), e(renters.find(row => row.id === active(site)?.renter)?.name || 'Not assigned'),
            activity.filter(call => Date.now() - Date.parse(call.created) < 30 * 86400000).length,
            activity[0] ? e(new Date(activity[0].created).toLocaleString()) : '—',
            site.voice_source ? 'Carrier source configured' : 'Local setup'];
        }), 'No numbers yet. <a href="/communications">Set up a tracking number →</a>'));
    };
    document.querySelector('#number-search').oninput = draw;
    document.querySelector('#number-filter').onchange = draw;
    draw();
  } else {
    const data = await request('communications');
    if (path === '/messages') {
      dashboard.innerHTML = title('Messages', 'Messages received in the local inbox') +
        panel('<div class="console-toolbar"><input id="message-search" placeholder="Search texts or phone numbers" aria-label="Search messages">' +
          '<label><input type="checkbox" id="codes"> Codes only</label></div><div id="message-results"></div>');
      const draw = () => {
        const search = document.querySelector('#message-search').value.toLowerCase();
        const codes = document.querySelector('#codes').checked;
        document.querySelector('#message-results').innerHTML = table(['Received', 'From', 'Site', 'Message'],
          data.messages.filter(row => [row.sender, row.body].join(' ').toLowerCase().includes(search) &&
            (!codes || /\b\d{4,8}\b/.test(row.body))).map(row =>
            [e(new Date(row.created).toLocaleString()), e(row.sender), e(row.site_name), e(row.body)]), 'No messages match this search.');
      };
      document.querySelector('#message-search').oninput = draw;
      document.querySelector('#codes').onchange = draw;
      draw();
    } else {
      dashboard.innerHTML = title('Dialer', 'Prepare a callback using one of your registered numbers') +
        '<div class="report-grid">' + panel('<h3>Queue a callback</h3><p>Live browser calling awaits carrier integration.</p>' +
          '<form data-action="communications/callbacks"><label>From<select name="site" required>' +
          sites.map(site => '<option value="' + e(site.id) + '">' + e(site.number) + '</option>').join('') +
          '</select></label><label>Destination<input name="destination" placeholder="+16025550101" required></label><button>Queue callback</button></form>') +
        panel('<h3>Recent callback requests</h3>' + table(['To', 'Site', 'State'], data.callbacks.map(row =>
          [e(row.destination), e(row.site_name), e(row.state)]), 'No callback requests yet.')) + '</div>';
    }
  }
  if (document.getElementById('period')) {
    for (const checkbox of document.querySelectorAll('[data-call-column]')) checkbox.onchange=()=>{
      const selected=[...document.querySelectorAll('[data-call-column]:checked')].map(item=>item.dataset.callColumn);
      if (!selected.length) {checkbox.checked=true;return;}
      document.getElementById('report-columns').value=selected.join(',');
      applyColumns();
    };
    for (const id of ['report-start','report-end']) document.getElementById(id).onchange=()=>{
      document.getElementById('period').value='custom';
      document.getElementById('period').dispatchEvent(new Event(path==='/calls'?'input':'change'));
    };
    document.getElementById('saved-view').onchange=event=>{
      const view=settings.reportViews.find(row=>row.name===event.target.value)?.config;
      if (!view) return;
      for (const [id,value] of Object.entries(view)) {
        const control=document.getElementById(id);
        if (control && typeof value==='string') control.value=value;
      }
      document.getElementById('period').dispatchEvent(new Event(path==='/calls'?'input':'change'));
      if (view['report-group'] && document.getElementById('report-group')) {
        document.getElementById('report-group').value=view['report-group'];
        document.getElementById('report-group').dispatchEvent(new Event('change'));
      }
      applyColumns();
    };
    document.getElementById('save-view')?.addEventListener('click',async()=>{
      try {
        const config={};
        for (const id of ['period','report-start','report-end','call-search','outcome','billable','report-group','report-columns']) {
          const control=document.getElementById(id);
          if (control) config[id]=control.value;
        }
        await request('management/report-view',{name:document.getElementById('view-name').value,config});
        await renderConsole({request,escape:e,money,history,session});
        document.getElementById('status').textContent='Report view saved.';
      } catch(error) {document.getElementById('status').textContent=error.message;}
    });
  }
  return true;
}
