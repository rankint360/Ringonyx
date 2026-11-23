export async function renderManagement({ request, escape: e, money, session, form, field, select, invoiceList, networkInvoices, networkTable }) {
  const path = location.pathname;
  if (!['/settings','/websites','/renters','/buyers','/handling','/invoices'].includes(path)) return false;
  const root = document.querySelector('#dashboard');
  const owner = session.role === 'owner';
  const writable = session.role !== 'viewer';
  const data = await request('management');
  const section = (title, content) => '<section><h3>' + title + '</h3>' + content + '</section>';
  const options = (name, label, values) => '<label>' + label + '<select name="' + name + '">' +
    values.map(value => '<option value="' + value + '">' + value + '</option>').join('') + '</select></label>';
  const tabs = rows => '<nav class="settings-tabs">' + rows.map(([label, href]) =>
    '<a class="' + (location.href.endsWith(href) ? 'active' : '') + '" href="' + href + '">' + label + '</a>').join('') + '</nav>';
  const rows = (headers, items) => '<div class="console-table"><table><thead><tr>' +
    headers.map(label => '<th>' + label + '</th>').join('') + '</tr></thead><tbody>' +
    items.map(row => '<tr>' + row.map(cell => '<td>' + cell + '</td>').join('') + '</tr>').join('') +
    '</tbody></table>' + (!items.length ? '<div class="console-empty">No records yet.</div>' : '') + '</div>';
  if (path === '/settings') {
    const tab = new URLSearchParams(location.search).get('tab') || 'general';
    root.innerHTML = '<h1>Settings</h1>' + tabs([['General','/settings'],['Team','/settings?tab=team'],
      ['Billing','/settings?tab=billing'],['Integrations','/settings?tab=integrations'],['Your login','/settings?tab=login']]);
    if (tab === 'general') {
      root.innerHTML += '<h2>Business settings</h2>' + (owner ? form('General', 'management/business',
        field('name', 'Name', 'value="' + e(session.workspace) + '"') +
        field('timezone', 'Time zone', 'value="' + e(data.business.timezone) + '"') +
        '<label>Alert terms<input name="terms" maxlength="1000" value="' + e(data.business.alert_terms) + '"></label>', 'Save business settings') :
        section('General', '<p>' + e(session.workspace) + ' · ' + e(data.business.timezone) + '</p>')) +
        (owner ? form('Branding', 'operations/brand', field('name', 'Portal brand name') +
          field('accent', 'Accent', 'type="color" value="#fa7912"'), 'Save branding') : '') +
        (owner ? section('Leave account', '<p>Transfer ownership to another teammate before leaving.</p><a href="/settings?tab=team">Manage ownership →</a>') :
          form('Leave account','management/leave', '<p>This disables your sign-in and revokes all sessions. A platform administrator can restore access.</p>' +
            field('current','Current password','type="password" autocomplete="current-password"') +
            field('confirm','Type LEAVE to confirm'),'Leave account'));
    } else if (tab === 'team') {
      root.innerHTML += '<h2>Team</h2>' + rows(['Name','Email','Role'], data.team.map(member =>
        [e(member.name || '—'),e(member.email),e(member.role)]));
      if (owner) root.innerHTML += form('Invite teammate', 'management/invite', field('email', 'Email', 'type="email"') +
        options('role', 'Role', ['operator','viewer']), 'Create invitation') +
        section('Roles', '<p>Owners manage the workspace and team. Operators manage calls and customers. Viewers have read access.</p>') +
        form('Change teammate role', 'management/role', select('id','Team member',data.team.filter(member => member.role !== 'owner'),'id','email') +
          options('role','Role',['operator','viewer']), 'Save role') +
        form('Transfer ownership', 'management/transfer', select('id','New owner',data.team.filter(member => member.email !== session.email),'id','email') +
          field('current','Your password','type="password" autocomplete="current-password"'), 'Transfer ownership') +
        section('Pending invitations', rows(['Email','Role','Expires'],data.invitations.map(invite =>
          [e(invite.email),e(invite.role),e(new Date(invite.expires).toLocaleString())])));
    } else if (tab === 'login') {
      root.innerHTML += '<h2>Your login</h2>' + form('Your details','management/profile',
        field('name','Name','value="' + e(data.name) + '"') + '<p>' + e(data.email) + '</p>', 'Save name') +
        form('Password','management/password',field('current','Current password','type="password" autocomplete="current-password"') +
          field('password','New password','type="password" minlength="14" autocomplete="new-password"') +
          field('confirm','Repeat new password','type="password" minlength="14" autocomplete="new-password"'), 'Change password') +
        (data.twoFactor ? form('Two-factor authentication · On','management/totp-disable',
          field('current','Current password','type="password" autocomplete="current-password"') +
          field('code','Authenticator or recovery code'),'Disable authenticator') :
          form('Set up authenticator app','management/totp-setup',
            field('current','Current password','type="password" autocomplete="current-password"'),'Generate setup key') +
          form('Confirm authenticator','management/totp-enable',
            field('current','Current password','type="password" autocomplete="current-password"') +
            field('code','Six-digit code','inputmode="numeric" autocomplete="one-time-code"'),'Enable authenticator')) +
        section('Active sessions',rows(['Device','Server-observed address','Signed in','Expires','Action'],data.sessions.map(item =>
          [e(item.device || 'Unknown'),e(item.address || '—'),e(item.created || '—'),
            e(new Date(item.expires).toLocaleString()), '<form data-action="management/revoke-session"><input type="hidden" name="id" value="' +
            e(item.id) + '"><button>Sign out session</button></form>']))) +
        section('Login history',rows(['When','Event','Device','Server-observed address'],data.history.map(item =>
          [e(new Date(item.created).toLocaleString()),e(item.event),e(item.device),e(item.address)]))) +
        (owner ? section('Team sign-ins',rows(['When','Person','Event','Device'],data.teamHistory.map(item =>
          [e(new Date(item.created).toLocaleString()),e(item.email),e(item.event),e(item.device)]))) : '');
    } else if (tab === 'billing') {
      root.innerHTML += '<h2>Plan</h2><p>Commercial plans are awaiting payment integration.</p><div class="plan-grid">' +
        ['Free','Individual','Network'].map(name => section(name, '<p>' +
          ({Free:'Number setup and local call workflows',Individual:'Site rentals, attribution and customer portals',Network:'Buyer and publisher operations'}[name]) +
          '</p><p>Pricing and activation pending.</p>')).join('') + '</div>' +
        section('Customer payments','<p>Manage issued invoices and manually recorded payments and credits.</p><a href="/invoices">Open invoices →</a>');
    } else if (tab === 'integrations') {
      root.innerHTML += '<h2>Apps</h2><p>Provider connections need configuration. Local exports and developer access are available under Operations.</p>' +
        ['Google Ads','Meta','HubSpot','Salesforce','Transcription','Caller lookup','Caller profiles','Slack'].map(name =>
          '<details class="integration-row"><summary>' + name + ' <span>Not connected</span></summary><p>Provider authorization and event delivery are pending.</p></details>').join('') +
        section('API, webhooks and migration','<a href="/operations">Manage developer keys, signed event previews, CSV imports and exports →</a>');
    }
    return true;
  }
  const [sites, renters, network] = await Promise.all([request('sites'),request('renters'),request('network')]);
  if (path === '/websites') {
    root.innerHTML = '<h1>Websites</h1><p>Connect tracking numbers and capture leads by source.</p>' +
      section('Tracking sites', rows(['Name','Number','Setup'],sites.map(site =>
        [e(site.name),e(site.number),'<a href="/app">Configure attribution →</a>']))) +
      (writable ? form('Add website tracking','sites',field('name','Site name') + field('number','Tracking number','placeholder="+16025550100"'),'Add site') : '');
  } else if (path === '/renters' || path === '/buyers') {
    const kind = path === '/renters' ? 'renter' : 'buyer';
    const customers = kind === 'renter' ? renters : network.buyers;
    const getState = id => data.states.find(state => state.kind === kind && state.party === id)?.state ||
      (kind === 'buyer' && network.pauses.some(pause => pause.kind === 'buyer' && pause.party === id) ? 'paused' : 'active');
    root.innerHTML = '<h1>' + (kind === 'renter' ? 'Tenants / Renters' : 'Buyers') + '</h1>' +
      '<div class="console-toolbar"><input id="customer-search" placeholder="Search by name or phone" aria-label="Search customers">' +
      '<select id="customer-status" aria-label="Customer status"><option value="">All</option><option>active</option><option>paused</option><option>archived</option></select></div>' +
      '<section id="customer-list"></section>' +
      (writable ? (kind === 'renter' ? form('Add tenant / renter','renters',field('name','Business') +
        field('destination','Phone','placeholder="+16025550101"'),'Add tenant / renter') :
        form('Add buyer','network/buyers',field('name','Name') + field('destination','Phone') + field('region','Two-letter region') +
          ['price','minimum','cap','concurrency'].map(key => field(key,({price:'Price in cents',minimum:'Minimum seconds',cap:'Daily call cap',concurrency:'Concurrent calls'}[key]),
            'type="number" min="0" value="' + ({price:5000,minimum:90,cap:20,concurrency:2}[key]) + '"')).join(''),'Add buyer')) : '') +
      (owner ? form('Customer status','management/customer-state','<input type="hidden" name="kind" value="' + kind + '">' +
        select('id','Customer',customers,'id','name') + options('state','Status',['active','paused','archived']),'Save status') : '') +
      '<a href="' + (kind === 'renter' ? '/app' : '/network') + '">Open billing, assignment and routing controls →</a>';
    const draw = () => {
      const search = document.querySelector('#customer-search').value.toLowerCase();
      const status = document.querySelector('#customer-status').value;
      document.querySelector('#customer-list').innerHTML = rows(['Business','Phone','Status'],customers.filter(customer =>
        (customer.name + customer.destination).toLowerCase().includes(search) && (!status || getState(customer.id) === status))
        .map(customer => [e(customer.name),e(customer.destination),e(getState(customer.id))]));
    };
    document.querySelector('#customer-search').oninput = draw;
    document.querySelector('#customer-status').onchange = draw;
    draw();
  } else if (path === '/handling') {
    const routes = await request('routing');
    const menus = await request('routing/menu');
    const tab = new URLSearchParams(location.search).get('tab') || 'rules';
    root.innerHTML = tabs([['Routing rules','/handling'],['Targets','/handling?tab=targets'],['Call flows','/handling?tab=flows'],
      ['Live bidding','/network'],['Blocked callers and value lists','/handling?tab=lists']]) + '<h1>Call handling</h1>';
    if (tab === 'lists') root.innerHTML += section('Caller lists',rows(['List','Number','Action'],data.callerLists.map(row =>
      [e(row.list),e(row.value),row.blocked ? 'Blocked in simulator' : 'Listed']))) +
      (owner ? form('Manage caller list','management/caller-list',field('list','List name') +
        field('value','Caller number','placeholder="+16025550102"') +
        options('operation','Action',['block','allow','remove']),'Save list entry') : '') +
      '<p>Any blocked entry prevents simulated calls from routing. An allow entry only removes the block within its named list.</p>';
    else if (tab === 'targets') root.innerHTML += section('Targets',rows(['Name','Phone'],[...renters,...network.buyers].map(row => [e(row.name),e(row.destination)])));
    else if (tab === 'flows') root.innerHTML += section('Phone menus',rows(['Site','Digit','Label','Destination'], menus.map(row =>
      [e(sites.find(site => site.id === row.site)?.name),e(row.digit),e(row.label),e(row.destination)]))) +
      '<a href="/app">Edit menus and test call flows →</a>';
    else root.innerHTML += section('Routing rules',rows(['Site','Position','Target','Phone'],routes.map(row =>
      [e(sites.find(site => site.id === row.site)?.name),row.position,e(row.label),e(row.destination)]))) +
      '<a href="/app">Create a routing rule and simulate calls →</a>';
  } else if (path === '/invoices') {
    const invoices = await request('invoices');
    const tab = new URLSearchParams(location.search).get('tab') || 'invoices';
    root.innerHTML = tabs([['Invoices','/invoices'],['Payouts','/invoices?tab=payouts'],['Disputes','/invoices?tab=disputes']]) + '<h1>Invoices</h1>';
    if (tab === 'payouts') root.innerHTML += section('Publisher payout statement',networkTable(network.calls)) +
      '<p>Payout amounts are accrued locally. Transfers await provider integration.</p>';
    else if (tab === 'disputes') {
      const disputes = await request('disputes');
      root.innerHTML += section('Renter disputes',rows(['Customer','Reason','Resolution'],disputes.map(row =>
        [e(row.renter_name),e(row.reason),e(row.resolution || 'Open')]))) +
        section('Buyer disputes',rows(['Invoice','Reason','Resolution'],network.invoices.filter(row => row.reason).map(row =>
          [e(row.id),e(row.reason),e(row.resolution || 'Open')]))) +
        '<a href="/app">Manage renter disputes</a> · <a href="/network">Manage buyer disputes</a>';
    } else {
      const all = [...invoices,...network.invoices];
      const due = all.reduce((sum,row) => sum + row.cents - row.applied,0);
      root.innerHTML += section('Owed to you','<strong class="metric">' + money(due) + '</strong>') +
        '<div class="console-toolbar"><input id="invoice-search" placeholder="Search customer or invoice" aria-label="Search invoices">' +
        '<select id="invoice-status" aria-label="Invoice status"><option value="">All</option><option value="unpaid">Unpaid</option><option value="paid">Paid</option></select></div><div id="invoice-results"></div>' +
        '<a href="/app">Create renter invoices and reconcile payments</a> · <a href="/network">Create buyer invoices and reconcile payments</a>';
      const draw = () => {
        const term = document.querySelector('#invoice-search').value.toLowerCase();
        const status = document.querySelector('#invoice-status').value;
        const matches = row => [row.id,row.renter_name,row.buyer_name].join(' ').toLowerCase().includes(term) &&
          (!status || (row.cents > row.applied) === (status === 'unpaid'));
        document.querySelector('#invoice-results').innerHTML = invoiceList(invoices.filter(matches)) + networkInvoices(network.invoices.filter(matches));
      };
      document.querySelector('#invoice-search').oninput = draw;
      document.querySelector('#invoice-status').onchange = draw;
      draw();
    }
  }
  return true;
}
