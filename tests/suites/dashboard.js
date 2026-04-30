/**
 * Dashboard API Tests
 * Tests summary metrics, regional breakdown, coordinator stats, and activity analytics.
 */
const { test, assert, assertEqual, assertOk, loginAs } = require('../setup');

module.exports = async function dashboardSuite(port) {
  const results = [];

  // ── Summary ──

  results.push(await test('Dashboard summary returns counts', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.get('/api/dashboard/summary');
    assertOk(res);
    assert(typeof res.data.totalOpen === 'number', 'totalOpen should be number');
    assert(typeof res.data.unassigned === 'number', 'unassigned should be number');
    assert(typeof res.data.closedToday === 'number', 'closedToday should be number');
  }));

  results.push(await test('Dashboard summary requires auth', async () => {
    const { TestClient } = require('../setup');
    const client = new TestClient(port);
    const res = await client.get('/api/dashboard/summary');
    assertEqual(res.status, 401, 'status');
  }));

  // ── By Region ──

  results.push(await test('Dashboard by-region returns breakdown', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.get('/api/dashboard/by-region');
    assertOk(res);
    assert(Array.isArray(res.data.regions), 'regions should be array');
    for (const r of res.data.regions) {
      assert(r.region, 'each entry should have region');
      assert(typeof r.total === 'number', 'should have total');
      assert(typeof r.open === 'number', 'should have open count');
    }
  }));

  // ── By Coordinator ──

  results.push(await test('Dashboard by-coordinator returns workload', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.get('/api/dashboard/by-coordinator');
    assertOk(res);
    assert(Array.isArray(res.data.coordinators), 'coordinators should be array');
  }));

  // ── Activity Trends ──

  results.push(await test('Activity trends returns daily buckets', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.get('/api/dashboard/activity/trends?days=7');
    assertOk(res);
    assert(Array.isArray(res.data.trends), 'trends should be array');
    assert(res.data.trends.length === 7, 'should have 7 days');
    for (const d of res.data.trends) {
      assert(d.date, 'each day should have date');
      assert(typeof d.created === 'number', 'should have created count');
      assert(typeof d.closed === 'number', 'should have closed count');
    }
  }));

  // ── Performance ──

  results.push(await test('Activity performance returns coordinator metrics', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.get('/api/dashboard/activity/performance?days=30');
    assertOk(res);
    assert(Array.isArray(res.data.coordinators), 'coordinators should be array');
    for (const c of res.data.coordinators) {
      assert(c.user, 'each entry should have user');
      assert(typeof c.closed === 'number', 'should have closed count');
      assert(typeof c.open === 'number', 'should have open count');
    }
  }));

  // ── Tags Analytics ──

  results.push(await test('Activity tags returns tag distribution', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.get('/api/dashboard/activity/tags');
    assertOk(res);
    assert(Array.isArray(res.data.tags), 'tags should be array');
  }));

  // ── Activity Feed ──

  results.push(await test('Activity feed returns audit entries', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.get('/api/dashboard/activity/feed?days=30');
    assertOk(res);
    assert(Array.isArray(res.data.feed), 'feed should be array');
    assert(typeof res.data.total === 'number', 'should have total count');
  }));

  // ── Heatmap ──

  results.push(await test('Activity heatmap returns 7x24 grid', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.get('/api/dashboard/activity/heatmap?days=7');
    assertOk(res);
    assert(Array.isArray(res.data.heatmap), 'heatmap should be array');
    assertEqual(res.data.heatmap.length, 7, 'should have 7 days');
    for (const day of res.data.heatmap) {
      assertEqual(day.length, 24, 'each day should have 24 hours');
    }
  }));

  // ── Online Users ──

  results.push(await test('Online users returns user list', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.get('/api/dashboard/activity/online');
    assertOk(res);
    assert(Array.isArray(res.data.users), 'users should be array');
    assert(res.data.serverTime, 'should have serverTime');
  }));

  // ── Heartbeat ──

  results.push(await test('Heartbeat returns ok', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.post('/api/dashboard/activity/heartbeat');
    assertOk(res);
    assert(res.data.ok, 'should return ok');
  }));

  return results;
};
