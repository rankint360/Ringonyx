import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { security, totp } from './security.mjs';

test('authenticator follows RFC vector and rejects replay with single-use recovery', () => {
  // RFC 6238 SHA1 key "12345678901234567890" encoded as base32.
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(totp(secret, 1, 8), '94287082');
  const db = new DatabaseSync(':memory:');
  try {
    db.exec("CREATE TABLE users(id TEXT PRIMARY KEY); CREATE TABLE sessions(user TEXT); INSERT INTO users VALUES ('test')");
    const factors = security(db);
    const setup = factors.setup({ id: 'test', email: 'test@example.com' }, message => { throw Error(message); });
    const code = totp(setup.secret, Math.floor(Date.now() / 30000));
    const { recovery } = factors.enable('test', code, message => { throw Error(message); });
    assert.equal(factors.enabled('test'), true);
    assert.equal(factors.verify('test', code), false);
    assert.equal(factors.verify('test', recovery), true);
    assert.equal(factors.verify('test', recovery), false);
  } finally { db.close(); }
});
