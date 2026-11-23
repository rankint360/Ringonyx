import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { delivery } from './delivery.mjs';
import { commerce } from './commerce.mjs';
function setup() {
  const db=new DatabaseSync(':memory:');
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES ('a'),('b')");
  const query=(sql,...args)=>db.prepare(sql).all(...args);
  const run=(sql,...args)=>db.prepare(sql).run(...args);
  const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
  const required=(value,label)=>{if(typeof value!=='string'||!value.trim()) fail('Invalid '+label);return value.trim();};
  const whole=(value,max)=>{if(!Number.isSafeInteger(value)||value<0||value>max) fail('Invalid amount');return value;};
  const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}};
  let date=new Date('2026-11-23T00:00:00Z');
  const now=()=>date.toISOString();
  return {db,helpers:{query,run,fail,required,whole,transaction,now},advance:()=>{date=new Date(date.valueOf()+7200000);}};
}
test('delivery vault redacts secrets and durable retries keep the same idempotency key',async()=>{
  const {db,helpers,advance}=setup();
  try {
    const seen=[];
    let success=false;
    const queue=delivery(db,helpers,{key:'a'.repeat(64),enabled:'true',hosts:'hooks.example.test',
      fetch:async(url,options)=>{seen.push(options.headers);return {status:success?200:503,ok:success};}});
    const owner={account:'a',role:'owner'};
    queue.write(owner,'connection',{provider:'webhook',endpoint:'https://hooks.example.test/events',enabled:true,secret:'private'});
    const encrypted=helpers.query('SELECT secret FROM integration_connections')[0].secret;
    assert.ok(!encrypted.includes('private'));
    const job=queue.enqueue('a','webhook','event-1',{id:1});
    assert.equal(queue.enqueue('a','webhook','event-1',{id:1}).id,job.id);
    assert.throws(()=>queue.enqueue('a','webhook','event-1',{id:2}));
    assert.equal(queue.read('b').jobs.length,0);
    assert.equal(queue.read('a').connections[0].secret,undefined);
    assert.equal((await queue.dispatch()).sent,0);
    assert.equal(queue.read('a').jobs[0].attempts,1);
    assert.equal((await queue.dispatch()).processed,0);
    advance();success=true;
    assert.equal((await queue.dispatch()).sent,1);
    assert.equal(seen[0]['Idempotency-Key'],seen[1]['Idempotency-Key']);
    assert.equal(queue.read('a').jobs[0].state,'delivered');
    assert.equal(queue.read('a').attempts.length,2);
    assert.throws(()=>queue.write({account:'a',role:'viewer'},'cancel',{id:job.id}));
  } finally {db.close();}
});
test('wallet settlement and reservations do not double-credit or overdraw',()=>{
  const {db,helpers}=setup();
  try {
    const shop=commerce(db,helpers);
    const owner={account:'a',role:'owner'};
    const deposit=shop.write(owner,'topup',{reference:'deposit',cents:1000});
    assert.equal(shop.balance('a').available,0);
    shop.settle('receipt',deposit.id);shop.settle('receipt',deposit.id);
    assert.equal(shop.balance('a').available,1000);
    shop.reserve('a','hold',600);shop.reserve('a','hold',600);
    assert.equal(shop.balance('a').available,400);
    assert.throws(()=>shop.recordUsage('a',{reference:'cost',kind:'voice',units:1,cents:500}));
    shop.release('a','hold');
    shop.recordUsage('a',{reference:'cost',kind:'voice',units:1,cents:500});
    shop.recordUsage('a',{reference:'cost',kind:'voice',units:1,cents:500});
    assert.equal(shop.balance('a').available,500);
    assert.throws(()=>shop.write(owner,'topup',{reference:'zero',cents:0}));
  } finally {db.close();}
});

test('password recovery does not reveal users and reset tokens are single-use', async()=>{
  const { recovery }=await import('./recovery.mjs');
  const {db,helpers}=setup();
  try {
    db.exec("CREATE TABLE users(id TEXT PRIMARY KEY,account TEXT,email TEXT,salt TEXT,hash TEXT); CREATE TABLE sessions(user TEXT)");
    helpers.run("INSERT INTO users VALUES ('u','a','user@example.test','old','old')");
    helpers.run("INSERT INTO sessions VALUES ('u')");
    const queued=[];
    const reset=recovery(db,{...helpers,deliveries:{enqueue:(_account,_provider,_reference,payload)=>queued.push(payload)}});
    assert.deepEqual(reset.request('missing@example.test','one'),{requested:true});
    assert.equal(queued.length,0);
    assert.deepEqual(reset.request('user@example.test','two'),{requested:true});
    const token=queued[0].token;
    assert.notEqual(helpers.query('SELECT token FROM password_resets')[0].token,token);
    reset.redeem({token,password:'new-password-long-enough'});
    assert.equal(helpers.query('SELECT * FROM sessions').length,0);
    assert.throws(()=>reset.redeem({token,password:'another-password-long'}));
  } finally {db.close();}
});

test('recording retention tombstones metadata and removes expired audio',async()=>{
  const { lifecycle }=await import('./lifecycle.mjs');
  const {db,helpers}=setup();
  let current='2026-01-01T00:00:00Z';
  try {
    db.exec("CREATE TABLE sites(id TEXT PRIMARY KEY,account TEXT); CREATE TABLE calls(id TEXT PRIMARY KEY,site TEXT); INSERT INTO sites VALUES ('s','a'); INSERT INTO calls VALUES ('c','s')");
    const life=lifecycle(db,{...helpers,now:()=>current,
      invoices:{list:()=>[]},exchange:{list:()=>({invoices:[]})},deliveries:{enqueue:()=>{}}});
    life.write({account:'a',role:'owner'},'retention',{days:30});
    const audio=life.upload('a','c','audio/wav',Buffer.from('RIFF'));
    assert.equal(life.recording('a',audio.id).bytes.length,4);
    current='2026-02-10T00:00:00Z';
    assert.equal(life.run('a').recordingsDeleted,1);
    assert.throws(()=>life.recording('a',audio.id));
    const tombstone=helpers.query('SELECT bytes,deleted FROM recordings')[0];
    assert.equal(tombstone.bytes,null);
    assert.ok(tombstone.deleted);
    assert.equal(life.run('a').recordingsDeleted,0);
  } finally {db.close();}
});
