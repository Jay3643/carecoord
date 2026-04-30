/**
 * Health & Reference Data Tests
 * Tests public/convenience endpoints that return reference data.
 */
const { TestClient, test, assert, assertEqual, loginAs } = require('../setup');

module.exports = async function healthSuite(port) {
  const client = new TestClient(port);
  const results = [];

  results.push(await test('GET /api/health returns ok', async () => {
    const res = await client.get('/api/health');
    assertEqual(res.status, 200, 'status');
    assertEqual(res.data.status, 'ok', 'body.status');
    assert(res.data.timestamp, 'should have timestamp');
  }));

  results.push(await test('GET /api/tags returns tags array', async () => {
    const res = await client.get('/api/tags');
    assertEqual(res.status, 200, 'status');
    assert(Array.isArray(res.data.tags), 'tags should be array');
    assert(res.data.tags.length >= 2, 'should have at least 2 test tags');
  }));

  results.push(await test('GET /api/regions returns active regions', async () => {
    const res = await client.get('/api/regions');
    assertEqual(res.status, 200, 'status');
    assert(Array.isArray(res.data.regions), 'regions should be array');
    assert(res.data.regions.length >= 3, 'should have at least 3 test regions');
  }));

  results.push(await test('GET /api/users returns active users', async () => {
    const res = await client.get('/api/users');
    assertEqual(res.status, 200, 'status');
    assert(Array.isArray(res.data.users), 'users should be array');
    assert(res.data.users.length >= 3, 'should have at least 3 test users');
  }));

  results.push(await test('GET /api/close-reasons returns reasons', async () => {
    const res = await client.get('/api/close-reasons');
    assertEqual(res.status, 200, 'status');
    assert(Array.isArray(res.data.reasons), 'reasons should be array');
    assert(res.data.reasons.length >= 2, 'should have at least 2 close reasons');
  }));

  // /api/ref/* routes require authentication
  const authedClient = await loginAs(port, 'admin');

  results.push(await test('GET /api/ref/regions returns regions (auth required)', async () => {
    const res = await authedClient.get('/api/ref/regions');
    assertEqual(res.status, 200, 'status');
    assert(res.data.regions, 'should have regions');
  }));

  results.push(await test('GET /api/ref/tags returns tags (auth required)', async () => {
    const res = await authedClient.get('/api/ref/tags');
    assertEqual(res.status, 200, 'status');
    assert(res.data.tags, 'should have tags');
  }));

  results.push(await test('GET /api/ref/regions without auth returns 401', async () => {
    const res = await client.get('/api/ref/regions');
    assertEqual(res.status, 401, 'status');
  }));

  return results;
};
