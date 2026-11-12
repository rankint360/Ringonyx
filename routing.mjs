export function routing(db, { query, run, transaction, required, phone, fail }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS site_routes (
      site TEXT NOT NULL REFERENCES sites(id), position INTEGER NOT NULL,
      label TEXT NOT NULL, destination TEXT NOT NULL, PRIMARY KEY(site, position),
      UNIQUE(site, destination)
    );
    CREATE TABLE IF NOT EXISTS site_menus (
      site TEXT PRIMARY KEY REFERENCES sites(id), prompt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS site_menu_options (
      site TEXT NOT NULL REFERENCES site_menus(site), digit TEXT NOT NULL,
      label TEXT NOT NULL, destination TEXT NOT NULL, PRIMARY KEY(site, digit)
    );
    CREATE TABLE IF NOT EXISTS simulated_routes (
      call TEXT PRIMARY KEY REFERENCES calls(id), destination TEXT,
      menu_status TEXT NOT NULL, steps TEXT NOT NULL
    );
  `);
  function check(account, site) {
    if (!query('SELECT id FROM sites WHERE id=? AND account=?', site, account).length) fail('Unknown site.', 404);
  }
  function destinations(site) {
    return query('SELECT position, label, destination FROM site_routes WHERE site=? ORDER BY position', site);
  }
  return {
    snapshot(call, preview) {
      run('INSERT INTO simulated_routes VALUES (?, ?, ?, ?)', call,
        preview.next?.destination ?? null, preview.menuStatus, JSON.stringify(preview.steps));
    },
    menus(account) {
      return query(`SELECT m.site, m.prompt, o.digit, o.label, o.destination
        FROM site_menus m JOIN sites s ON s.id=m.site JOIN site_menu_options o ON o.site=m.site
        WHERE s.account=? ORDER BY m.site, o.digit`, account);
    },
    saveMenu(account, site, data) {
      check(account, site);
      const prompt = required(data.prompt, 'menu prompt');
      if (!Array.isArray(data.options) || !data.options.length || data.options.length > 10) {
        fail('Provide one to ten menu options.');
      }
      const digits = new Set();
      const options = data.options.map(option => {
        const digit = option?.digit;
        if (typeof digit !== 'string' || !/^[0-9]$/.test(digit) || digits.has(digit)) {
          fail('Use a distinct single digit for each option.');
        }
        digits.add(digit);
        return [digit, required(option.label, 'menu option label'), phone(option.destination)];
      });
      transaction(() => {
        run('INSERT INTO site_menus VALUES (?, ?) ON CONFLICT(site) DO UPDATE SET prompt=excluded.prompt', site, prompt);
        run('DELETE FROM site_menu_options WHERE site=?', site);
        for (const option of options) run('INSERT INTO site_menu_options VALUES (?, ?, ?, ?)', site, ...option);
      });
      return { site, prompt };
    },
    list(account) {
      return query(`SELECT r.* FROM site_routes r JOIN sites s ON s.id=r.site
        WHERE s.account=? ORDER BY r.site, r.position`, account);
    },
    save(account, site, routes) {
      check(account, site);
      if (!Array.isArray(routes) || routes.length > 10) fail('Provide up to ten fallback destinations.');
      const rows = routes.map((route, index) => {
        if (!route || typeof route !== 'object') fail('Invalid fallback destination.');
        return [index + 1, required(route.label, 'destination label'), phone(route.destination)];
      });
      if (new Set(rows.map(row => row[2])).size !== rows.length) fail('Fallback destinations must be unique.');
      transaction(() => {
        run('DELETE FROM site_routes WHERE site=?', site);
        for (const row of rows) run('INSERT INTO site_routes VALUES (?, ?, ?, ?)', site, ...row);
      });
      return destinations(site);
    },
    preview(account, site, failed, digit) {
      check(account, site);
      if (!Array.isArray(failed) || failed.length > 11) fail('Invalid failed destinations.');
      const attempted = new Set(failed.map(phone));
      const [renter] = query(`SELECT r.name AS label, r.destination FROM assignments a
        JOIN renters r ON r.id=a.renter WHERE a.site=? AND a.ended IS NULL`, site);
      const [menu] = query('SELECT prompt FROM site_menus WHERE site=?', site);
      let selected;
      if (digit !== undefined && digit !== '') {
        if (!menu || typeof digit !== 'string' || !/^[0-9]$/.test(digit)) fail('Invalid menu selection.');
        [selected] = query('SELECT label, destination FROM site_menu_options WHERE site=? AND digit=?', site, digit);
        if (!selected) return { steps: [], next: null, prompt: menu.prompt, menuStatus: 'invalid-digit' };
      }
      const routes = [selected, renter, ...destinations(site)].filter(Boolean);
      const seen = new Set();
      const steps = routes.filter(route => {
        if (seen.has(route.destination)) return false;
        seen.add(route.destination);
        return true;
      }).map(route => ({ label: route.label, destination: route.destination, attempted: attempted.has(route.destination) }));
      return { steps, next: steps.find(route => !route.attempted) ?? null, prompt: menu?.prompt ?? null,
        menuStatus: selected ? 'selected' : menu ? 'no-input' : 'disabled' };
    }
  };
}
