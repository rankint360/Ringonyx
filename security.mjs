import { createHmac, timingSafeEqual, randomBytes, createHash } from 'node:crypto';
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function totp(secret, counter, digits = 6) {
  const bits = [...secret].map(char => alphabet.indexOf(char).toString(2).padStart(5, '0')).join('');
  const key = Buffer.from(bits.match(/.{8}/g).map(byte => parseInt(byte, 2)));
  const time = Buffer.alloc(8);
  time.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', key).update(time).digest();
  const offset = mac.at(-1) & 15;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits).padStart(digits, '0');
}
export function security(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS user_totp (
    user TEXT PRIMARY KEY REFERENCES users(id), secret TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
    last_counter INTEGER NOT NULL DEFAULT -1, expires INTEGER NOT NULL, recovery TEXT
  )`);
  const hash = value => createHash('sha256').update(value).digest('hex');
  return {
    enabled(user) { return Boolean(db.prepare('SELECT enabled FROM user_totp WHERE user=?').get(user)?.enabled); },
    setup(user, fail) {
      if (this.enabled(user.id)) fail('Authenticator already enabled.', 409);
      const secret = [...randomBytes(32)].map(byte => alphabet[byte & 31]).join('');
      db.prepare(`INSERT INTO user_totp (user,secret,expires) VALUES (?,?,?)
        ON CONFLICT(user) DO UPDATE SET secret=excluded.secret,expires=excluded.expires`).run(user.id, secret, Date.now() + 600000);
      return { secret, uri: 'otpauth://totp/Ringonyx:' + encodeURIComponent(user.email) + '?secret=' + secret + '&issuer=Ringonyx' };
    },
    verify(user, value, enrolling = false) {
      const row = db.prepare('SELECT * FROM user_totp WHERE user=?').get(user);
      if (!row || (!row.enabled && (!enrolling || row.expires < Date.now()))) return false;
      if (typeof value !== 'string') return false;
      if (row.enabled && row.recovery && timingSafeEqual(Buffer.from(hash(value)), Buffer.from(row.recovery))) {
        db.prepare('UPDATE user_totp SET recovery=NULL WHERE user=?').run(user);
        return true;
      }
      if (!/^\d{6}$/.test(value)) return false;
      const counter = Math.floor(Date.now() / 30000);
      for (const step of [counter - 1, counter, counter + 1]) {
        if (step > row.last_counter && timingSafeEqual(Buffer.from(totp(row.secret, step)), Buffer.from(value))) {
          db.prepare('UPDATE user_totp SET last_counter=? WHERE user=?').run(step, user);
          return true;
        }
      }
      return false;
    },
    enable(user, code, fail) {
      if (this.enabled(user) || !this.verify(user, code, true)) fail('Invalid authenticator code.', 403);
      const recovery = randomBytes(20).toString('hex');
      db.prepare('UPDATE user_totp SET enabled=1,recovery=? WHERE user=?').run(hash(recovery), user);
      db.prepare('DELETE FROM sessions WHERE user=?').run(user);
      return { recovery, signedOut: false };
    },
    disable(user, code, fail) {
      if (!this.verify(user, code)) fail('Invalid authenticator code.', 403);
      db.prepare('DELETE FROM user_totp WHERE user=?').run(user);
      db.prepare('DELETE FROM sessions WHERE user=?').run(user);
      return { signedOut: true };
    }
  };
}
