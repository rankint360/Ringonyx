(async () => {
  const script = document.currentScript;
  const site = script.dataset.site;
  const links = [...document.querySelectorAll('a[data-ringonyx-number]')];
  if (!site || !links.length) return;
  const key = 'ringonyx-visitor:' + site;
  let visitor;
  try { visitor = sessionStorage.getItem(key); } catch { /* Storage can be unavailable. */ }
  const params = new URLSearchParams(location.search);
  try {
    const endpoint = new URL('/tracking/' + encodeURIComponent(site), script.src);
    const response = await fetch(endpoint, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ visitor, source: params.get('utm_source'), campaign: params.get('utm_campaign') })
    });
    if (!response.ok) return;
    const assignment = await response.json();
    if (!/^\+[1-9]\d{7,14}$/.test(assignment.number)) return;
    try { sessionStorage.setItem(key, assignment.visitor); } catch { /* The link still works. */ }
    for (const link of links) {
      link.href = 'tel:' + assignment.number;
      if (link.dataset.ringonyxNumber !== 'link-only') link.textContent = assignment.number;
    }
    if (assignment.expires) {
      setTimeout(() => {
        for (const link of links) {
          link.href = 'tel:' + assignment.fallback;
          if (link.dataset.ringonyxNumber !== 'link-only') link.textContent = assignment.fallback;
        }
      }, Math.max(0, assignment.expires - Date.now()));
    }
  } catch { /* Keep the page's original phone link if tracking is unavailable. */ }
})();
