import assert from 'node:assert/strict';
import test from 'node:test';
import { checkBridgeHealth } from '../app/lib/bridge-health.ts';
import { buildBridgeWorkflowRequest } from '../app/lib/bridge-workflow-request.ts';

test('web BFF bridge health translates native /health success', async () => {
  let requestedUrl = '';
  let authorization = '';
  const result = await checkBridgeHealth(
    { url: 'http://127.0.0.1:4300/', token: 'test-token' },
    async (input, init) => {
      requestedUrl = String(input);
      authorization = new Headers(init?.headers).get('Authorization') ?? '';
      return Response.json({ ok: true, service: 'codex-bridge', api: 'v1', queue: { queued: 0 } });
    },
  );

  assert.equal(requestedUrl, 'http://127.0.0.1:4300/health');
  assert.equal(authorization, 'Bearer test-token');
  assert.deepEqual(result, {
    configured: true,
    connected: true,
    code: 'BRIDGE_READY',
    health: { ok: true, service: 'codex-bridge', api: 'v1', queue: { queued: 0 } },
  });
});

test('web BFF bridge health treats unavailable and malformed upstream as offline', async () => {
  const unavailable = await checkBridgeHealth(
    { url: 'http://127.0.0.1:4300', token: 'test-token' },
    async () => { throw new Error('connection refused'); },
  );
  const malformed = await checkBridgeHealth(
    { url: 'http://127.0.0.1:4300', token: 'test-token' },
    async () => new Response('{not-json', { status: 200 }),
  );
  const wrongContract = await checkBridgeHealth(
    { url: 'http://127.0.0.1:4300', token: 'test-token' },
    async () => Response.json({ ok: true, service: 'queue-only' }),
  );

  assert.equal(unavailable.code, 'BRIDGE_UNREACHABLE');
  assert.equal(unavailable.connected, false);
  assert.equal(malformed.code, 'BRIDGE_INVALID_RESPONSE');
  assert.equal(wrongContract.code, 'BRIDGE_INVALID_RESPONSE');
});

test('web BFF preserves noExternalWrite when forwarding workflow submission', () => {
  assert.deepEqual(buildBridgeWorkflowRequest({
    task: 'safe smoke', mode: 'write', allowedUserId: '42', noExternalWrite: true,
  }), {
    task: 'safe smoke', mode: 'write', noExternalWrite: true, userId: '42', chatId: '42',
  });
  assert.throws(
    () => buildBridgeWorkflowRequest({
      task: 'ambiguous', mode: 'write', allowedUserId: '42', noExternalWrite: 'false',
    }),
    /noExternalWrite must be a boolean/,
  );
});
