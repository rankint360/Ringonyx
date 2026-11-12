const params = new URLSearchParams(location.search);
const form = document.querySelector('#intake');
const status = document.querySelector('#intake-status');
const site = params.get('site');
const channel = params.get('channel') === 'chat' ? 'chat' : 'form';
document.querySelector('#intake-title').textContent = channel === 'chat' ? 'Leave a chat message' : 'Send an inquiry';
if (!site) {
  form.hidden = true;
  status.textContent = 'Open the inquiry link provided by the business.';
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const data = Object.fromEntries(new FormData(form));
    const response = await fetch('/api/intake/' + encodeURIComponent(site), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, channel, source: params.get('utm_source') || 'Direct', campaign: params.get('utm_campaign') })
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error);
    form.reset();
    status.textContent = 'Your message was received.';
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
