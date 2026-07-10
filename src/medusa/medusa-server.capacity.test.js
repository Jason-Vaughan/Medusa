const http = require('http');
const https = require('https');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const MedusaServer = require('./medusa-server');
const ProcessLock = require('../utils/ProcessLock');

jest.mock('../utils/ProcessLock');

/**
 * Chunk 34 capacity-expansion HTTP surface tests.
 * - Tests #4-#7: HMAC auth, rate limit, hard cap, HITL counter
 * - Test #8: TangleClaw port-range allocation
 *
 * These verify features the c5fca62 implementation already shipped.
 * Expected: all PASS on current code. Any FAIL = real regression.
 */
describe('MedusaServer Chunk 34 _ Capacity Expansion', () => {
  let server;
  let tempRegistryFile;
  let testPort = 3091;
  let testWebPort = 8291;

  const postSigned = (pathname, body = null) => {
    return new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : '';
      const sig = server.signA2ARequest(pathname, server.a2aSecret);
      const req = http.request({
        hostname: 'localhost',
        port: testPort,
        path: pathname,
        method: 'POST',
        headers: {
          'X-Medusa-Timestamp': sig['X-Medusa-Timestamp'],
          'X-Medusa-Signature': sig['X-Medusa-Signature'],
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        }
      }, (res) => {
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    tempRegistryFile = path.join(os.tmpdir(), `medusa-cap34-${Date.now()}.json`);
    server = new MedusaServer({
      protocolPort: testPort,
      webPort: testWebPort,
      workspaceRegistryFile: tempRegistryFile,
      a2aBaseUrl: 'http://localhost:3399',
      a2aSecret: 'test-secret-chunk34',
    });
    ProcessLock.cleanupStaleLocks.mockResolvedValue();
    ProcessLock.prototype.acquire.mockResolvedValue();
    ProcessLock.prototype.release.mockResolvedValue();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    if (server && server.protocolServer && server.protocolServer.listening) {
      await server.stop();
    }
    try { await fs.unlink(tempRegistryFile); } catch {}
  });

  // ---------- TEST #4: HMAC auth ----------
  describe('#4 _ HMAC auth on /mesh/expand', () => {
    test('verifyA2ASignature accepts a valid HMAC', () => {
      const sig = server.signA2ARequest('/mesh/expand', server.a2aSecret);
      const headers = {
        'x-medusa-timestamp': sig['X-Medusa-Timestamp'],
        'x-medusa-signature': sig['X-Medusa-Signature'],
      };
      expect(server.verifyA2ASignature(headers, '/mesh/expand')).toBe(true);
    });

    test('verifyA2ASignature rejects missing timestamp header', () => {
      const sig = server.signA2ARequest('/mesh/expand', server.a2aSecret);
      expect(server.verifyA2ASignature(
        { 'x-medusa-signature': sig['X-Medusa-Signature'] },
        '/mesh/expand'
      )).toBe(false);
    });

    test('verifyA2ASignature rejects missing signature header', () => {
      const sig = server.signA2ARequest('/mesh/expand', server.a2aSecret);
      expect(server.verifyA2ASignature(
        { 'x-medusa-timestamp': sig['X-Medusa-Timestamp'] },
        '/mesh/expand'
      )).toBe(false);
    });

    test('verifyA2ASignature rejects a tampered signature', () => {
      const sig = server.signA2ARequest('/mesh/expand', server.a2aSecret);
      const tampered = sig['X-Medusa-Signature'].split('').reverse().join('');
      expect(server.verifyA2ASignature(
        { 'x-medusa-timestamp': sig['X-Medusa-Timestamp'], 'x-medusa-signature': tampered },
        '/mesh/expand'
      )).toBe(false);
    });

    test('verifyA2ASignature rejects a stale (>5min) timestamp _ replay protection', () => {
      const stale = (Math.floor(Date.now() / 1000) - 600).toString(); // 10min ago
      const payload = `${stale}/mesh/expand`;
      const signature = crypto.createHmac('sha256', server.a2aSecret).update(payload).digest('hex');
      expect(server.verifyA2ASignature(
        { 'x-medusa-timestamp': stale, 'x-medusa-signature': signature },
        '/mesh/expand'
      )).toBe(false);
    });

    test('POST /mesh/expand returns 401 with no signature headers', async () => {
      await server.start();
      const req = await new Promise((resolve, reject) => {
        const r = http.request({
          hostname: 'localhost', port: testPort, path: '/mesh/expand', method: 'POST',
        }, (res) => {
          let data = '';
          res.on('data', (c) => data += c);
          res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
        });
        r.on('error', reject);
        r.end();
      });
      expect(req.statusCode).toBe(401);
    });
  });

  // ---------- TEST #5: rate limit ----------
  describe('#5 _ Spawn rate limit (1 per 60s)', () => {
    test('POST /mesh/expand returns 429 when called within 60s of lastSpawnTime', async () => {
      await server.start();
      server.lastSpawnTime = Date.now() - 30_000; // 30s ago _ within cooldown
      const res = await postSigned('/mesh/expand');
      expect(res.statusCode).toBe(429);
      expect(JSON.parse(res.body).error).toMatch(/rate limited/i);
    });

    test('POST /mesh/expand allowed when lastSpawnTime is >60s old (no rate-limit hit)', async () => {
      await server.start();
      server.lastSpawnTime = Date.now() - 70_000; // 70s ago _ past cooldown
      // Force HITL queueing so the test doesn't try to actually spawn a process
      server.spawnApprovalCount = 0;
      server.spawnApprovalGateLiftsAt = 5;
      // Mock the gossip peer list (used for hard-cap check) to show zero spawned children
      jest.spyOn(server, 'callA2A').mockResolvedValue({ ok: true, status: 200, data: [] });

      const res = await postSigned('/mesh/expand');
      // Should NOT be 429 _ should reach the HITL gate (202)
      expect(res.statusCode).not.toBe(429);
      expect(res.statusCode).toBe(202);
    });
  });

  // ---------- TEST #6: hard cap ----------
  describe('#6 _ Hard cap of 4 spawned children', () => {
    test('POST /mesh/expand returns 403 when gossip shows 4 spawned children active', async () => {
      await server.start();
      server.lastSpawnTime = 0; // Disable rate limit
      // Mock gossip to return 4 active spawned children
      jest.spyOn(server, 'callA2A').mockResolvedValue({
        ok: true, status: 200,
        data: [
          { id: 'workspace-spawned-4220', status: 'active' },
          { id: 'workspace-spawned-4221', status: 'active' },
          { id: 'workspace-spawned-4222', status: 'active' },
          { id: 'workspace-spawned-4223', status: 'active' },
        ]
      });

      const res = await postSigned('/mesh/expand');
      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).error).toMatch(/cap hit/i);
    });

    test('hard cap counts only ACTIVE spawned children (terminated/inactive ignored)', async () => {
      await server.start();
      server.lastSpawnTime = 0;
      server.spawnApprovalCount = 0;
      server.spawnApprovalGateLiftsAt = 5;
      // 3 active + 2 terminated _ only 3 count, cap not hit
      jest.spyOn(server, 'callA2A').mockResolvedValue({
        ok: true, status: 200,
        data: [
          { id: 'workspace-spawned-4220', status: 'active' },
          { id: 'workspace-spawned-4221', status: 'active' },
          { id: 'workspace-spawned-4222', status: 'active' },
          { id: 'workspace-spawned-4223', status: 'terminated' },
          { id: 'workspace-spawned-4224', status: 'terminated' },
        ]
      });

      const res = await postSigned('/mesh/expand');
      expect(res.statusCode).not.toBe(403); // Cap NOT hit
      expect(res.statusCode).toBe(202);     // Hits HITL gate instead
    });
  });

  // ---------- TEST #7: HITL gate counter ----------
  describe('#7 _ HITL gate counter only increments on successful spawn', () => {
    test('pollForSpawnSuccess does NOT increment counter when node never appears active', async () => {
      jest.spyOn(server, 'callA2A').mockResolvedValue({ ok: true, status: 200, data: [] });
      jest.spyOn(server, 'saveRegistry').mockResolvedValue();
      server.spawnApprovalCount = 0;
      // attempts=13 immediately exceeds the 12 retry budget _ returns without incrementing
      await server.pollForSpawnSuccess('never-appears-node', 13);
      expect(server.spawnApprovalCount).toBe(0);
    });

    test('pollForSpawnSuccess increments counter when node IS found as active', async () => {
      jest.spyOn(server, 'callA2A').mockResolvedValue({
        ok: true, status: 200,
        data: [{ id: 'workspace-spawned-4220', status: 'active' }]
      });
      jest.spyOn(server, 'saveRegistry').mockResolvedValue();
      server.spawnApprovalCount = 0;
      await server.pollForSpawnSuccess('workspace-spawned-4220', 0);
      expect(server.spawnApprovalCount).toBe(1);
    });

    test('pollForSpawnSuccess does NOT increment counter when node found but status is not active', async () => {
      jest.spyOn(server, 'callA2A').mockResolvedValue({
        ok: true, status: 200,
        data: [{ id: 'workspace-spawned-4220', status: 'pending' }]
      });
      jest.spyOn(server, 'saveRegistry').mockResolvedValue();
      server.spawnApprovalCount = 0;
      // attempts=13 to skip recursion
      await server.pollForSpawnSuccess('workspace-spawned-4220', 13);
      expect(server.spawnApprovalCount).toBe(0);
    });
  });

  // ---------- TEST #8: port range ----------
  describe('#8 _ Spawned children use port range 4220-4239', () => {
    const mockTangleClawResponse = (leases) => {
      const mockRes = {
        on: jest.fn((event, cb) => {
          if (event === 'data') cb(JSON.stringify({ leases }));
          if (event === 'end') cb();
        })
      };
      const mockReq = { on: jest.fn(), end: jest.fn() };
      jest.spyOn(https, 'request').mockImplementation((url, opts, cb) => {
        if (cb) cb(mockRes);
        return mockReq;
      });
      jest.spyOn(http, 'request').mockImplementation((url, opts, cb) => {
        if (cb) cb(mockRes);
        return mockReq;
      });
    };

    test('getAvailablePortFromTangleClaw returns a port in [4220, 4239] when range has free slots', async () => {
      mockTangleClawResponse([
        { port: 3009 }, { port: 8181 }, { port: 4220 }, { port: 4221 }, // some taken
      ]);
      const port = await server.getAvailablePortFromTangleClaw();
      expect(port).toBeGreaterThanOrEqual(4220);
      expect(port).toBeLessThanOrEqual(4239);
      expect(port).toBe(4222); // first free in range
    });

    test('getAvailablePortFromTangleClaw rejects when entire range is taken', async () => {
      const allTaken = [];
      for (let p = 4220; p <= 4239; p++) allTaken.push({ port: p });
      mockTangleClawResponse(allTaken);
      await expect(server.getAvailablePortFromTangleClaw()).rejects.toThrow(/No available ports/);
    });

    test('getAvailablePortFromTangleClaw never returns a port outside [4220, 4239]', async () => {
      mockTangleClawResponse([]); // empty PortHub
      const port = await server.getAvailablePortFromTangleClaw();
      expect(port).toBeGreaterThanOrEqual(4220);
      expect(port).toBeLessThanOrEqual(4239);
    });
  });

  // ---------- MAJOR #3 + #5: missing telemetry events & crash synthesis ----------
  describe('#9 _ Missing Chunk 34 telemetry & crash reconciler', () => {
    test('MAJOR #3a: rate-limit path emits mesh.expand.rate_limited to messageHistory', async () => {
      await server.start();
      server.lastSpawnTime = Date.now() - 30_000;
      server.messageHistory = [];

      await postSigned('/mesh/expand');

      const telemetry = server.messageHistory.filter(m => m.type === 'telemetry');
      const rateLimited = telemetry.find(m => m.message.includes('mesh.expand.rate_limited'));
      expect(rateLimited).toBeDefined();
    });

    test('MAJOR #3b: cap-hit path emits mesh.expand.cap_hit to messageHistory', async () => {
      await server.start();
      server.lastSpawnTime = 0;
      server.messageHistory = [];
      jest.spyOn(server, 'callA2A').mockResolvedValue({
        ok: true, status: 200,
        data: [
          { id: 'workspace-spawned-4220', status: 'active' },
          { id: 'workspace-spawned-4221', status: 'active' },
          { id: 'workspace-spawned-4222', status: 'active' },
          { id: 'workspace-spawned-4223', status: 'active' },
        ]
      });

      await postSigned('/mesh/expand');

      const telemetry = server.messageHistory.filter(m => m.type === 'telemetry');
      const capHit = telemetry.find(m => m.message.includes('mesh.expand.cap_hit'));
      expect(capHit).toBeDefined();
    });

    test('MAJOR #3c: approve path emits mesh.expand.approved to messageHistory', async () => {
      await server.start();
      server.messageHistory = [];
      server.pendingSpawnRequests = [
        { id: 'spawn-test-1', requestedAt: new Date().toISOString(), status: 'pending' }
      ];
      server.lastSpawnTime = 0;
      jest.spyOn(server, 'getAvailablePortFromTangleClaw').mockResolvedValue(4220);
      jest.spyOn(server, 'spawnA2ANode').mockResolvedValue('test-node-id');

      await postSigned('/mesh/approve/spawn-test-1');

      const telemetry = server.messageHistory.filter(m => m.type === 'telemetry');
      const approved = telemetry.find(m => m.message.includes('mesh.expand.approved'));
      expect(approved).toBeDefined();
    });

    test('MAJOR #5: reconciler synthesizes mesh.contract.crashed for vanished children', async () => {
      await server.start();
      server.messageHistory = [];

      // Tell the server we previously spawned 2 children
      // (this exercises whatever expected-children tracking the fix introduces)
      if (typeof server.spawnedChildrenExpected === 'undefined') {
        server.spawnedChildrenExpected = new Set();
      }
      server.spawnedChildrenExpected.add('workspace-spawned-4220');
      server.spawnedChildrenExpected.add('workspace-spawned-4221');

      // Gossip only reports one _ the other crashed without /mesh/contract
      jest.spyOn(server, 'callA2A').mockResolvedValue({
        ok: true, status: 200,
        data: [{ id: 'workspace-spawned-4220', status: 'active' }]
      });

      // The fix should add a reconcileSpawnedChildren() method
      if (typeof server.reconcileSpawnedChildren !== 'function') {
        throw new Error(
          'server.reconcileSpawnedChildren() does not exist. Major #5 needs ' +
          'a method that diffs spawnedChildrenExpected against the live ' +
          'gossip mesh and emits mesh.contract.crashed for missing entries.'
        );
      }

      await server.reconcileSpawnedChildren();

      const telemetry = server.messageHistory.filter(m => m.type === 'telemetry');
      const crashed = telemetry.find(m =>
        m.message.includes('mesh.contract.crashed') &&
        m.message.includes('workspace-spawned-4221')
      );
      expect(crashed).toBeDefined();
    });
  });
});
