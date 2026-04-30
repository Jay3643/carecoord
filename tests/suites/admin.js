/**
 * Admin API Tests
 * Tests user, region, and tag CRUD operations with role-based access control.
 */
const { TestClient, test, assert, assertEqual, assertOk, loginAs } = require('../setup');

module.exports = async function adminSuite(port) {
  const results = [];

  // ── Access Control ──

  results.push(await test('Non-admin cannot access admin users', async () => {
    const client = await loginAs(port, 'coordinator');
    const res = await client.get('/api/admin/users');
    assertEqual(res.status, 403, 'status');
  }));

  results.push(await test('Non-admin cannot access admin regions', async () => {
    const client = await loginAs(port, 'coordinator');
    const res = await client.get('/api/admin/regions');
    assertEqual(res.status, 403, 'status');
  }));

  results.push(await test('Unauthenticated user gets 401 on admin routes', async () => {
    const client = new TestClient(port);
    const res = await client.get('/api/admin/users');
    assertEqual(res.status, 401, 'status');
  }));

  // ── Users CRUD ──

  results.push(await test('Admin can list all users', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.get('/api/admin/users');
    assertOk(res);
    assert(Array.isArray(res.data.users), 'users should be array');
    assert(res.data.users.length >= 3, 'should have at least 3 users');
    // Each user should have regions
    for (const u of res.data.users) {
      assert(u.regions !== undefined, 'user should have regions');
    }
  }));

  let createdUserId = null;
  results.push(await test('Admin can create a new user', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.post('/api/admin/users', {
      name: 'New Test User',
      email: 'newuser@test.com',
      role: 'coordinator',
      regionIds: ['r-test-1'],
    });
    assertOk(res);
    assert(res.data.user, 'should return user');
    assert(res.data.user.id, 'user should have id');
    assert(res.data.tempPassword, 'should return temp password');
    createdUserId = res.data.user.id;
  }));

  results.push(await test('Cannot create user with duplicate email', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.post('/api/admin/users', {
      name: 'Duplicate User',
      email: 'newuser@test.com',
      role: 'coordinator',
    });
    assertEqual(res.status, 409, 'status');
  }));

  results.push(await test('Create user requires name, email, role', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.post('/api/admin/users', { name: 'Only Name' });
    assertEqual(res.status, 400, 'status');
  }));

  results.push(await test('Create user rejects invalid role', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.post('/api/admin/users', {
      name: 'Bad Role',
      email: 'badrole@test.com',
      role: 'superadmin',
    });
    assertEqual(res.status, 400, 'status');
  }));

  results.push(await test('Admin can update a user', async () => {
    const client = await loginAs(port, 'admin');
    assert(createdUserId, 'created user ID should exist');
    const res = await client.put('/api/admin/users/' + createdUserId, {
      name: 'Updated Test User',
      role: 'supervisor',
    });
    assertOk(res);
  }));

  results.push(await test('Update non-existent user returns 404', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.put('/api/admin/users/u-fake-id', { name: 'Ghost' });
    assertEqual(res.status, 404, 'status');
  }));

  results.push(await test('Admin can set user regions', async () => {
    const client = await loginAs(port, 'admin');
    assert(createdUserId, 'created user ID should exist');
    const res = await client.post('/api/admin/users/' + createdUserId + '/regions', {
      regionIds: ['r-test-1', 'r-test-2'],
    });
    assertOk(res);
    assert(res.data.regionIds.length === 2, 'should have 2 regions');
  }));

  results.push(await test('Admin can deactivate a user', async () => {
    const client = await loginAs(port, 'admin');
    assert(createdUserId, 'created user ID should exist');
    const res = await client.del('/api/admin/users/' + createdUserId);
    assertOk(res);
  }));

  results.push(await test('Admin cannot deactivate themselves', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.del('/api/admin/users/u-test-admin');
    assertEqual(res.status, 400, 'status');
  }));

  results.push(await test('Admin can reactivate a user', async () => {
    const client = await loginAs(port, 'admin');
    assert(createdUserId, 'created user ID should exist');
    const res = await client.post('/api/admin/users/' + createdUserId + '/reactivate');
    assertOk(res);
  }));

  results.push(await test('Admin can reset user password', async () => {
    const client = await loginAs(port, 'admin');
    assert(createdUserId, 'created user ID should exist');
    const res = await client.post('/api/admin/users/' + createdUserId + '/reset-password');
    assertOk(res);
    assert(res.data.tempPassword, 'should return new temp password');
  }));

  // ── Regions CRUD ──

  results.push(await test('Admin can list all regions', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.get('/api/admin/regions');
    assertOk(res);
    assert(Array.isArray(res.data.regions), 'regions should be array');
    assert(res.data.regions.length >= 3, 'should have at least 3 regions');
  }));

  let createdRegionId = null;
  results.push(await test('Admin can create a region', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.post('/api/admin/regions', {
      name: 'New Test Region',
      routingAliases: ['newregion@test.com'],
    });
    assertOk(res);
    assert(res.data.region, 'should return region');
    assert(res.data.region.id, 'region should have id');
    createdRegionId = res.data.region.id;
  }));

  results.push(await test('Create region requires name', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.post('/api/admin/regions', { name: '' });
    assertEqual(res.status, 400, 'status');
  }));

  results.push(await test('Admin can update a region', async () => {
    const client = await loginAs(port, 'admin');
    assert(createdRegionId, 'created region ID should exist');
    const res = await client.put('/api/admin/regions/' + createdRegionId, {
      name: 'Updated Test Region',
    });
    assertOk(res);
  }));

  results.push(await test('Admin can deactivate empty region', async () => {
    const client = await loginAs(port, 'admin');
    assert(createdRegionId, 'created region ID should exist');
    const res = await client.del('/api/admin/regions/' + createdRegionId);
    assertOk(res);
  }));

  results.push(await test('Cannot deactivate region with open tickets', async () => {
    const client = await loginAs(port, 'admin');
    // r-test-1 has open tickets
    const res = await client.del('/api/admin/regions/r-test-1');
    assertEqual(res.status, 400, 'status');
    assert(res.data.error.includes('open tickets'), 'error should mention open tickets');
  }));

  // ── Tags CRUD ──

  results.push(await test('Admin can list tags', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.get('/api/admin/tags');
    assertOk(res);
    assert(Array.isArray(res.data.tags), 'tags should be array');
  }));

  results.push(await test('Supervisor can also list tags', async () => {
    const client = await loginAs(port, 'supervisor');
    const res = await client.get('/api/admin/tags');
    assertOk(res);
  }));

  results.push(await test('Coordinator cannot list admin tags', async () => {
    const client = await loginAs(port, 'coordinator');
    const res = await client.get('/api/admin/tags');
    assertEqual(res.status, 403, 'status');
  }));

  let createdTagId = null;
  results.push(await test('Admin can create a tag', async () => {
    const client = await loginAs(port, 'admin');
    const res = await client.post('/api/admin/tags', {
      name: 'Test Bot Tag',
      color: '#10b981',
    });
    assertOk(res);
    assert(res.data.id, 'tag should have id');
    createdTagId = res.data.id;
  }));

  results.push(await test('Admin can update a tag', async () => {
    const client = await loginAs(port, 'admin');
    assert(createdTagId, 'created tag ID should exist');
    const res = await client.put('/api/admin/tags/' + createdTagId, {
      name: 'Updated Bot Tag',
      color: '#f59e0b',
    });
    assertOk(res);
  }));

  results.push(await test('Admin can delete a tag', async () => {
    const client = await loginAs(port, 'admin');
    assert(createdTagId, 'created tag ID should exist');
    const res = await client.del('/api/admin/tags/' + createdTagId);
    assertOk(res);
  }));

  return results;
};
