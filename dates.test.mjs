import { test } from 'node:test';
import assert from 'node:assert/strict';
import { businessDay, inDateRange } from './public/dates.js';
test('report periods respect the saved time zone across midnight and daylight saving', () => {
  const now = new Date('2026-11-02T06:30:00Z');
  assert.equal(businessDay(now, 'America/Los_Angeles'), '2026-11-01');
  assert.equal(inDateRange('2026-11-01T07:30:00Z',1,'America/Los_Angeles',now), true);
  assert.equal(inDateRange('2026-11-01T06:30:00Z',1,'America/Los_Angeles',now), false);
  assert.equal(inDateRange('2026-11-01T06:30:00Z',2,'America/Los_Angeles',now), true);
  assert.equal(inDateRange('2026-11-01T07:30:00Z',2,'America/Los_Angeles',now), false);
});
