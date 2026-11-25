import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hostRouting} from './host-routing.mjs';

test('public hosts redirect customer pages and reject customer APIs',()=>{
  const route=hostRouting({enabled:true,customerPages:new Set(['/overview','/app','/reset','/register','/workspace-tools'])});
  for (const host of ['ringonyx.com','www.ringonyx.com','RINGONYX.COM:443']) {
    assert.deepEqual(route(host,'GET','/overview?tab=calls'),{status:302,location:'https://app.ringonyx.com/overview?tab=calls'});
    assert.deepEqual(route(host,'POST','/api/login'),{status:404});
    assert.deepEqual(route(host,'GET','/api/session'),{status:404});
    assert.deepEqual(route(host,'GET','/api/recordings/example'),{status:404});
    assert.deepEqual(route(host,'POST','/overview'),{status:404});
  }
  assert.equal(route('ringonyx.com','GET','/'),null);
  assert.deepEqual(route('www.ringonyx.com','GET','/?campaign=demo'),{status:308,location:'https://ringonyx.com/?campaign=demo'});
  assert.deepEqual(route('ringonyx.com','GET','/reset?next=https://evil.test'),{status:302,location:'https://app.ringonyx.com/reset?next=https://evil.test'});
  for (const path of ['/health','/tracking/site','/webhooks/twilio/voice','/webhooks/ringonyx/events','/api/intake/site','/api/publisher/ping','/api/v1/sites']) assert.equal(route('ringonyx.com','POST',path),null);
  assert.deepEqual(route('app.ringonyx.com','GET','/'),{status:302,location:'https://app.ringonyx.com/overview'});
  assert.equal(route('app.ringonyx.com','POST','/api/login'),null);
  assert.equal(route('admin.ringonyx.com','GET','/admin'),null);
  assert.equal(route('ringonyx.onrender.com','GET','/health'),null);
});

test('local development remains unchanged and redirect hosts are validated',()=>{
  const pages=new Set(['/overview']);
  assert.equal(hostRouting({enabled:false,customerPages:pages})('ringonyx.com','GET','/overview'),null);
  assert.throws(()=>hostRouting({enabled:true,publicHost:'https://evil.test',customerPages:pages}));
  assert.throws(()=>hostRouting({enabled:true,appHost:'ringonyx.com',customerPages:pages}));
});
