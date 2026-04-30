/**
 * Tickets API Tests
 * Tests CRUD, assignment, replies, notes, tags, status, and region transfer.
 */
const { test, assert, assertEqual, assertOk, loginAs } = require('../setup');

module.exports = async function ticketsSuite(port) {
  const results = [];

  // ── List Tickets ──

  results.push(await test('List tickets returns regional tickets', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.get('/api/tickets');
    assertOk(res, 'list tickets');
    assert(Array.isArray(res.data.tickets), 'tickets should be array');
    assert(res.data.tickets.length >= 1, 'should have at least 1 ticket');
  }));

  results.push(await test('List tickets requires auth', async () => {
    const { TestClient } = require('../setup');
    const client = new TestClient(port);
    const res = await client.get('/api/tickets');
    assertEqual(res.status, 401, 'status');
  }));

  results.push(await test('Filter tickets by status=open', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.get('/api/tickets?status=open');
    assertOk(res);
    for (const t of res.data.tickets) {
      assertEqual(t.status, 'OPEN', 'ticket status');
    }
  }));

  results.push(await test('Search tickets by subject', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.get('/api/tickets?search=Alpha');
    assertOk(res);
    assert(res.data.tickets.length >= 1, 'should find Alpha ticket');
    assert(res.data.tickets.some(t => t.subject.includes('Alpha')), 'should match subject');
  }));

  // ── Get Single Ticket ──

  results.push(await test('Get ticket by ID returns detail', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.get('/api/tickets/TRA-0001');
    assertOk(res);
    assert(res.data.ticket, 'should have ticket');
    assertEqual(res.data.ticket.id, 'TRA-0001', 'ticket id');
    assertEqual(res.data.ticket.subject, 'Test Ticket Alpha', 'subject');
    assert(res.data.ticket.tags, 'should have tags');
    assert(res.data.ticket.region, 'should have region');
  }));

  results.push(await test('Get non-existent ticket returns 404', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.get('/api/tickets/FAKE-9999');
    assertEqual(res.status, 404, 'status');
  }));

  // ── Get Messages ──

  results.push(await test('Get ticket messages returns threaded messages', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.get('/api/tickets/TRA-0001/messages');
    assertOk(res);
    assert(Array.isArray(res.data.messages), 'messages should be array');
    assert(res.data.messages.length >= 2, 'should have at least 2 messages');
    // Check ordering (oldest first)
    assert(res.data.messages[0].sent_at <= res.data.messages[1].sent_at, 'should be chronological');
  }));

  // ── Get Notes ──

  results.push(await test('Get ticket notes', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.get('/api/tickets/TRA-0001/notes');
    assertOk(res);
    assert(Array.isArray(res.data.notes), 'notes should be array');
    assert(res.data.notes.length >= 1, 'should have at least 1 note');
  }));

  // ── Create Ticket ──

  results.push(await test('Create new outbound ticket', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.post('/api/tickets', {
      toEmail: 'newpatient@example.com',
      subject: 'New Test Ticket',
      body: 'This is a test ticket body',
      regionId: 'r-test-1',
    });
    assertOk(res);
    assert(res.data.ticket, 'should have ticket');
    assert(res.data.ticket.id, 'should have ticket ID');
    assertEqual(res.data.ticket.subject, 'New Test Ticket', 'subject');
    assertEqual(res.data.ticket.status, 'WAITING_ON_EXTERNAL', 'new tickets start as WAITING');
  }));

  results.push(await test('Create ticket requires all fields', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.post('/api/tickets', { subject: 'Missing fields' });
    assertEqual(res.status, 400, 'status');
  }));

  // ── Assign Ticket ──

  results.push(await test('Assign ticket to a user', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.post('/api/tickets/TRB-0001/assign', { userId: 'u-test-super' });
    assertOk(res);
    assert(res.data.ticket, 'should return updated ticket');
    assertEqual(res.data.ticket.assignee_user_id, 'u-test-super', 'assignee');
  }));

  results.push(await test('Unassign ticket (return to queue)', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.post('/api/tickets/TRB-0001/assign', { userId: null });
    assertOk(res);
    assert(!res.data.ticket.assignee_user_id || res.data.ticket.assignee_user_id === 'null', 'should be unassigned');
  }));

  results.push(await test('Coordinator can only self-assign', async () => {
    const client = await loginAs(port, 'coordinator');
    const res = await client.post('/api/tickets/TRA-0001/assign', { userId: 'u-test-super' });
    assertEqual(res.status, 403, 'should be forbidden');
  }));

  // ── Change Status ──

  results.push(await test('Change ticket status to WAITING_ON_EXTERNAL', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.post('/api/tickets/TRA-0001/status', { status: 'WAITING_ON_EXTERNAL' });
    assertOk(res);
    assertEqual(res.data.ticket.status, 'WAITING_ON_EXTERNAL', 'status');
  }));

  results.push(await test('Close ticket with reason', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.post('/api/tickets/TRA-0001/status', { status: 'CLOSED', closeReasonId: 'cr-test-1' });
    assertOk(res);
    assertEqual(res.data.ticket.status, 'CLOSED', 'status');
  }));

  results.push(await test('Reopen closed ticket (admin/supervisor)', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.post('/api/tickets/TRA-0001/status', { status: 'OPEN' });
    assertOk(res);
    assertEqual(res.data.ticket.status, 'OPEN', 'status');
  }));

  results.push(await test('Invalid status returns 400', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.post('/api/tickets/TRA-0001/status', { status: 'INVALID' });
    assertEqual(res.status, 400, 'status');
  }));

  // ── Reply ──

  results.push(await test('Reply to ticket', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.post('/api/tickets/TRA-0001/reply', { body: 'This is a test reply' });
    assertOk(res);
    assert(res.data.message, 'should return message');
    assertEqual(res.data.message.direction, 'outbound', 'direction');
  }));

  results.push(await test('Reply requires body', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.post('/api/tickets/TRA-0001/reply', { body: '' });
    assertEqual(res.status, 400, 'status');
  }));

  // ── Notes ──

  results.push(await test('Add internal note to ticket', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.post('/api/tickets/TRA-0001/notes', { body: 'Internal note from test' });
    assertOk(res);
    assert(res.data.note, 'should return note');
    assert(res.data.note.id, 'note should have id');
  }));

  results.push(await test('Add note requires body', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.post('/api/tickets/TRA-0001/notes', { body: '' });
    assertEqual(res.status, 400, 'status');
  }));

  // ── Tags ──

  results.push(await test('Add tag to ticket', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.post('/api/tickets/TRA-0001/tags', { tagId: 't-test-2' });
    assertOk(res);
    const tagIds = res.data.ticket.tagIds || res.data.ticket.tags?.map(t => t.id) || [];
    assert(tagIds.includes('t-test-2'), 'should have new tag');
  }));

  results.push(await test('Remove tag from ticket', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.del('/api/tickets/TRA-0001/tags/t-test-2');
    assertOk(res);
    const tagIds = res.data.ticket.tagIds || res.data.ticket.tags?.map(t => t.id) || [];
    assert(!tagIds.includes('t-test-2'), 'tag should be removed');
  }));

  // ── Region Transfer ──

  results.push(await test('Transfer ticket to different region', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.post('/api/tickets/TRA-0001/region', { regionId: 'r-test-2' });
    assertOk(res);
    assertEqual(res.data.ticket.region_id, 'r-test-2', 'new region');
    // Should unassign on transfer
    assert(!res.data.ticket.assignee_user_id, 'should unassign on region transfer');

    // Transfer back
    await client.post('/api/tickets/TRA-0001/region', { regionId: 'r-test-1' });
  }));

  results.push(await test('Transfer to non-existent region returns 404', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.post('/api/tickets/TRA-0001/region', { regionId: 'r-fake' });
    assertEqual(res.status, 404, 'status');
  }));

  // ── Attachments ──

  results.push(await test('Get ticket attachments', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.get('/api/tickets/TRA-0001/attachments');
    assertOk(res);
    assert(Array.isArray(res.data.attachments), 'attachments should be array');
  }));

  // ── Time Tracking ──

  results.push(await test('Start and stop time clock', async () => {
    const client = await loginAs(port, 'coordinator');
    // Self-assign first
    await client.post('/api/tickets/TRA-0001/assign', { userId: 'u-test-coord' });

    let res = await client.post('/api/tickets/TRA-0001/time/start');
    assertOk(res, 'start clock');
    assert(res.data.id, 'should have entry id');

    res = await client.post('/api/tickets/TRA-0001/time/stop', { note: 'Test clock' });
    assertOk(res, 'stop clock');
    assert(res.data.durationMs >= 0, 'should have duration');
  }));

  results.push(await test('Get time entries for ticket', async () => {
    const client = await loginAs(port, 'coordinator');
    const res = await client.get('/api/tickets/TRA-0001/time');
    assertOk(res);
    assert(Array.isArray(res.data.entries), 'entries should be array');
    assert(res.data.totalMs >= 0, 'should have total');
  }));

  return results;
};
