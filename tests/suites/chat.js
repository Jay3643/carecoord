/**
 * Chat API Tests
 * Tests channel creation, messaging, membership, and cleanup.
 */
const { TestClient, test, assert, assertEqual, assertOk, loginAs } = require('../setup');

module.exports = async function chatSuite(port) {
  const results = [];
  let channelId = null;

  // ── Create Channel ──

  results.push(await test('Create direct message channel', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.post('/api/chat/channels', {
      type: 'direct',
      memberIds: ['u-test-coord'],
    });
    assertOk(res);
    assert(res.data.channelId, 'should return channelId');
    channelId = res.data.channelId;
  }));

  results.push(await test('Creating same DM channel returns existing', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.post('/api/chat/channels', {
      type: 'direct',
      memberIds: ['u-test-coord'],
    });
    assertOk(res);
    assertEqual(res.data.channelId, channelId, 'should return same channel');
    assertEqual(res.data.existing, true, 'should flag as existing');
  }));

  results.push(await test('Create group channel', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.post('/api/chat/channels', {
      name: 'Test Group',
      type: 'group',
      memberIds: ['u-test-coord', 'u-test-super'],
    });
    assertOk(res);
    assert(res.data.channelId, 'should return channelId');
  }));

  // ── List Channels ──

  results.push(await test('List channels for authenticated user', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.get('/api/chat/channels');
    assertOk(res);
    assert(Array.isArray(res.data.channels), 'channels should be array');
    assert(res.data.channels.length >= 1, 'should have at least 1 channel');
    for (const ch of res.data.channels) {
      assert(ch.id, 'channel should have id');
      assert(ch.members, 'channel should have members');
    }
  }));

  results.push(await test('List channels requires auth', async () => {
    const client = new TestClient(port);
    const res = await client.get('/api/chat/channels');
    assertEqual(res.status, 401, 'status');
  }));

  // ── Send Message ──

  results.push(await test('Send message to channel', async () => {
    assert(channelId, 'channelId should exist');
    const client = await loginAs(port, 'admin');
    const res = await client.post('/api/chat/channels/' + channelId + '/messages', {
      body: 'Hello from test bot!',
    });
    assertOk(res);
    assert(res.data.id, 'message should have id');
    assertEqual(res.data.body, 'Hello from test bot!', 'body');
    assert(res.data.senderName, 'should have senderName');
  }));

  results.push(await test('Send message requires body', async () => {
    assert(channelId, 'channelId should exist');
    const client = await loginAs(port, 'admin');
    const res = await client.post('/api/chat/channels/' + channelId + '/messages', {});
    assertEqual(res.status, 400, 'status');
  }));

  results.push(await test('Non-member cannot send message', async () => {
    assert(channelId, 'channelId should exist');
    const client = await loginAs(port, 'supervisor');
    const res = await client.post('/api/chat/channels/' + channelId + '/messages', {
      body: 'Sneaky message',
    });
    assertEqual(res.status, 403, 'status');
  }));

  // ── Get Messages ──

  results.push(await test('Get channel messages', async () => {
    assert(channelId, 'channelId should exist');
    const client = await loginAs(port, 'admin');
    const res = await client.get('/api/chat/channels/' + channelId + '/messages');
    assertOk(res);
    assert(Array.isArray(res.data.messages), 'messages should be array');
    assert(res.data.messages.length >= 1, 'should have at least 1 message');
  }));

  results.push(await test('Non-member cannot read messages', async () => {
    assert(channelId, 'channelId should exist');
    const client = await loginAs(port, 'supervisor');
    const res = await client.get('/api/chat/channels/' + channelId + '/messages');
    assertEqual(res.status, 403, 'status');
  }));

  // ── Mark as Read ──

  results.push(await test('Mark channel as read', async () => {
    assert(channelId, 'channelId should exist');
    const client = await loginAs(port, 'admin');
    const res = await client.post('/api/chat/channels/' + channelId + '/read');
    assertOk(res);
    assert(res.data.ok, 'should return ok');
  }));

  // ── Unread Count ──

  results.push(await test('Get total unread count', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.get('/api/chat/unread');
    assertOk(res);
    assert(typeof res.data.unread === 'number', 'unread should be number');
  }));

  // ── Ticket Channel ──

  results.push(await test('Create ticket discussion channel', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.post('/api/chat/ticket-channel', { ticketId: 'TRA-0001' });
    assertOk(res);
    assert(res.data.channelId, 'should return channelId');
  }));

  results.push(await test('Ticket channel requires ticketId', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.post('/api/chat/ticket-channel', {});
    assertEqual(res.status, 400, 'status');
  }));

  // ── Delete / Leave Channel ──

  results.push(await test('User can leave a channel', async () => {
    assert(channelId, 'channelId should exist');
    const client = await loginAs(port, 'admin');
    const res = await client.del('/api/chat/channels/' + channelId);
    assertOk(res);
    assert(res.data.ok, 'should return ok');
  }));

  return results;
};
