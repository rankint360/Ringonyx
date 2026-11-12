import { createInterface } from 'node:readline';

const token = process.env.RINGONYX_DEVELOPER_TOKEN;
const origin = new URL(process.env.RINGONYX_API_ORIGIN || 'http://127.0.0.1:3000');
if (!token || !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) {
  console.error('Set a developer token and a loopback Ringonyx origin.');
  process.exit(1);
}
async function resource(name) {
  const response = await fetch(new URL('/api/v1/' + name, origin), {
    headers: { Authorization: 'Bearer ' + token }, redirect: 'error', signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw Error('Ringonyx API returned ' + response.status + '.');
  return response.json();
}
const uri = name => 'ringonyx://workspace/' + name;
const send = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  let request;
  try { request = JSON.parse(line); } catch {
    send({ id: null, error: { code: -32700, message: 'Invalid JSON' } });
    continue;
  }
  if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    send({ id: request?.id ?? null, error: { code: -32600, message: 'Invalid request' } });
    continue;
  }
  if (request.id === undefined) continue;
  const { id, method, params } = request;
  try {
    let result;
    if (method === 'initialize') result = { protocolVersion: '2025-11-25', capabilities: { resources: {} },
      serverInfo: { name: 'ringonyx-local', version: '1.0.0' } };
    else if (method === 'ping') result = {};
    else if (method === 'resources/list') {
      const scopes = await resource('scopes');
      result = { resources: scopes.resources.map(name => ({ uri: uri(name), name, mimeType: 'application/json' })) };
    } else if (method === 'resources/read') {
      const name = ['sites','campaigns'].find(value => uri(value) === params?.uri);
      if (!name) throw Error('Unknown Ringonyx resource.');
      result = { contents: [{ uri: uri(name), mimeType: 'application/json', text: JSON.stringify(await resource(name)) }] };
    } else {
      send({ id, error: { code: -32601, message: 'Method not found' } });
      continue;
    }
    send({ id, result });
  } catch (error) {
    send({ id, error: { code: -32000, message: error.message } });
  }
}
