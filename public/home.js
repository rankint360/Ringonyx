const scenarios = {
  qualified: ['Valley Plumbing', 'Current renter', '112 seconds · 90 second minimum', 'Qualified', '$45.00'],
  short: ['Valley Plumbing', 'Current renter', '38 seconds · 90 second minimum', 'Below minimum', '$0.00'],
  handoff: ['Desert Pipe Co.', 'New renter', '102 seconds · 90 second minimum', 'Qualified', '$60.00']
};
const controls = [...document.querySelectorAll('[data-mode]')];
const stages = [...document.querySelectorAll('.trace li')];
const fields = ['destination', 'routing', 'duration', 'outcome', 'amount'].map(id => document.getElementById(id));
const status = document.getElementById('demo-status');
let mode = 'qualified';
let timers = [];
function show(next) {
  mode = next;
  timers.forEach(clearTimeout);
  timers = [];
  controls.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
  fields.forEach((field, index) => { field.textContent = scenarios[mode][index]; });
  stages.forEach(stage => stage.classList.remove('waiting'));
  status.textContent = scenarios[mode][3] + '. Charge ' + scenarios[mode][4];
}
controls.forEach(button => button.addEventListener('click', () => show(button.dataset.mode)));
document.getElementById('replay').addEventListener('click', () => {
  show(mode);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  stages.forEach(stage => stage.classList.add('waiting'));
  fields[4].textContent = '—';
  status.textContent = 'Replaying sample call';
  stages.forEach((stage, index) => {
    timers.push(setTimeout(() => {
      stage.classList.remove('waiting');
      if (index === stages.length - 1) show(mode);
    }, 250 * (index + 1)));
  });
});

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const panels = [...document.querySelectorAll('[data-motion]')];
function playPanel(panel) {
  if (reducedMotion.matches) return;
  panel.classList.remove('playing');
  void panel.offsetWidth;
  panel.classList.add('playing');
}
for (const panel of panels) {
  panel.querySelector('[data-replay]').addEventListener('click', () => playPanel(panel));
}
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      playPanel(entry.target);
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.45 });
  panels.forEach(panel => observer.observe(panel));
}
const sliders = ['volume', 'duration-range', 'number-range'].map(id => document.getElementById(id));
const outputs = ['volume-value', 'duration-value', 'number-value', 'minutes-total', 'numbers-total'].map(id => document.getElementById(id));
const format = new Intl.NumberFormat('en-US');
function updateEstimate() {
  const [calls, minutes, numbers] = sliders.map(slider => slider.valueAsNumber);
  [calls, minutes, numbers, calls * minutes, numbers].forEach((value, index) => {
    outputs[index].textContent = format.format(value);
  });
}
sliders.forEach(slider => slider.addEventListener('input', updateEstimate));
updateEstimate();

const bindSelect = (id, change) => {
  const field = document.getElementById(id);
  field.addEventListener('change', () => change(field.value));
};
const setText = (id, text) => { document.getElementById(id).textContent = text; };
bindSelect('route-zip', zip => {
  const destination = { '85004': 'Valley Plumbing', '85251': 'Desert Pipe Co.', '85701': 'Copper State Plumbing (fallback)' }[zip];
  const panel = document.querySelector('#ring-trees [data-motion]');
  for (const lane of panel.querySelectorAll('[data-route]')) lane.classList.toggle('chosen', lane.dataset.route === zip);
  setText('zip-result', zip + ' routes to ' + destination + '.');
  playPanel(panel);
});
bindSelect('bid-floor', floor => {
  const panel = document.querySelector('#bidding [data-motion]');
  const winner = Number(floor) <= 57;
  panel.querySelector('.bid-board > div:nth-child(2)').classList.toggle('bid-winner', winner);
  setText('auction-result', winner ? 'Copper State wins at $57.' : 'No bid clears the floor. Use fallback routing.');
  playPanel(panel);
});
bindSelect('rank-mode', mode => {
  const panel = document.querySelector('#predictive [data-motion]');
  const chart = panel.querySelector('.rank-chart');
  const rows = [...chart.children];
  const expectedRevenue = mode === 'yield';
  for (const row of rows) {
    const copper = row.firstElementChild.textContent === 'Copper State';
    const value = expectedRevenue ? (copper ? 44 : 30) : (copper ? 55 : 75);
    row.lastElementChild.textContent = '$' + value;
    row.querySelector('i').style.setProperty('--size', (value / 75 * 100) + '%');
  }
  rows.sort((a, b) => Number(b.lastElementChild.textContent.slice(1)) - Number(a.lastElementChild.textContent.slice(1)));
  chart.append(...rows);
  setText('rank-result', expectedRevenue ? 'Copper State leads at $44 expected revenue.' : 'Valley Plumbing leads at $75 per qualified call.');
  playPanel(panel);
});
bindSelect('area-code', area => setText('number-result', 'Sample number +1 ' + area + ' 555 0100'));

let digits = '';
for (const key of document.querySelectorAll('[data-digit]')) {
  key.addEventListener('click', () => {
    if (digits.length === 15) return;
    digits += key.dataset.digit;
    setText('dial-display', digits);
    setText('dial-result', '');
  });
}
document.getElementById('dial-clear').addEventListener('click', () => {
  digits = '';
  setText('dial-display', 'Enter a number');
  setText('dial-result', '');
});
document.getElementById('dial-preview').addEventListener('click', () => {
  setText('dial-result', /^\d{10,15}$/.test(digits) ? 'Sample callback to ' + digits + '. No call placed.' : 'Enter a phone number with 10 to 15 digits.');
});
const media = document.getElementById('recording-cost');
const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
function updateCost() {
  const minutes = sliders[0].valueAsNumber * sliders[1].valueAsNumber;
  const minuteCost = minutes * 3;
  const numberCost = sliders[2].valueAsNumber * 100;
  const mediaCost = media.checked ? minutes * 2 : 0;
  const amounts = { 'minute-cost': minuteCost, 'number-cost': numberCost, 'media-cost': mediaCost, 'total-cost': minuteCost + numberCost + mediaCost };
  for (const [id, cents] of Object.entries(amounts)) setText(id, currency.format(cents / 100));
}
[...sliders, media].forEach(control => control.addEventListener('input', updateCost));
updateCost();
for (const control of document.querySelectorAll('[data-column]')) {
  control.addEventListener('change', () => {
    for (const cell of document.querySelectorAll('#compare tr > :nth-child(' + control.dataset.column + ')')) {
      cell.hidden = !control.checked;
    }
  });
}
