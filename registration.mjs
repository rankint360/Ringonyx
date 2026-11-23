import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
export function registration(db,{query,run,transaction,required,fail,now,deliveries}) {
  const attempts=new Map();
  return {
    request(data,address) {
      const clock=Date.now();
      let bucket=attempts.get(address);
      if (!bucket || bucket.until<clock) bucket={count:0,until:clock+60000};
      attempts.set(address,bucket);
      if (++bucket.count>5) fail('Too many requests. Try again in one minute.',429);
      const email=required(data.email,'email').toLowerCase();
      const name=required(data.name,'business name');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Enter a valid email.');
      if (typeof data.password!=='string'||data.password.length<14||data.password.length>256) fail('Use a password between 14 and 256 characters.');
      return transaction(()=>{
        if (query('SELECT id FROM users WHERE email=?',email).length) fail('This email is already registered. Sign in or request recovery.',409);
        const account=randomUUID(),user=randomUUID(),salt=randomBytes(16).toString('hex');
        run('INSERT INTO accounts VALUES (?,?)',account,name);
        run('INSERT INTO users VALUES (?,?,?,?,?,?)',user,account,email,'owner',salt,scryptSync(data.password,salt,64).toString('hex'));
        run("INSERT INTO platform_review VALUES (?,'pending')",account);
        run("INSERT INTO subscriptions VALUES (?,'free','active',NULL,0,?)",account,now());
        deliveries.enqueue(account,'email','registration:'+account,{type:'registration-pending',recipient:email,workspace:name});
        return {pending:true};
      });
    }
  };
}
