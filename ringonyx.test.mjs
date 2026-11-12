import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('qualified charges and history survive a renter handoff', async t => {
  const child = spawn(process.execPath, ['server.mjs'], {
    env: { ...process.env, PORT: '0', RINGONYX_DB: ':memory:', RINGONYX_OPERATOR_KEY: 'test-key' }
  });
  t.after(() => child.kill());
  const [message] = await once(child.stdout, 'data', { signal: AbortSignal.timeout(5000) });
  const origin = message.toString().trim().split(' ').at(-1);
  async function api(path, data, code = data ? 201 : 200, auth = true) {
    const response = await fetch(origin + '/api/' + path, {
      method: data ? 'POST' : 'GET',
      headers: auth ? { 'X-Ringonyx-Operator': 'test-key' } : {},
      body: data && JSON.stringify(data)
    });
    const result = await response.json();
    assert.equal(response.status, code, JSON.stringify(result));
    return result;
  }
  assert.equal((await fetch(origin)).status, 200);
  await api('sites', undefined, 401, false);
  const number = '+16025550100';
  const site = await api('sites', { name: 'Phoenix plumbing', number });
  const first = await api('renters', { name: 'First', destination: '+16025550101' });
  const second = await api('renters', { name: 'Second', destination: '+16025550102' });
  await api('assignments', { site: site.id, renter: first.id, rate: 4500, minimum: 90 });
  const arrive = () => api('calls', { number, source: 'Google Ads' });
  const call = await arrive();
  assert.equal(call.destination, '+16025550101');
  await api('assignments', { site: site.id, renter: second.id, rate: 6000, minimum: 60 });
  const finish = (id, duration, outcome) => api('calls/' + id + '/complete', { duration, outcome }, 200);
  assert.equal((await finish(call.id, 90, 'answered')).cents, 4500);
  assert.equal((await finish(call.id, 90, 'answered')).cents, 4500);
  const short = await arrive();
  assert.equal(short.destination, '+16025550102');
  assert.equal((await finish(short.id, 59, 'answered')).cents, 0);
  assert.equal((await finish((await arrive()).id, 90, 'missed')).cents, 0);
  const renters = await api('renters');
  const portal = renter => api('portal/' + renter.portal, undefined, 200, false);
  assert.deepEqual((await portal(renters[0])).calls.map(row => row.id), [call.id]);
  assert.equal((await portal(renters[1])).calls.length, 2);
  assert.equal((await api('calls')).reduce((total, row) => total + row.cents, 0), 4500);
});
