import { randomBytes, createHash, scryptSync } from 'node:crypto';
const digest = value => createHash('sha256').update(value).digest('hex');
export function recovery(db,{query,run,transaction,required,fail,now,deliveries}) {
  db.exec(`CREATE TABLE IF NOT EXISTS password_resets (
    token TEXT PRIMARY KEY,user TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL
  )`);
  const attempts=new Map();
  return {
    request(email,address) {
      const time=Date.now(), prior=attempts.get(address);
      const bucket=!prior || prior.until<time ? {count:0,until:time+60000}:prior;
      attempts.set(address,bucket);
      if (++bucket.count>5) fail('Too many reset requests. Try again in one minute.',429);
      const normalized=typeof email==='string' ? email.trim().toLowerCase():'';
      const [user]=query('SELECT id,account,email FROM users WHERE email=?',normalized);
      if (user) transaction(()=>{
        run('DELETE FROM password_resets WHERE user=? OR expires<?',user.id,time);
        const token=randomBytes(32).toString('hex');
        run('INSERT INTO password_resets VALUES (?,?,?)',digest(token),user.id,time+1800000);
        const origin=process.env.RINGONYX_APP_ORIGIN;
        // The delivery worker remains disabled until the configured email endpoint can build a trusted link.
        deliveries.enqueue(user.account,'email','reset:'+digest(token),{
          type:'password-reset',recipient:user.email,token,origin:origin||null,expires:time+1800000
        });
      });
      return {requested:true};
    },
    redeem(data) {
      const token=required(data.token,'reset token');
      if (typeof data.password!=='string'||data.password.length<14||data.password.length>256) fail('Use a password between 14 and 256 characters.');
      return transaction(()=>{
        const [reset]=query('SELECT user FROM password_resets WHERE token=? AND expires>?',digest(token),Date.now());
        if (!reset) fail('Invalid or expired reset token.',404);
        const salt=randomBytes(16).toString('hex');
        run('UPDATE users SET salt=?,hash=? WHERE id=?',salt,scryptSync(data.password,salt,64).toString('hex'),reset.user);
        run('DELETE FROM sessions WHERE user=?',reset.user);
        run('DELETE FROM password_resets WHERE user=?',reset.user);
        return {saved:true};
      });
    }
  };
}
