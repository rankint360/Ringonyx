export function businessDay(value, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(value));
  const part = type => parts.find(item => item.type === type).value;
  return part('year') + '-' + part('month') + '-' + part('day');
}
export function inDateRange(value, days, timezone, now = new Date()) {
  if (!days) return true;
  const today = businessDay(now, timezone);
  const date = new Date(today + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() - (days === 2 ? 1 : days - 1));
  const start = date.toISOString().slice(0,10);
  const day = businessDay(value, timezone);
  return day >= start && (days === 2 ? day < today : day <= today) && new Date(value) <= now;
}
