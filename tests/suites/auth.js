/**
 * Auth API Tests
 * Tests login, logout, session management, password change, and work status.
 */
const { TestClient, TEST_USERS, TEST_PASSWORD, test, assert, assertEqual, assertOk, loginAs } = require('../setup');

module.exports = async function authSuite(port) {
  const results = [];

  // ── Login ──

  results.push(await test('Login with valid admin credentials', async () => {
    const client = new TestClient(port);
    const res = await client.post('/api/auth/login', {
      email: TEST_USERS.admin.email,
      password: TEST_PASSWORD,
    });
    assertEqual(res.status, 200, 'status');
    // Should return step (done or setup_2fa since 2FA not enabled)
    assert(res.data.step, 'should have step field');
    assert(client.cookies.sid, 'should set sid cookie');
  }));

  results.push(await test('Login with invalid password returns 401', async () => {
    const client = new TestClient(port);
    const res = await client.post('/api/auth/login', {
      email: TEST_USERS.admin.email,
      password: 'wrong-password',
    });
    assertEqual(res.status, 401, 'status');
    assert(res.data.error, 'should have error message');
  }));

  results.push(await test('Login with non-existent email returns 401', async () => {
    const client = new TestClient(port);
    const res = await client.post('/api/auth/login', {
      email: 'nobody@test.com',
      password: TEST_PASSWORD,
    });
    assertEqual(res.status, 401, 'status');
  }));

  results.push(await test('Login with missing fields returns 401', async () => {
    const client = new TestClient(port);
    const res = await client.post('/api/auth/login', { email: '', password: '' });
    assertEqual(res.status, 401, 'status');
  }));

  // ── Session / Me ──

  results.push(await test('GET /me without auth returns 401', async () => {
    const client = new TestClient(port);
    const res = await client.get('/api/auth/me');
    assertEqual(res.status, 401, 'status');
  }));

  results.push(await test('GET /me with valid session returns user', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.get('/api/auth/me');
    assertEqual(res.status, 200, 'status');
    assert(res.data.user, 'should have user');
    assertEqual(res.data.user.email, TEST_USERS.admin.email, 'email');
    assertEqual(res.data.user.role, 'admin', 'role');
    assert(Array.isArray(res.data.user.regionIds), 'regionIds should be array');
  }));

  // ── Logout ──

  results.push(await test('Logout clears session', async () => {
    const client = await loginAs(port, 'coordinator');
    // Verify logged in
    let res = await client.get('/api/auth/me');
    assertEqual(res.status, 200, 'should be authenticated');

    // Logout
    res = await client.post('/api/auth/logout');
    assertEqual(res.status, 200, 'logout status');

    // Verify session is gone
    res = await client.get('/api/auth/me');
    assertEqual(res.status, 401, 'should be unauthenticated after logout');
  }));

  // ── Password Change ──

  results.push(await test('Change password requires authentication', async () => {
    const client = new TestClient(port);
    const res = await client.post('/api/auth/change-password', { newPassword: 'NewPass123!' });
    assertEqual(res.status, 401, 'status');
  }));

  results.push(await test('Change password rejects short passwords', async () => {
    const client = await loginAs(port, 'coordinator');
    const res = await client.post('/api/auth/change-password', { newPassword: 'short' });
    assertEqual(res.status, 400, 'status');
  }));

  results.push(await test('Change password accepts valid new password', async () => {
    const client = await loginAs(port, 'coordinator');
    const res = await client.post('/api/auth/change-password', { newPassword: 'NewValidPass123!' });
    assertEqual(res.status, 200, 'status');

    // Reset password back so other tests still work
    await client.post('/api/auth/change-password', { newPassword: TEST_PASSWORD });
  }));

  // ── Work Status ──

  results.push(await test('Set work status to active', async () => {
    const client = await loginAs(port, 'coordinator');
    const res = await client.post('/api/auth/work-status', { status: 'active' });
    assertEqual(res.status, 200, 'status');
    assertEqual(res.data.workStatus, 'active', 'workStatus');
  }));

  results.push(await test('Set work status to busy', async () => {
    const client = await loginAs(port, 'coordinator');
    const res = await client.post('/api/auth/work-status', { status: 'busy' });
    assertEqual(res.status, 200, 'status');
    assertEqual(res.data.workStatus, 'busy', 'workStatus');
  }));

  results.push(await test('Set work status rejects invalid value', async () => {
    const client = await loginAs(port, 'coordinator');
    const res = await client.post('/api/auth/work-status', { status: 'sleeping' });
    assertEqual(res.status, 400, 'status');
  }));

  results.push(await test('Work status requires auth', async () => {
    const client = new TestClient(port);
    const res = await client.post('/api/auth/work-status', { status: 'active' });
    assertEqual(res.status, 401, 'status');
  }));

  // ── Forgot Password ──

  results.push(await test('Forgot password always returns ok (no email enumeration)', async () => {
    const client = new TestClient(port);
    // Real user
    let res = await client.post('/api/auth/forgot-password', { email: TEST_USERS.admin.email });
    assertEqual(res.status, 200, 'status for real user');
    assert(res.data.ok, 'should return ok');

    // Non-existent user
    res = await client.post('/api/auth/forgot-password', { email: 'fake@test.com' });
    assertEqual(res.status, 200, 'status for fake user');
    assert(res.data.ok, 'should still return ok');
  }));

  // Reset coordinator back to active for other tests
  const resetClient = await loginAs(port, 'coordinator');
  await resetClient.post('/api/auth/work-status', { status: 'active' });

  return results;
};
