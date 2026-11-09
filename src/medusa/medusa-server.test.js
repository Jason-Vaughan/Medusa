const http = require('http');
const WebSocket = require('ws');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const MedusaServer = require('./medusa-server');
const ProcessLock = require('../utils/ProcessLock');

// Mock ProcessLock
jest.mock('../utils/ProcessLock');

describe('MedusaServer', () => {
  let server;
  let testPort = 3100;
  let testWebPort = 8282;
  let tempRegistryFile;
  let openWebSockets = [];

  const createWebSocket = (url) => {
    const ws = new WebSocket(url);
    openWebSockets.push(ws);
    return ws;
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    openWebSockets = [];
    tempRegistryFile = path.join(os.tmpdir(), `medusa-registry-${Date.now()}.json`);
    server = new MedusaServer({
      protocolPort: testPort,
      webPort: testWebPort,
      workspaceRegistryFile: tempRegistryFile,
      a2aBaseUrl: 'http://localhost:3300',
      a2aSecret: 'test-secret'
    });
    
    ProcessLock.cleanupStaleLocks.mockResolvedValue();
    ProcessLock.prototype.acquire.mockResolvedValue();
    ProcessLock.prototype.release.mockResolvedValue();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    
    for (const ws of openWebSockets) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.terminate();
      }
    }
    
    if (server.protocolServer && server.protocolServer.listening) {
      await server.stop();
    }
    
    try {
      if (await fs.stat(tempRegistryFile).catch(() => null)) {
        await fs.unlink(tempRegistryFile);
      }
    } catch (e) {
      // Ignore
    }
  });

  describe('Configuration & Initialization', () => {
    test('should initialize with default options', () => {
      const defaultServer = new MedusaServer();
      expect(defaultServer.protocolPort).toBe(3009);
      expect(defaultServer.webPort).toBe(8181);
      expect(defaultServer.a2aBaseUrl).toBe('http://localhost:3200');
      expect(defaultServer.a2aSecret).toBe('medusa-please');
      expect(defaultServer.workspaceRegistryFile).toContain('.medusa');
    });

    test('should initialize with custom options', () => {
      expect(server.protocolPort).toBe(testPort);
      expect(server.webPort).toBe(testWebPort);
      expect(server.workspaceRegistryFile).toBe(tempRegistryFile);
      expect(server.a2aBaseUrl).toBe('http://localhost:3300');
      expect(server.a2aSecret).toBe('test-secret');
    });

    test('env overrides for a2aSecret', () => {
      process.env.A2A_SECRET = 'env-secret';
      const s = new MedusaServer();
      expect(s.a2aSecret).toBe('env-secret');
      delete process.env.A2A_SECRET;
    });

    test('should throw on unset A2A_SECRET in production mode', () => {
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        expect(() => new MedusaServer()).toThrow('A2A_SECRET environment variable is required to start Medusa Hub!');
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
      }
    });

    test('signA2ARequest should generate valid HMAC', () => {
      const pathname = '/test';
      const secret = 'test-secret';
      const sig = server.signA2ARequest(pathname, secret);
      
      expect(sig).toHaveProperty('X-Medusa-Timestamp');
      expect(sig).toHaveProperty('X-Medusa-Signature');
      
      const crypto = require('crypto');
      const expected = crypto.createHmac('sha256', secret)
        .update(`${sig['X-Medusa-Timestamp']}${pathname}`)
        .digest('hex');
      expect(sig['X-Medusa-Signature']).toBe(expected);
    });
  });

  describe('A2A Communication', () => {
    test('callA2A should handle successful response', async () => {
      const mockRes = {
        statusCode: 200,
        on: jest.fn((event, cb) => {
          if (event === 'data') cb(JSON.stringify({ success: true }));
          if (event === 'end') cb();
        })
      };
      const mockReq = {
        on: jest.fn(),
        write: jest.fn(),
        end: jest.fn()
      };
      
      const requestSpy = jest.spyOn(http, 'request').mockReturnValue(mockReq);
      requestSpy.mockImplementation((url, options, callback) => {
        callback(mockRes);
        return mockReq;
      });

      const result = await server.callA2A('GET', '/test');
      expect(result.ok).toBe(true);
      expect(result.data).toEqual({ success: true });
    });

    test('callA2A should handle empty body', async () => {
      const mockRes = {
        statusCode: 200,
        on: jest.fn((event, cb) => {
          if (event === 'data') return; // No data
          if (event === 'end') cb();
        })
      };
      const mockReq = { on: jest.fn(), write: jest.fn(), end: jest.fn() };
      jest.spyOn(http, 'request').mockImplementation((url, opts, cb) => {
        cb(mockRes);
        return mockReq;
      });

      const result = await server.callA2A('GET', '/test');
      expect(result.ok).toBe(true);
      expect(result.data).toEqual({});
    });

    test('callA2A should handle non-2xx status codes', async () => {
      const mockRes = {
        statusCode: 404,
        on: jest.fn((event, cb) => {
          if (event === 'data') cb(JSON.stringify({ error: 'Not Found' }));
          if (event === 'end') cb();
        })
      };
      const mockReq = { on: jest.fn(), write: jest.fn(), end: jest.fn() };
      jest.spyOn(http, 'request').mockImplementation((url, opts, cb) => {
        cb(mockRes);
        return mockReq;
      });

      const result = await server.callA2A('GET', '/test');
      expect(result.ok).toBe(false);
      expect(result.status).toBe(404);
    });

    test('callA2A should handle connection error', async () => {
      const mockReq = {
        on: jest.fn((event, cb) => {
          if (event === 'error') cb(new Error('ECONNREFUSED'));
        }),
        end: jest.fn()
      };
      
      jest.spyOn(http, 'request').mockReturnValue(mockReq);
      const result = await server.callA2A('GET', '/test');
      
      expect(result.ok).toBe(false);
      expect(result.status).toBe(503);
      expect(result.error).toBe('A2A Connection Error');
    });

    test('callA2A should handle invalid URL', async () => {
      server.a2aBaseUrl = 'invalid-url';
      const result = await server.callA2A('GET', '/test');
      expect(result.ok).toBe(false);
      expect(result.status).toBe(500);
      expect(result.error).toBe('Request Error');
    });
  });

  describe('Registry Management', () => {
    test('loadRegistry should handle missing file', async () => {
      await server.loadRegistry();
      expect(server.workspaceRegistry.size).toBe(0);
    });

    test('loadRegistry should load existing workspaces', async () => {
      const mockData = {
        'test-id': {
          id: 'test-id',
          name: 'Test',
          path: '/test/path',
          registeredAt: new Date().toISOString(),
          lastSeen: new Date().toISOString()
        }
      };
      await fs.mkdir(path.dirname(tempRegistryFile), { recursive: true });
      await fs.writeFile(tempRegistryFile, JSON.stringify(mockData));

      await server.loadRegistry();
      expect(server.workspaceRegistry.size).toBe(1);
      expect(server.workspaceRegistry.get('test-id').name).toBe('Test');
    });

    test('saveRegistry should persist workspaces', async () => {
      server.workspaceRegistry.set('test-id', { id: 'test-id', name: 'Test' });
      await server.saveRegistry();

      const content = await fs.readFile(tempRegistryFile, 'utf8');
      const parsed = JSON.parse(content);
      expect(parsed.workspaces['test-id'].name).toBe('Test');
      expect(parsed.spawnApprovalCount).toBe(0);
    });

    test('loadRegistry should log error on invalid JSON', async () => {
      const spy = jest.spyOn(console, 'error').mockImplementation();
      await fs.mkdir(path.dirname(tempRegistryFile), { recursive: true });
      await fs.writeFile(tempRegistryFile, 'not json');
      await server.loadRegistry();
      expect(spy).toHaveBeenCalled();
    });

    test('saveRegistry should log error on failure', async () => {
      const spy = jest.spyOn(console, 'error').mockImplementation();
      jest.spyOn(fs, 'writeFile').mockRejectedValue(new Error('Disk Full'));
      server.workspaceRegistry.set('t1', { id: 't1' });
      await server.saveRegistry();
      expect(spy).toHaveBeenCalledTimes(1);
      const loggedOutput = spy.mock.calls[0][0];
      expect(loggedOutput).toContain('Error saving registry:');
      expect(loggedOutput).toContain('Disk Full');
      const lines = loggedOutput.split('\n');
      expect(lines.length).toBeGreaterThan(1);
      for (const line of lines) {
        expect(line).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] /);
      }
    });
  });

  describe('Protocol Endpoints', () => {
    beforeEach(async () => {
      await server.start();
    });

    afterEach(async () => {
      await server.stop();
    });

    const doGet = (pathname) => {
      return new Promise((resolve, reject) => {
        const req = http.get(`http://localhost:${testPort}${pathname}`, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode, data: data ? JSON.parse(data) : null });
            } catch (e) {
              reject(e);
            }
          });
        });
        req.on('error', reject);
      });
    };

    const doPost = (pathname, body) => {
      return new Promise((resolve, reject) => {
        const req = http.request({
          hostname: 'localhost',
          port: testPort,
          path: pathname,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode, data: data ? JSON.parse(data) : null });
            } catch (e) {
              reject(e);
            }
          });
        });
        req.on('error', reject);
        if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
        req.end();
      });
    };

    const doDelete = (pathname) => {
      return new Promise((resolve, reject) => {
        const req = http.request({
          hostname: 'localhost',
          port: testPort,
          path: pathname,
          method: 'DELETE'
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode, data: data ? JSON.parse(data) : null });
            } catch (e) {
              reject(e);
            }
          });
        });
        req.on('error', reject);
        req.end();
      });
    };

    test('GET /health should report status', async () => {
      jest.spyOn(server, 'callA2A').mockResolvedValue({ ok: true, data: [] });
      const { status, data } = await doGet('/health');
      expect(status).toBe(200);
      expect(data.status).toBe('hissing');
    });

    test('GET /health handles A2A error', async () => {
      jest.spyOn(server, 'callA2A').mockRejectedValue(new Error('Down'));
      const { status, data } = await doGet('/health');
      expect(status).toBe(200);
      expect(data.status).toBe('degraded');
    });

    test('GET /telemetry should report system stats', async () => {
      ProcessLock.getAllLocks.mockResolvedValue([{ name: 'medusa-server', isStale: false }]);
      jest.spyOn(server, 'callA2A').mockResolvedValue({ ok: true, data: [{ id: 'peer-1' }] });
      
      const { status, data } = await doGet('/telemetry');
      expect(status).toBe(200);
      expect(data.server.pid).toBe(process.pid);
      expect(data.a2a.peers_count).toBe(1);
    });

    test('GET /telemetry handles error', async () => {
      ProcessLock.getAllLocks.mockRejectedValue(new Error('Lock error'));
      const { status } = await doGet('/telemetry');
      expect(status).toBe(500);
    });

    test('GET /workspaces should merge registry and connections', async () => {
      server.workspaceRegistry.set('reg-1', { id: 'reg-1', name: 'Registered' });
      server.wsClients.set('conn-1', new Map([['c1', { readyState: WebSocket.OPEN }]]));
      
      const { status, data } = await doGet('/workspaces');
      expect(status).toBe(200);
      expect(data.count).toBe(2);
    });

    test('POST /workspaces/register should create new workspace', async () => {
      const { status, data } = await doPost('/workspaces/register', {
        name: 'New Workspace',
        path: '/some/path'
      });
      expect(status).toBe(201);
      expect(data.success).toBe(true);
    });

    test('POST /workspaces/register should accept a caller-supplied workspaceId (Issue #40)', async () => {
      const { status, data } = await doPost('/workspaces/register', {
        name: 'Stable Workspace',
        path: '/some/stable/path',
        workspaceId: 'stable-id-123'
      });
      expect(status).toBe(201);
      expect(data.workspace.id).toBe('stable-id-123');
      expect(server.workspaceRegistry.has('stable-id-123')).toBe(true);
    });

    test('POST /workspaces/register should reject caller-supplied workspaceId collision with different owner (Issue #40)', async () => {
      server.workspaceRegistry.set('stable-id-456', { id: 'stable-id-456', name: 'Other Workspace', path: '/other/path' });
      const { status } = await doPost('/workspaces/register', {
        name: 'My Workspace',
        path: '/my/path',
        workspaceId: 'stable-id-456'
      });
      expect(status).toBe(409);
    });

    test('DELETE /workspaces/:id should deregister workspace and close ws connections', async () => {
      server.workspaceRegistry.set('test-delete', { id: 'test-delete', name: 'Test Delete' });
      const mockWs = { readyState: WebSocket.OPEN, close: jest.fn() };
      server.wsClients.set('test-delete', new Map([['c1', mockWs]]));
      
      const { status, data } = await doDelete('/workspaces/test-delete');
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(server.workspaceRegistry.has('test-delete')).toBe(false);
      expect(mockWs.close).toHaveBeenCalled();
      expect(server.wsClients.has('test-delete')).toBe(false);
    });

    test('GET /messages/workspace/:id should bridge to A2A', async () => {
      jest.spyOn(server, 'callA2A').mockResolvedValue({ 
        ok: true, 
        data: [{ id: 'm1', sender_id: 's1', recipient_id: 'target', content: 'hello' }] 
      });
      
      const { status, data } = await doGet('/messages/workspace/target');
      expect(status).toBe(200);
      expect(data.count).toBe(1);
      expect(data.messages[0].message).toBe('hello');
    });

    test('POST /context/share should notify via WebSocket', async () => {
      const mockWs = { readyState: WebSocket.OPEN, send: jest.fn() };
      server.wsClients.set('target-ws', new Map([['c1', mockWs]]));
      
      const { status } = await doPost('/context/share', { 
        from: 's1', 
        context: { key: 'val' }, 
        targets: ['target-ws'] 
      });
      
      expect(status).toBe(200);
      expect(mockWs.send).toHaveBeenCalled();
    });

    test('POST /messages/direct should bridge to A2A and notify WS', async () => {
      jest.spyOn(server, 'callA2A').mockResolvedValue({ 
        ok: true, 
        status: 200,
        data: { id: 'm1' } 
      });
      const mockWs = { readyState: WebSocket.OPEN, send: jest.fn() };
      server.wsClients.set('target', new Map([['c1', mockWs]]));
      
      const { status } = await doPost('/messages/direct', { from: 's1', to: 'target', message: 'hi' });
      expect(status).toBe(200);
      expect(mockWs.send).toHaveBeenCalled();
    });

    test('POST /messages/direct should queue message if target workspace is registered but offline, and drain it on GET /messages/workspace/:id', async () => {
      server.workspaceRegistry.set('offline-ws', { id: 'offline-ws', name: 'Offline' });
      jest.spyOn(server, 'callA2A').mockResolvedValue({ 
        ok: false, 
        status: 503,
        data: { message: 'A2A Node offline' } 
      });

      const sendRes = await doPost('/messages/direct', { from: 's1', to: 'offline-ws', message: 'hello offline' });
      expect(sendRes.status).toBe(200);
      expect(sendRes.data.status).toBe('queued');
      expect(server.offlineQueues.get('offline-ws')).toHaveLength(1);

      jest.spyOn(server, 'callA2A').mockResolvedValue({ 
        ok: true, 
        status: 200,
        data: [] 
      });
      const getRes = await doGet('/messages/workspace/offline-ws');
      expect(getRes.status).toBe(200);
      expect(getRes.data.messages).toHaveLength(1);
      expect(getRes.data.messages[0].message).toBe('hello offline');
      
      // Verification of non-destructive read (message survives in queue)
      expect(server.offlineQueues.has('offline-ws')).toBe(true);

      // Acknowledge the message to remove it from the queue
      const ackRes = await doPost('/messages/ack', {
        workspaceId: 'offline-ws',
        messageIds: [getRes.data.messages[0].id]
      });
      expect(ackRes.status).toBe(200);
      expect(server.offlineQueues.has('offline-ws')).toBe(false);
    });

    test('POST /messages/broadcast should bridge to A2A and notify all WS (Issue #35)', async () => {
      jest.spyOn(server, 'callA2A').mockResolvedValue({ 
        ok: true, 
        status: 200,
        data: { id: 'm1', recipients: 2 } 
      });
      const mockWs = { readyState: WebSocket.OPEN, send: jest.fn() };
      server.wsClients.set('w1', new Map([['c1', mockWs]]));
      server.wsClients.set('w2', new Map([['c2', mockWs]]));
      
      const { status, data } = await doPost('/messages/broadcast', { from: 's1', message: 'hello all' });
      expect(status).toBe(200);
      expect(mockWs.send).toHaveBeenCalledTimes(2);
      expect(data.workspaces).toBe(2);
      expect(data.peers).toBe(2);
    });

    test('GET /messages/recent should bridge to A2A', async () => {
      jest.spyOn(server, 'callA2A').mockResolvedValue({ 
        ok: true, 
        data: [{ id: 'm1', sender_id: 's1', content: 'recent' }] 
      });
      const { status, data } = await doGet('/messages/recent');
      expect(status).toBe(200);
      expect(data.count).toBe(1);
    });

    test('GET /mesh/peers should bridge to A2A', async () => {
      jest.spyOn(server, 'callA2A').mockResolvedValue({ 
        ok: true, 
        status: 200,
        data: [{ id: 'p1' }] 
      });
      const { status, data } = await doGet('/mesh/peers');
      expect(status).toBe(200);
      expect(data.peers.length).toBe(1);
    });

    test('POST /a2a/tasks should bridge to A2A', async () => {
      jest.spyOn(server, 'callA2A').mockResolvedValue({ 
        ok: true, 
        status: 201,
        data: { id: 't1' } 
      });
      const { status } = await doPost('/a2a/tasks', { title: 'New Task' });
      expect(status).toBe(201);
    });

    test('GET /auctions should list tasks', async () => {
      jest.spyOn(server, 'callA2A').mockResolvedValue({ 
        ok: true, 
        status: 200,
        data: [{ id: 't1', title: 'Task' }] 
      });
      
      const { status, data } = await doGet('/auctions');
      expect(status).toBe(200);
      expect(data.tasks.length).toBe(1);
    });

    test('POST /auctions/bid should place a bid', async () => {
      jest.spyOn(server, 'callA2A').mockResolvedValue({ 
        ok: true, 
        status: 200,
        data: { success: true } 
      });
      
      const { status } = await doPost('/auctions/bid', { task_id: 't1', bid: 10 });
      expect(status).toBe(200);
    });

    test('POST /auctions/:id/resolve should resolve auction', async () => {
      jest.spyOn(server, 'callA2A').mockResolvedValue({ 
        ok: true, 
        status: 200,
        data: { success: true } 
      });
      
      const { status } = await doPost('/auctions/t1/resolve', {});
      expect(status).toBe(200);
    });

    test('GET /a2a/tasks/tree should build a task tree', async () => {
      jest.spyOn(server, 'callA2A').mockResolvedValue({ 
        ok: true, 
        data: [
          { id: 't1', parent_id: null },
          { id: 't2', parent_id: 't1' }
        ] 
      });
      
      const { status, data } = await doGet('/a2a/tasks/tree');
      expect(status).toBe(200);
      expect(data.tree[0].id).toBe('t1');
      expect(data.tree[0].children[0].id).toBe('t2');
    });

    test('GET /a2a/performance/history should bridge to A2A', async () => {
      jest.spyOn(server, 'callA2A').mockResolvedValue({ 
        ok: true, 
        status: 200,
        data: [] 
      });
      const { status } = await doGet('/a2a/performance/history?node_id=test');
      expect(status).toBe(200);
    });

    test('POST /tasks/:id/approve should bridge to A2A', async () => {
      jest.spyOn(server, 'callA2A').mockResolvedValue({ 
        ok: true, 
        status: 200,
        data: { success: true } 
      });
      const { status } = await doPost('/tasks/t1/approve', {});
      expect(status).toBe(200);
    });

    test('POST /tasks/:id/reject should bridge to A2A', async () => {
      jest.spyOn(server, 'callA2A').mockResolvedValue({ 
        ok: true, 
        status: 200,
        data: { success: true } 
      });
      const { status } = await doPost('/tasks/t1/reject', {});
      expect(status).toBe(200);
    });

    test('POST with invalid JSON should return 500', async () => {
      const { status } = await doPost('/workspaces/register', 'not json');
      expect(status).toBe(500);
    });

    test('404 for unknown endpoints', async () => {
      const { status } = await doGet('/unknown');
      expect(status).toBe(404);
    });

    describe('Loop Protocol Handshake and Invariants', () => {
      beforeEach(() => {
        server.workspaceRegistry.set('w1', { id: 'w1', name: 'w1', path: '/p1', type: 'cursor' });
        server.workspaceRegistry.set('w2', { id: 'w2', name: 'w2', path: '/p2', type: 'cursor' });
        server.offlineQueues.clear();
      });

      test('POST /loops should open a loop, return a 201 response, and queue a loop invite message for the target', async () => {
        const payload = {
          initiator: 'w1',
          target: 'w2',
          task: 'migration check',
          doneCriteria: 'no errors',
          guards: { maxRounds: 4, maxWallTimeSeconds: 60 }
        };
        const { status, data } = await doPost('/loops', payload);
        expect(status).toBe(201);
        expect(data.id).toBeDefined();
        expect(data.state).toBe('initiated');
        expect(data.round).toBe(0);

        // Verify that target got loop invitation queued in offlineQueues
        const queued = server.offlineQueues.get('w2');
        expect(queued).toHaveLength(1);
        expect(queued[0].loopId).toBe(data.id);
        expect(queued[0].loopInvite).toBeDefined();
        expect(queued[0].loopInvite.task).toBe('migration check');
        expect(queued[0].loopInvite.doneCriteria).toBe('no errors');
      });

      test('POST /loops should validate required fields and workspaces', async () => {
        // Missing fields
        const { status: statusMissing } = await doPost('/loops', { initiator: 'w1' });
        expect(statusMissing).toBe(400);

        // Invalid workspace
        const { status: statusInvalid } = await doPost('/loops', {
          initiator: 'w1',
          target: 'non-existent',
          task: 't',
          doneCriteria: 'd'
        });
        expect(statusInvalid).toBe(404);
      });

      test('Loop back-and-forth round message flow and state transitions', async () => {
        // 1. Open loop
        const openPayload = {
          initiator: 'w1',
          target: 'w2',
          task: 'migration check',
          doneCriteria: 'no errors'
        };
        const { data: loop } = await doPost('/loops', openPayload);
        const loopId = loop.id;

        // 2. Read initial state
        const { data: state1 } = await doGet(`/loops/${loopId}`);
        expect(state1.state).toBe('initiated');

        // 3. Sender validation: non-participant attempts to send message
        const { status: statusNonParticipant } = await doPost(`/loops/${loopId}/message`, {
          from: 'other',
          message: 'hi'
        });
        expect(statusNonParticipant).toBe(403);

        // 4. Initiator sends message first (rejected: progression check)
        const { status: statusInitFirst } = await doPost(`/loops/${loopId}/message`, {
          from: 'w1',
          message: 'first message'
        });
        expect(statusInitFirst).toBe(400);

        // 5. Target sends first message (accepted -> transitions to responded)
        const { status: statusTargetFirst, data: msgResult1 } = await doPost(`/loops/${loopId}/message`, {
          from: 'w2',
          message: 'hello from target'
        });
        expect(statusTargetFirst).toBe(200);
        expect(msgResult1.loopState).toBe('responded');
        expect(msgResult1.round).toBe(1);

        // 6. Target sends twice in a row (rejected -> expected initiator next)
        const { status: statusTargetSecond } = await doPost(`/loops/${loopId}/message`, {
          from: 'w2',
          message: 'target double send'
        });
        expect(statusTargetSecond).toBe(400);

        // 7. Initiator sends message (accepted -> transitions to continue)
        const { status: statusInitNext, data: msgResult2 } = await doPost(`/loops/${loopId}/message`, {
          from: 'w1',
          message: 'continue loop'
        });
        expect(statusInitNext).toBe(200);
        expect(msgResult2.loopState).toBe('continue');
        expect(msgResult2.round).toBe(2);
      });

      test('Loop close invariants (only initiator may close, closeSignal recorded)', async () => {
        const { data: loop } = await doPost('/loops', {
          initiator: 'w1',
          target: 'w2',
          task: 'task',
          doneCriteria: 'done'
        });
        const loopId = loop.id;

        // Target attempts to close (rejected)
        const { status: statusTargetClose } = await doPost(`/loops/${loopId}/close`, {
          from: 'w2',
          closeSignal: { reason: 'done' }
        });
        expect(statusTargetClose).toBe(403);

        // Initiator closes (accepted)
        const { status: statusInitClose, data: closeResult } = await doPost(`/loops/${loopId}/close`, {
          from: 'w1',
          closeSignal: { reason: 'complete', evidence: 'good output' }
        });
        expect(statusInitClose).toBe(200);
        expect(closeResult.loopState).toBe('complete');
        expect(closeResult.closeSignal.reason).toBe('complete');

        // Cannot message or close already completed loop
        const { status: statusMsgPostClose } = await doPost(`/loops/${loopId}/message`, {
          from: 'w2',
          message: 'hi'
        });
        expect(statusMsgPostClose).toBe(400);
      });

      test('Runaway guards - maxRounds stops execution and halts loop', async () => {
        const { data: loop } = await doPost('/loops', {
          initiator: 'w1',
          target: 'w2',
          task: 'task',
          doneCriteria: 'done',
          guards: { maxRounds: 2 }
        });
        const loopId = loop.id;

        // Round 1: target sends -> responded
        await doPost(`/loops/${loopId}/message`, { from: 'w2', message: 'r1' });
        // Round 2: initiator sends -> continue -> hits maxRounds 2 -> transitions to halted
        const { data: result } = await doPost(`/loops/${loopId}/message`, { from: 'w1', message: 'r2' });
        expect(result.loopState).toBe('halted');

        // Verify GET returns halted state
        const { data: finalState } = await doGet(`/loops/${loopId}`);
        expect(finalState.state).toBe('halted');

        // Further messages rejected
        const { status: statusAfterHalt } = await doPost(`/loops/${loopId}/message`, { from: 'w2', message: 'r3' });
        expect(statusAfterHalt).toBe(400);
      });

      test('Runaway guards - maxWallTimeSeconds halts loop only after target responds and time budget is exceeded', async () => {
        const { data: loop } = await doPost('/loops', {
          initiator: 'w1',
          target: 'w2',
          task: 'task',
          doneCriteria: 'done',
          mode: 'autonomous',
          guards: { maxWallTimeSeconds: 1 }
        });
        const loopId = loop.id;

        // 1. Wait for 1.1 seconds without any reply. Clock should not start yet.
        await new Promise(r => setTimeout(r, 1100));
        const { data: state1 } = await doGet(`/loops/${loopId}`);
        expect(state1.state).toBe('initiated'); // Should still be initiated!

        // 2. Target responds to start the clock.
        const { status: replyStatus } = await doPost(`/loops/${loopId}/message`, {
          from: 'w2',
          message: 'first reply starts the clock'
        });
        expect(replyStatus).toBe(200);

        // 3. Wait for 1.1 seconds to trip the wall time after start.
        await new Promise(r => setTimeout(r, 1100));

        // 4. Reading loop state should now trigger the wall-clock guard and transition state to halted
        const { data: state2 } = await doGet(`/loops/${loopId}`);
        expect(state2.state).toBe('halted');
      });
    });

    describe('Workspace Name Resolution (Send-by-name)', () => {
      beforeEach(() => {
        server.workspaceRegistry.clear();
        server.offlineQueues.clear();
        
        server.workspaceRegistry.set('w1-id', { id: 'w1-id', name: 'w1', path: '/p1', type: 'cursor' });
        server.workspaceRegistry.set('w2-id', { id: 'w2-id', name: 'w2', path: '/p2', type: 'cursor' });
      });

      test('POST /messages/direct should resolve target by name (case-insensitive)', async () => {
        // Send to name 'W2' instead of raw ID 'w2-id'
        const { status, data } = await doPost('/messages/direct', {
          from: 'w1-id',
          to: 'W2',
          message: 'hello via name'
        });
        expect(status).toBe(200);
        expect(data.success).toBe(true);

        // Verify it was correctly queued for w2-id
        const queued = server.offlineQueues.get('w2-id');
        expect(queued).toHaveLength(1);
        expect(queued[0].to).toBe('w2-id');
      });

      test('POST /loops should resolve initiator and target by name', async () => {
        const { status, data } = await doPost('/loops', {
          initiator: 'W1',
          target: 'w2',
          task: 'task via name',
          doneCriteria: 'done'
        });
        expect(status).toBe(201);
        expect(data.initiator).toBe('w1-id');
        expect(data.target).toBe('w2-id');
      });

      test('POST /messages/direct should return 400 when name matches multiple workspaces (ambiguous)', async () => {
        // Register another workspace with the name 'w2' but a different ID
        server.workspaceRegistry.set('w2-duplicate-id', { id: 'w2-duplicate-id', name: 'w2', path: '/p3', type: 'cursor' });

        const { status, data } = await doPost('/messages/direct', {
          from: 'w1-id',
          to: 'w2',
          message: 'ambiguous message'
        });
        expect(status).toBe(400);
        expect(data.error).toContain('Ambiguous workspace name "w2"');
      });
    });

    describe('Roster Display Name & WS Register (Issue #51)', () => {
      let wsUrl;

      beforeEach(() => {
        wsUrl = `ws://localhost:${testPort + 1}`;
        server.workspaceRegistry.clear();
      });

      test('should derive fallback display name without truncating multi-word suffix and preserve custom name', async () => {
        const connectAndRegister = (workspaceId, customName) => {
          return new Promise((resolve, reject) => {
            const ws = createWebSocket(wsUrl);
            ws.on('open', () => {
              const payload = { type: 'register', workspaceId };
              if (customName) payload.name = customName;
              ws.send(JSON.stringify(payload));
            });
            ws.on('message', (data) => {
              const msg = JSON.parse(data);
              if (msg.type === 'registered') {
                resolve(ws);
              }
            });
            ws.on('error', reject);
          });
        };

        // 1. Connect and register first client (fallback naming)
        const ws1 = await connectAndRegister('tilt-claw-e569739f');

        // 2. Connect and register second client (explicit custom name)
        const ws2 = await connectAndRegister('tilt-v2-c13f9993', 'TiLT v2');

        // 3. Query workspaces to verify display names
        const { status, data: body } = await doGet('/workspaces');
        expect(status).toBe(200);
        const workspaces = body.workspaces;

        // Find tilt-claw-e569739f and verify fallback name is "tilt-claw" (option a)
        const wsClaw = workspaces.find(w => w.id === 'tilt-claw-e569739f');
        expect(wsClaw).toBeDefined();
        expect(wsClaw.name).toBe('tilt-claw');

        // Find tilt-v2-c13f9993 and verify name is "TiLT v2" (option b)
        const wsV2 = workspaces.find(w => w.id === 'tilt-v2-c13f9993');
        expect(wsV2).toBeDefined();
        expect(wsV2.name).toBe('TiLT v2');

        ws1.close();
        ws2.close();
      });
    });

    describe('Loop Observability (Issue #49)', () => {
      beforeEach(() => {
        server.loops.clear();
        server.workspaceRegistry.clear();
        server.workspaceRegistry.set('w1', { id: 'w1', name: 'w1', path: '/p1', type: 'cursor' });
        server.workspaceRegistry.set('w2', { id: 'w2', name: 'w2', path: '/p2', type: 'cursor' });
        server.workspaceRegistry.set('w3', { id: 'w3', name: 'w3', path: '/p3', type: 'cursor' });
      });

      test('should list all loops and support participant filtering', async () => {
        // Create loop 1: w1 -> w2
        const { data: loop1 } = await doPost('/loops', {
          initiator: 'w1',
          target: 'w2',
          task: 'task 1',
          doneCriteria: 'done 1'
        });

        // Create loop 2: w2 -> w3
        const { data: loop2 } = await doPost('/loops', {
          initiator: 'w2',
          target: 'w3',
          task: 'task 2',
          doneCriteria: 'done 2'
        });

        // Query all loops
        const { status: sAll, data: dAll } = await doGet('/loops');
        expect(sAll).toBe(200);
        expect(dAll.count).toBe(2);
        expect(dAll.loops.map(l => l.id).sort()).toEqual([loop1.id, loop2.id].sort());

        // Query loops for participant w1 (should only get loop1)
        const { status: sW1, data: dW1 } = await doGet('/loops?participant=w1');
        expect(sW1).toBe(200);
        expect(dW1.count).toBe(1);
        expect(dW1.loops[0].id).toBe(loop1.id);

        // Query loops for participant w2 (should get both loop1 and loop2)
        const { status: sW2, data: dW2 } = await doGet('/loops?participant=w2');
        expect(sW2).toBe(200);
        expect(dW2.count).toBe(2);

        // Query loops for participant w3 (should only get loop2)
        const { status: sW3, data: dW3 } = await doGet('/loops?participant=w3');
        expect(sW3).toBe(200);
        expect(dW3.count).toBe(1);
        expect(dW3.loops[0].id).toBe(loop2.id);
      });

      test('should retain messages in loop transcript and only include them when include=messages query param is present', async () => {
        const { data: loop } = await doPost('/loops', {
          initiator: 'w1',
          target: 'w2',
          task: 'transcript task',
          doneCriteria: 'done'
        });
        const loopId = loop.id;

        // Post a message from target to start the loop
        await doPost(`/loops/${loopId}/message`, {
          from: 'w2',
          message: 'message from target'
        });

        // Post a message from initiator to continue
        await doPost(`/loops/${loopId}/message`, {
          from: 'w1',
          message: 'message from initiator'
        });

        // 1. Query loop state without include parameter (should not contain messages array)
        const { data: dNoInclude } = await doGet(`/loops/${loopId}`);
        expect(dNoInclude.messages).toBeUndefined();

        // 2. Query loop state with include=messages (should contain messages array with 2 messages)
        const { data: dInclude } = await doGet(`/loops/${loopId}?include=messages`);
        expect(dInclude.messages).toBeDefined();
        expect(dInclude.messages).toHaveLength(2);
        expect(dInclude.messages[0].from).toBe('w2');
        expect(dInclude.messages[0].message).toBe('message from target');
        expect(dInclude.messages[1].from).toBe('w1');
        expect(dInclude.messages[1].message).toBe('message from initiator');

        // 3. Query loops list with include=messages (should contain messages array)
        const { data: dListInclude } = await doGet('/loops?include=messages');
        expect(dListInclude.loops[0].messages).toBeDefined();
        expect(dListInclude.loops[0].messages).toHaveLength(2);

        // 4. Query loops list without include=messages (should omit messages array)
        const { data: dListNoInclude } = await doGet('/loops');
        expect(dListNoInclude.loops[0].messages).toBeUndefined();
      });
    });

    describe('Loop Close Semantics (Issue #50)', () => {
      beforeEach(() => {
        server.loops.clear();
        server.workspaceRegistry.clear();
        server.workspaceRegistry.set('w1', { id: 'w1', name: 'w1', path: '/p1', type: 'cursor' });
        server.workspaceRegistry.set('w2', { id: 'w2', name: 'w2', path: '/p2', type: 'cursor' });
      });

      test('should transition to complete when closed normally', async () => {
        const { data: loop } = await doPost('/loops', {
          initiator: 'w1',
          target: 'w2',
          task: 'close task',
          doneCriteria: 'done'
        });
        const loopId = loop.id;

        const { status, data } = await doPost(`/loops/${loopId}/close`, {
          from: 'w1',
          closeSignal: { reason: 'complete', evidence: 'all clean' }
        });
        expect(status).toBe(200);
        expect(data.loopState).toBe('complete');

        const { data: state } = await doGet(`/loops/${loopId}`);
        expect(state.state).toBe('complete');
      });

      test('should transition to halted when force-done is requested', async () => {
        const { data: loop } = await doPost('/loops', {
          initiator: 'w1',
          target: 'w2',
          task: 'force close task',
          doneCriteria: 'done'
        });
        const loopId = loop.id;

        // Force close using reason: 'force-done'
        const { status, data } = await doPost(`/loops/${loopId}/close`, {
          from: 'w1',
          closeSignal: { reason: 'force-done', evidence: 'operator aborted' }
        });
        expect(status).toBe(200);
        expect(data.loopState).toBe('halted');

        const { data: state } = await doGet(`/loops/${loopId}`);
        expect(state.state).toBe('halted');
      });

      test('should transition to halted when forced: true is supplied in closeSignal', async () => {
        const { data: loop } = await doPost('/loops', {
          initiator: 'w1',
          target: 'w2',
          task: 'force close task 2',
          doneCriteria: 'done'
        });
        const loopId = loop.id;

        // Force close using forced: true
        const { status, data } = await doPost(`/loops/${loopId}/close`, {
          from: 'w1',
          closeSignal: { reason: 'some reason', forced: true, evidence: 'force close parameter' }
        });
        expect(status).toBe(200);
        expect(data.loopState).toBe('halted');

        const { data: state } = await doGet(`/loops/${loopId}`);
        expect(state.state).toBe('halted');
      });
    });
  });

  describe('Web Dashboard', () => {
    beforeEach(async () => {
      await server.start();
    });

    afterEach(async () => {
      await server.stop();
    });

    const doGetWeb = (pathname) => {
      return new Promise((resolve, reject) => {
        http.get(`http://localhost:${testWebPort}${pathname}`, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve({ status: res.statusCode, data }));
        });
      });
    };

    test('GET / should serve dashboard.html', async () => {
      const { status, data } = await doGetWeb('/');
      expect(status).toBe(200);
      expect(data).toContain('<!DOCTYPE html>');
    });

    test('GET /dashboard.js should serve dashboard.js', async () => {
      const { status, data } = await doGetWeb('/dashboard.js');
      expect(status).toBe(200);
      expect(data).toContain('Medusa Dashboard');
    });

    test('GET /medusa-logo.svg should serve logo', async () => {
      const { status } = await doGetWeb('/medusa-logo.svg');
      expect(status).toBe(200);
    });

    test('GET /medusa-logo.png should serve png logo', async () => {
      const { status } = await doGetWeb('/medusa-logo.png');
      expect(status).toBe(200);
    });

    test('GET /unknown should return 404', async () => {
      const { status } = await doGetWeb('/unknown');
      expect(status).toBe(404);
    });
  });

  describe('WebSocket Coordination', () => {
    let wsUrl;

    const doGet = (pathname) => {
      return new Promise((resolve, reject) => {
        const req = http.get(`http://localhost:${testPort}${pathname}`, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode, data: data ? JSON.parse(data) : null });
            } catch (e) {
              reject(e);
            }
          });
        });
        req.on('error', reject);
      });
    };

    beforeEach(async () => {
      await server.start();
      wsUrl = `ws://localhost:${testPort + 1}`;
    });

    test('should handle registration', (done) => {
      const ws = createWebSocket(wsUrl);
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'register', workspaceId: 'test-ws' }));
      });
      ws.on('message', (data) => {
        const msg = JSON.parse(data);
        if (msg.type === 'registered') {
          expect(msg.workspaceId).toBe('test-ws');
          done();
        }
      });
    });

    test('should handle ping-pong', (done) => {
      const ws = createWebSocket(wsUrl);
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'ping' }));
      });
      ws.on('message', (data) => {
        const msg = JSON.parse(data);
        if (msg.type === 'pong') {
          expect(msg).toHaveProperty('timestamp');
          done();
        }
      });
    });

    test('should handle listener heartbeats and update lastSeen (Issue #59)', (done) => {
      const ws = createWebSocket(wsUrl);
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'register', workspaceId: 'test-ws' }));
      });
      ws.on('message', (data) => {
        const msg = JSON.parse(data);
        if (msg.type === 'registered') {
          // Temporarily alter lastSeen to prove the heartbeat overwrites it
          server.workspaceRegistry.get('test-ws').lastSeen = new Date('2020-01-01T00:00:00.000Z');
          ws.send(JSON.stringify({ type: 'listener_heartbeat', status: 'idle' }));
        }
        if (msg.type === 'heartbeat_ack') {
          expect(server.listenerStatus.get('test-ws').status).toBe('idle');
          expect(server.workspaceRegistry.get('test-ws').lastSeen.getFullYear()).toBeGreaterThan(2020);
          done();
        }
      });
    });

    test('should log heartbeat only on first beat or status change with ISO 8601 timestamp, and suppress repeats unless DEBUG is set (Issue #66)', async () => {
      const originalDebug = process.env.DEBUG;
      delete process.env.DEBUG;

      try {
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        const ws = createWebSocket(wsUrl);

        await new Promise((resolve, reject) => {
          ws.on('open', () => {
            ws.send(JSON.stringify({ type: 'register', workspaceId: 'hb-ws' }));
          });
          ws.on('message', (data) => {
            const msg = JSON.parse(data);
            if (msg.type === 'registered') resolve();
          });
          ws.on('error', reject);
        });

        const sendHeartbeat = (status) => new Promise((resolve) => {
          const onMsg = (data) => {
            const msg = JSON.parse(data);
            if (msg.type === 'heartbeat_ack') {
              ws.off('message', onMsg);
              resolve(msg);
            }
          };
          ws.on('message', onMsg);
          ws.send(JSON.stringify({ type: 'listener_heartbeat', status }));
        });

        const getHeartbeatLogs = () =>
          logSpy.mock.calls
            .map((args) => args[0])
            .filter((line) => typeof line === 'string' && line.includes('💓 Listener heartbeat from hb-ws'));

        // 1. First heartbeat ('active') should log once with ISO 8601 timestamp prefix
        logSpy.mockClear();
        await sendHeartbeat('active');
        let hbLogs = getHeartbeatLogs();
        expect(hbLogs).toHaveLength(1);
        expect(hbLogs[0]).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] 💓 Listener heartbeat from hb-ws: active$/);

        // 2. Repeated heartbeat with unchanged status ('active') produces NO log line
        logSpy.mockClear();
        await sendHeartbeat('active');
        await sendHeartbeat('active');
        expect(getHeartbeatLogs()).toHaveLength(0);

        // 3. Status change ('active' -> 'idle') produces exactly one log line
        logSpy.mockClear();
        await sendHeartbeat('idle');
        hbLogs = getHeartbeatLogs();
        expect(hbLogs).toHaveLength(1);
        expect(hbLogs[0]).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] 💓 Listener heartbeat from hb-ws: idle$/);

        // 4. Repeated 'idle' produces NO log line
        logSpy.mockClear();
        await sendHeartbeat('idle');
        expect(getHeartbeatLogs()).toHaveLength(0);

        // 5. Status change ('idle' -> 'active') produces one log line
        logSpy.mockClear();
        await sendHeartbeat('active');
        hbLogs = getHeartbeatLogs();
        expect(hbLogs).toHaveLength(1);
        expect(hbLogs[0]).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] 💓 Listener heartbeat from hb-ws: active$/);

        // 6. With DEBUG=1, repeated heartbeats with unchanged status ARE logged
        process.env.DEBUG = '1';
        logSpy.mockClear();
        await sendHeartbeat('active');
        hbLogs = getHeartbeatLogs();
        expect(hbLogs).toHaveLength(1);

        // 7. With DEBUG=false or DEBUG=0, repeated heartbeats are NOT logged
        process.env.DEBUG = 'false';
        logSpy.mockClear();
        await sendHeartbeat('active');
        expect(getHeartbeatLogs()).toHaveLength(0);

        // 8. After disconnect and reconnect, first heartbeat is treated as newly seen and logged again
        delete process.env.DEBUG;
        ws.close();
        await new Promise((r) => setTimeout(r, 50));
        expect(server.listenerStatus.has('hb-ws')).toBe(false);

        const wsReconnect = createWebSocket(wsUrl);
        await new Promise((resolve, reject) => {
          wsReconnect.on('open', () => {
            wsReconnect.send(JSON.stringify({ type: 'register', workspaceId: 'hb-ws' }));
          });
          wsReconnect.on('message', (data) => {
            const msg = JSON.parse(data);
            if (msg.type === 'registered') resolve();
          });
          wsReconnect.on('error', reject);
        });

        logSpy.mockClear();
        await new Promise((resolve) => {
          const onMsg = (data) => {
            const msg = JSON.parse(data);
            if (msg.type === 'heartbeat_ack') {
              wsReconnect.off('message', onMsg);
              resolve(msg);
            }
          };
          wsReconnect.on('message', onMsg);
          wsReconnect.send(JSON.stringify({ type: 'listener_heartbeat', status: 'active' }));
        });
        hbLogs = getHeartbeatLogs();
        expect(hbLogs).toHaveLength(1);
        expect(hbLogs[0]).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] 💓 Listener heartbeat from hb-ws: active$/);
      } finally {
        if (originalDebug === undefined) {
          delete process.env.DEBUG;
        } else {
          process.env.DEBUG = originalDebug;
        }
      }
    });

    test('should reap workspace from registry on WS close', (done) => {
      const ws = createWebSocket(wsUrl);
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'register', workspaceId: 'close-ws' }));
      });
      ws.on('message', async (data) => {
        const msg = JSON.parse(data);
        if (msg.type === 'registered') {
          // Check that it's registered
          expect(server.wsClients.has('close-ws')).toBe(true);
          
          // Now close the connection
          ws.terminate();
          
          // Wait briefly for server close handler to run
          setTimeout(async () => {
            expect(server.wsClients.has('close-ws')).toBe(false);
            expect(server.workspaceRegistry.has('close-ws')).toBe(false);
            
            // Query workspaces to verify it disappeared from route
            const workspacesRes = await doGet('/workspaces');
            const found = workspacesRes.data.workspaces.find(w => w.id === 'close-ws');
            expect(found).toBeUndefined();
            done();
          }, 100);
        }
      });
    });

    test('sendWebSocketMessage should deliver to multiple connections', (done) => {
      const ws1 = createWebSocket(wsUrl);
      const ws2 = createWebSocket(wsUrl);
      let registeredCount = 0;
      let messageCount = 0;

      const onRegistered = () => {
        registeredCount++;
        if (registeredCount === 2) {
          server.sendWebSocketMessage('shared-ws', { type: 'test_msg', messageId: 'm1' });
        }
      };

      const onMessage = (data) => {
        const msg = JSON.parse(data);
        if (msg.type === 'registered') onRegistered();
        if (msg.type === 'test_msg') {
          messageCount++;
          if (messageCount === 2) done();
        }
      };

      ws1.on('message', onMessage);
      ws2.on('message', onMessage);
      ws1.on('open', () => ws1.send(JSON.stringify({ type: 'register', workspaceId: 'shared-ws' })));
      ws2.on('open', () => ws2.send(JSON.stringify({ type: 'register', workspaceId: 'shared-ws' })));
    });

    test('sendWebSocketMessage should deduplicate messages', async () => {
      server.wsClients.set('test-ws', new Map([['c1', { 
        readyState: WebSocket.OPEN, 
        send: jest.fn(),
        terminate: jest.fn() 
      }]]));
      
      const first = server.sendWebSocketMessage('test-ws', { type: 'test', messageId: 'm1' });
      const second = server.sendWebSocketMessage('test-ws', { type: 'test', messageId: 'm1' });
      
      expect(first).toBe(true);
      expect(second).toBe(false);
    });

    test('sendWebSocketMessage should cleanup dead connections', async () => {
      const mockWs = { readyState: WebSocket.CLOSED, terminate: jest.fn() };
      server.wsClients.set('test-ws', new Map([['c1', mockWs]]));

      const result = server.sendWebSocketMessage('test-ws', { type: 'test', messageId: 'm1' });
      expect(result).toBe(false);
      expect(server.wsClients.has('test-ws')).toBe(false);
    });
  });

  describe('Hub Version & Capability Manifest (Issue #70)', () => {
    let wsUrl;
    const packageJson = require('../../package.json');

    const doGet = (pathname) => {
      return new Promise((resolve, reject) => {
        const req = http.get(`http://localhost:${testPort}${pathname}`, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode, data: data ? JSON.parse(data) : null });
            } catch (e) {
              reject(e);
            }
          });
        });
        req.on('error', reject);
      });
    };

    const waitForMessage = (ws, predicate) => new Promise((resolve, reject) => {
      const onMsg = (data) => {
        const msg = JSON.parse(data);
        if (predicate(msg)) {
          ws.off('message', onMsg);
          resolve(msg);
        }
      };
      ws.on('message', onMsg);
      ws.on('error', reject);
    });

    const registerAndCollect = async (workspaceId) => {
      const ws = createWebSocket(wsUrl);
      const messages = [];
      await new Promise((resolve, reject) => {
        ws.on('open', () => ws.send(JSON.stringify({ type: 'register', workspaceId })));
        ws.on('message', (data) => {
          const msg = JSON.parse(data);
          messages.push(msg);
          if (msg.type === 'registered') resolve();
        });
        ws.on('error', reject);
      });
      return { ws, messages };
    };

    test('GET /version exposes version, gitSha, startedAt, and capabilities', async () => {
      await server.start();
      wsUrl = `ws://localhost:${testPort + 1}`;

      const { status, data } = await doGet('/version');
      expect(status).toBe(200);
      expect(data.version).toBe(packageJson.version);
      expect(typeof data.gitSha).toBe('string');
      expect(data.gitSha.length).toBeGreaterThan(0);
      expect(data.startedAt).toBe(server.serverMetadata.startedAt);
      expect(data.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(Array.isArray(data.capabilities)).toBe(true);
      expect(data.capabilities).toContain('version-manifest-v1');
      expect(data.capabilities).toContain('durable-send-idempotency-v1');
    });

    test('GET /health includes capabilities without dropping existing fields', async () => {
      await server.start();
      jest.spyOn(server, 'callA2A').mockResolvedValue({ ok: true, data: [] });

      const { status, data } = await doGet('/health');
      expect(status).toBe(200);
      expect(data.status).toBe('hissing');
      expect(data.version).toBe(packageJson.version);
      expect(Array.isArray(data.capabilities)).toBe(true);
      expect(data.capabilities).toContain('version-manifest-v1');
    });

    test('WS "registered" ack carries version, gitSha, and capabilities', async () => {
      await server.start();
      wsUrl = `ws://localhost:${testPort + 1}`;

      const { messages } = await registerAndCollect('version-manifest-ws');
      const registered = messages.find((m) => m.type === 'registered');
      expect(registered.version).toBe(packageJson.version);
      expect(typeof registered.gitSha).toBe('string');
      expect(registered.capabilities).toEqual(expect.arrayContaining(['version-manifest-v1']));
    });

    test('does not announce hub.version_updated on a fresh registry with no prior recorded version', async () => {
      await server.start();
      wsUrl = `ws://localhost:${testPort + 1}`;

      expect(server.pendingVersionTransition).toBeNull();
      const { messages } = await registerAndCollect('fresh-ws');
      expect(messages.find((m) => m.type === 'hub.version_updated')).toBeUndefined();
    });

    test('detects a version transition recorded on a prior run and announces hub.version_updated to a reconnecting subscriber', async () => {
      await fs.writeFile(tempRegistryFile, JSON.stringify({
        workspaces: {},
        spawnApprovalCount: 0,
        offlineQueues: {},
        idempotencyRecords: {},
        lastKnownVersion: '0.0.1-prior-test-version'
      }));

      await server.start();
      wsUrl = `ws://localhost:${testPort + 1}`;

      expect(server.pendingVersionTransition).toBe('0.0.1-prior-test-version');

      const { messages } = await registerAndCollect('reconnecting-ws');
      const updated = messages.find((m) => m.type === 'hub.version_updated');
      expect(updated).toBeDefined();
      expect(updated.previousVersion).toBe('0.0.1-prior-test-version');
      expect(updated.version).toBe(packageJson.version);
      expect(typeof updated.gitSha).toBe('string');
      expect(updated.capabilities).toEqual(expect.arrayContaining(['version-manifest-v1']));
      expect(updated.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    test('broadcastToAllClients delivers to every open connection and skips closed ones', () => {
      const openWs = { readyState: WebSocket.OPEN, send: jest.fn() };
      const closedWs = { readyState: WebSocket.CLOSED, send: jest.fn() };
      server.wsClients.set('ws-a', new Map([['c1', openWs]]));
      server.wsClients.set('ws-b', new Map([['c2', closedWs]]));

      server.broadcastToAllClients({ type: 'hub.version_updated', version: '9.9.9' });

      expect(openWs.send).toHaveBeenCalledWith(JSON.stringify({ type: 'hub.version_updated', version: '9.9.9' }));
      expect(closedWs.send).not.toHaveBeenCalled();
    });

    test('detectVersionTransition reports unchanged when no prior version was recorded', () => {
      server.previousKnownVersion = null;
      expect(server.detectVersionTransition()).toEqual({ changed: false, previousVersion: null });
    });

    test('detectVersionTransition reports changed when the persisted version differs from the running version', () => {
      server.previousKnownVersion = 'some-older-version';
      const result = server.detectVersionTransition();
      expect(result.changed).toBe(true);
      expect(result.previousVersion).toBe('some-older-version');
    });
  });

  describe('At-Least-Once Delivery & ACK Semantics', () => {
    let wsUrl;

    const doPost = (pathname, body) => {
      return new Promise((resolve, reject) => {
        const req = http.request({
          hostname: 'localhost',
          port: testPort,
          path: pathname,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode, data: data ? JSON.parse(data) : null });
            } catch (e) {
              reject(e);
            }
          });
        });
        req.on('error', reject);
        if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
        req.end();
      });
    };

    beforeEach(async () => {
      await server.start();
      wsUrl = `ws://localhost:${testPort + 1}`;
      server.workspaceRegistry.set('ws-ack-test', { id: 'ws-ack-test', name: 'AckTest', path: '/p1', type: 'cursor' });
    });

    afterEach(async () => {
      await server.stop();
    });

    test('queued message survives and is redelivered without ACK, cleared with ACK', (done) => {
      // 1. Queue a message
      const msgPayload = {
        id: 'msg-ack-1',
        type: 'direct',
        from: 's1',
        to: 'ws-ack-test',
        message: 'testing at-least-once',
        timestamp: new Date().toISOString()
      };
      server.offlineQueues.set('ws-ack-test', [msgPayload]);

      // 2. Connect client first time (no ACK)
      let ws1 = createWebSocket(wsUrl);
      let messagesReceivedWs1 = [];

      ws1.on('open', () => {
        ws1.send(JSON.stringify({ type: 'register', workspaceId: 'ws-ack-test' }));
      });

      ws1.on('message', (data) => {
        const msg = JSON.parse(data);
        if (msg.type === 'new_message') {
          messagesReceivedWs1.push(msg.message);
          // Disconnect without sending ACK
          ws1.close();
        }
      });

      ws1.on('close', () => {
        expect(messagesReceivedWs1).toHaveLength(1);
        expect(messagesReceivedWs1[0].id).toBe('msg-ack-1');
        // Queue should still hold the message since it was not ACKed
        expect(server.offlineQueues.get('ws-ack-test')).toHaveLength(1);

        // 3. Connect client second time (will send ACK)
        let ws2 = createWebSocket(wsUrl);
        let messagesReceivedWs2 = [];

        ws2.on('open', () => {
          ws2.send(JSON.stringify({ type: 'register', workspaceId: 'ws-ack-test' }));
        });

        ws2.on('message', (data) => {
          const msg = JSON.parse(data);
          if (msg.type === 'new_message') {
            messagesReceivedWs2.push(msg.message);
            // Send WS ACK
            ws2.send(JSON.stringify({
              type: 'ack',
              messageIds: [msg.messageId]
            }));
          }
          if (msg.type === 'ack_response') {
            expect(msg.success).toBe(true);
            expect(msg.messageIds).toContain('msg-ack-1');
            ws2.close();
          }
        });

        ws2.on('close', () => {
          expect(messagesReceivedWs2).toHaveLength(1);
          expect(messagesReceivedWs2[0].id).toBe('msg-ack-1');
          // Queue should now be empty/deleted
          expect(server.offlineQueues.has('ws-ack-test')).toBe(false);
          done();
        });
      });
    });

    test('live-delivered message is retained in offlineQueues until ACKed, and redelivered on reconnect if not ACKed', (done) => {
      // 1. Setup online workspace
      let ws1 = createWebSocket(wsUrl);
      let liveMessages = [];

      ws1.on('open', () => {
        ws1.send(JSON.stringify({ type: 'register', workspaceId: 'ws-ack-test' }));
      });

      // We wait for registered confirmation, then trigger direct message
      ws1.on('message', async (data) => {
        const msg = JSON.parse(data);
        if (msg.type === 'registered') {
          // Send live message via HTTP POST
          jest.spyOn(server, 'callA2A').mockResolvedValue({ ok: true, status: 200, data: { id: 'msg-live-1' } });
          const sendRes = await doPost('/messages/direct', {
            from: 's1',
            to: 'ws-ack-test',
            message: 'live-delivered message'
          });
          expect(sendRes.status).toBe(200);
        }

        if (msg.type === 'new_message') {
          liveMessages.push(msg.message);
          // Verify that it is retained in the queue, even though it was delivered live!
          expect(server.offlineQueues.get('ws-ack-test')).toHaveLength(1);
          // Disconnect without ACKing
          ws1.close();
        }
      });

      ws1.on('close', () => {
        expect(liveMessages).toHaveLength(1);
        expect(liveMessages[0].message).toBe('live-delivered message');

        // Connect again to verify redelivery of the un-ACKed live-delivered message
        let ws2 = createWebSocket(wsUrl);
        let redeliveredMessages = [];

        ws2.on('open', () => {
          ws2.send(JSON.stringify({ type: 'register', workspaceId: 'ws-ack-test' }));
        });

        ws2.on('message', (data) => {
          const msg = JSON.parse(data);
          if (msg.type === 'new_message') {
            redeliveredMessages.push(msg.message);
            // Send WS ACK to clear it
            ws2.send(JSON.stringify({
              type: 'ack',
              messageIds: [msg.messageId]
            }));
          }
          if (msg.type === 'ack_response') {
            expect(msg.success).toBe(true);
            ws2.close();
          }
        });

        ws2.on('close', () => {
          expect(redeliveredMessages).toHaveLength(1);
          expect(redeliveredMessages[0].message).toBe('live-delivered message');
          // Queue should now be empty/deleted
          expect(server.offlineQueues.has('ws-ack-test')).toBe(false);
          done();
        });
      });
    });
  });

  describe('Dark Matter: Reliability & Edge Cases', () => {
    let wsUrl;

    beforeEach(async () => {
      await server.start();
      wsUrl = `ws://localhost:${testPort + 1}`;
    });

    test('should handle malformed WebSocket JSON', (done) => {
      const ws = createWebSocket(wsUrl);
      ws.on('open', () => {
        ws.send('not json');
      });
      ws.on('message', (data) => {
        const msg = JSON.parse(data);
        if (msg.type === 'error') {
          expect(msg.message).toContain('Unexpected token');
          done();
        }
      });
      ws.on('error', () => {});
    });

    test('WebSocket connection loss (EPIPE simulation)', async () => {
      let serverSideSocket;
      const rawWsServer = new WebSocket.Server({ port: 0 });
      const port = rawWsServer.address().port;
      
      rawWsServer.once('connection', (ws) => {
        serverSideSocket = ws;
      });

      const clientWs = createWebSocket(`ws://localhost:${port}`);
      await new Promise(r => clientWs.on('open', r));
      await new Promise(r => setImmediate(r));
      
      if (serverSideSocket && serverSideSocket._socket) {
        serverSideSocket._socket.destroy();
      }
      
      try {
        clientWs.send('hiss');
      } catch (e) {
        expect(e.code).toMatch(/EPIPE|ECONNRESET|ENOTCONN/);
      }
      
      await new Promise(r => rawWsServer.close(r));
    });

    test('Server.start should handle lock failure', async () => {
      ProcessLock.prototype.acquire.mockRejectedValue(new Error('Lock busy'));
      await expect(server.start()).rejects.toThrow('Lock busy');
    });

    test('MedusaServer.runCli and log/logError should prefix every physical line with an ISO 8601 timestamp (Issue #66)', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const mockProcess = {
        on: jest.fn(),
        exit: jest.fn()
      };
      const isoPrefixRegex = /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] /;

      // 0a. Direct Error object logged via MedusaServer.logError(new Error('fatal-test'))
      errorSpy.mockClear();
      MedusaServer.logError(new Error('fatal-test'));
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const directErrLines = errorSpy.mock.calls[0][0].split('\n');
      expect(directErrLines.length).toBeGreaterThan(1);
      expect(directErrLines[0]).toContain('Error: fatal-test');
      for (const line of directErrLines) {
        expect(line).toMatch(isoPrefixRegex);
      }

      // 0b. Error passed after a string prefix via MedusaServer.logError('Context:', new Error('boom'))
      errorSpy.mockClear();
      MedusaServer.logError('Error saving registry:', new Error('disk full'));
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const prefixedErrLines = errorSpy.mock.calls[0][0].split('\n');
      expect(prefixedErrLines.length).toBeGreaterThan(1);
      expect(prefixedErrLines[0]).toContain('Error saving registry: Error: disk full');
      for (const line of prefixedErrLines) {
        expect(line).toMatch(isoPrefixRegex);
      }

      // 0c. Multiline informational message via MedusaServer.log
      logSpy.mockClear();
      MedusaServer.log('\nfirst line\nsecond line');
      expect(logSpy).toHaveBeenCalledTimes(1);
      const infoLines = logSpy.mock.calls[0][0].split('\n');
      expect(infoLines).toHaveLength(2);
      for (const line of infoLines) {
        expect(line).toMatch(isoPrefixRegex);
      }

      // 1. Constructor failure path (missing A2A_SECRET in production mode)
      const originalNodeEnv = process.env.NODE_ENV;
      const originalSecret = process.env.A2A_SECRET;
      process.env.NODE_ENV = 'production';
      delete process.env.A2A_SECRET;

      try {
        errorSpy.mockClear();
        mockProcess.exit.mockClear();
        const res1 = await MedusaServer.runCli({}, mockProcess);
        expect(res1).toBeNull();
        expect(mockProcess.exit).toHaveBeenCalledWith(1);
        expect(errorSpy).toHaveBeenCalledTimes(1);
        const ctorErrLines = errorSpy.mock.calls[0][0].split('\n');
        expect(ctorErrLines.length).toBeGreaterThan(1);
        expect(ctorErrLines[0]).toContain('A2A_SECRET environment variable is required');
        for (const line of ctorErrLines) {
          expect(line).toMatch(isoPrefixRegex);
        }
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
        if (originalSecret !== undefined) {
          process.env.A2A_SECRET = originalSecret;
        }
      }

      // 2. Asynchronous server.start() rejection path
      errorSpy.mockClear();
      mockProcess.exit.mockClear();
      ProcessLock.prototype.acquire.mockRejectedValue(new Error('Fatal port/lock error'));

      const res2 = await MedusaServer.runCli(
        {
          protocolPort: testPort + 50,
          webPort: testWebPort + 50,
          workspaceRegistryFile: tempRegistryFile,
          a2aSecret: 'test-secret'
        },
        mockProcess
      );
      expect(res2).toBeNull();
      expect(mockProcess.exit).toHaveBeenCalledWith(1);
      expect(errorSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
      for (const call of errorSpy.mock.calls) {
        const lines = call[0].split('\n');
        expect(lines[0]).toContain('Fatal port/lock error');
        for (const line of lines) {
          expect(line).toMatch(isoPrefixRegex);
        }
      }
    });

    test('Server.stop should handle missing servers', async () => {
      // Should not throw
      await server.stop();
    });
  });

  describe('Durable Send Idempotency & Receipt Reconciliation (Issue #67 & #64)', () => {
    let wsUrl;

    const doRequest = (method, pathname, body = null, headers = {}) => {
      return new Promise((resolve, reject) => {
        const req = http.request({
          hostname: 'localhost',
          port: testPort,
          path: pathname,
          method,
          headers: {
            'Content-Type': 'application/json',
            ...headers
          }
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode, data: data ? JSON.parse(data) : null });
            } catch (e) {
              reject(e);
            }
          });
        });
        req.on('error', reject);
        if (body !== null && body !== undefined) {
          req.write(typeof body === 'string' ? body : JSON.stringify(body));
        }
        req.end();
      });
    };

    beforeEach(async () => {
      await server.start();
      wsUrl = `ws://localhost:${testPort + 1}`;
      server.workspaceRegistry.set('tc-target', {
        id: 'tc-target',
        name: 'TangleClawTarget',
        path: '/projects/tc',
        type: 'medusa',
        registeredAt: new Date(),
        lastSeen: new Date()
      });
      server.workspaceRegistry.set('other-target', {
        id: 'other-target',
        name: 'OtherTarget',
        path: '/projects/other',
        type: 'medusa',
        registeredAt: new Date(),
        lastSeen: new Date()
      });
    });

    afterEach(async () => {
      await server.stop();
    });

    test('persists idempotencyKey atomically with Hub enqueue and decouples A2A id from Hub id (#64, #67)', async () => {
      jest.spyOn(server, 'callA2A').mockResolvedValue({
        ok: true,
        status: 200,
        data: { id: 'a2a-ledger-id-999' }
      });

      const sendRes = await doRequest('POST', '/messages/direct', {
        from: 'tangleclaw-check-watch',
        to: 'tc-target',
        message: 'Check suite #2323 passed',
        idempotencyKey: 'cw-wake-2323'
      });

      expect(sendRes.status).toBe(200);
      expect(sendRes.data.success).toBe(true);
      expect(sendRes.data.replayed).toBe(false);
      expect(sendRes.data.idempotencyKey).toBe('cw-wake-2323');
      expect(sendRes.data.id).toBeDefined();
      expect(sendRes.data.id).not.toBe('a2a-ledger-id-999');
      expect(sendRes.data.receipt).toMatchObject({
        found: true,
        idempotencyKey: 'cw-wake-2323',
        id: sendRes.data.id,
        messageId: sendRes.data.id,
        from: 'tangleclaw-check-watch',
        to: 'tc-target',
        status: 'queued',
        queued: true,
        acked: false
      });

      const queue = server.offlineQueues.get('tc-target');
      expect(queue).toHaveLength(1);
      expect(queue[0].id).toBe(sendRes.data.id);
      expect(queue[0].a2aId).toBe('a2a-ledger-id-999');

      // Verify atomic persistence on disk
      const persisted = JSON.parse(await fs.readFile(tempRegistryFile, 'utf8'));
      expect(persisted.offlineQueues['tc-target']).toHaveLength(1);
      expect(persisted.offlineQueues['tc-target'][0].id).toBe(sendRes.data.id);
      expect(persisted.idempotencyRecords['cw-wake-2323']).toMatchObject({
        idempotencyKey: 'cw-wake-2323',
        messageId: sendRes.data.id,
        targetId: 'tc-target',
        message: 'Check suite #2323 passed'
      });
    });

    test('replaying the same idempotencyKey and identical recipient/payload returns original id without enqueueing a second message', async () => {
      jest.spyOn(server, 'callA2A').mockResolvedValue({ ok: false, status: 503 });

      const first = await doRequest('POST', '/messages/direct', {
        from: 'tangleclaw-check-watch',
        to: 'tc-target',
        message: 'Terminal check result: green',
        idempotencyKey: 'cw-replay-1'
      });
      expect(first.status).toBe(200);
      expect(first.data.replayed).toBe(false);

      // Replay via body idempotencyKey
      const second = await doRequest('POST', '/messages/direct', {
        from: 'tangleclaw-check-watch',
        to: 'tc-target',
        message: 'Terminal check result: green',
        idempotencyKey: 'cw-replay-1'
      });
      expect(second.status).toBe(200);
      expect(second.data.replayed).toBe(true);
      expect(second.data.id).toBe(first.data.id);
      expect(second.data.messageId).toBe(first.data.id);

      // Replay via Idempotency-Key HTTP header and workspace name
      const third = await doRequest(
        'POST',
        '/messages/direct',
        {
          from: 'tangleclaw-check-watch',
          to: 'TangleClawTarget',
          message: 'Terminal check result: green'
        },
        { 'Idempotency-Key': 'cw-replay-1' }
      );
      expect(third.status).toBe(200);
      expect(third.data.replayed).toBe(true);
      expect(third.data.id).toBe(first.data.id);

      // Only one message was ever enqueued
      expect(server.offlineQueues.get('tc-target')).toHaveLength(1);
    });

    test('reusing an idempotencyKey with a different recipient or payload is refused with 409 IDEMPOTENCY_KEY_CONFLICT', async () => {
      jest.spyOn(server, 'callA2A').mockResolvedValue({ ok: false, status: 503 });

      const initial = await doRequest('POST', '/messages/direct', {
        from: 'tangleclaw-check-watch',
        to: 'tc-target',
        message: 'Check passed',
        idempotencyKey: 'cw-conflict-key'
      });
      expect(initial.status).toBe(200);

      // Different payload
      const diffPayload = await doRequest('POST', '/messages/direct', {
        from: 'tangleclaw-check-watch',
        to: 'tc-target',
        message: 'Check FAILED',
        idempotencyKey: 'cw-conflict-key'
      });
      expect(diffPayload.status).toBe(409);
      expect(diffPayload.data.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
      expect(diffPayload.data.idempotencyKey).toBe('cw-conflict-key');

      // Different recipient
      const diffRecipient = await doRequest('POST', '/messages/direct', {
        from: 'tangleclaw-check-watch',
        to: 'other-target',
        message: 'Check passed',
        idempotencyKey: 'cw-conflict-key'
      });
      expect(diffRecipient.status).toBe(409);
      expect(diffRecipient.data.code).toBe('IDEMPOTENCY_KEY_CONFLICT');

      // Different sender
      const diffSender = await doRequest('POST', '/messages/direct', {
        from: 'different-sender',
        to: 'tc-target',
        message: 'Check passed',
        idempotencyKey: 'cw-conflict-key'
      });
      expect(diffSender.status).toBe(409);
      expect(diffSender.data.code).toBe('IDEMPOTENCY_KEY_CONFLICT');

      // Invalid/empty idempotencyKey
      const emptyKey = await doRequest('POST', '/messages/direct', {
        from: 'tangleclaw-check-watch',
        to: 'tc-target',
        message: 'Check passed',
        idempotencyKey: '   '
      });
      expect(emptyKey.status).toBe(400);
      expect(emptyKey.data.code).toBe('INVALID_IDEMPOTENCY_KEY');

      // Queue was not polluted by any rejected conflict
      expect(server.offlineQueues.get('tc-target')).toHaveLength(1);
      expect(server.offlineQueues.has('other-target')).toBe(false);
    });

    test('exposes read-only receipt lookup to reconcile unknown send outcome without creating a message', async () => {
      jest.spyOn(server, 'callA2A').mockResolvedValue({ ok: false, status: 503 });

      // 1. Unknown key returns 404 RECEIPT_NOT_FOUND and creates no message
      const missingRes = await doRequest('GET', '/messages/receipts/unknown-key-123');
      expect(missingRes.status).toBe(404);
      expect(missingRes.data).toMatchObject({
        found: false,
        code: 'RECEIPT_NOT_FOUND',
        idempotencyKey: 'unknown-key-123'
      });
      expect(server.offlineQueues.size).toBe(0);

      // 2. Send with idempotencyKey
      const sendRes = await doRequest('POST', '/messages/direct', {
        from: 'tc-sender',
        to: 'tc-target',
        message: 'Reconcile me',
        idempotencyKey: 'reconcile-key-1'
      });
      expect(sendRes.status).toBe(200);

      // 3. Lookup receipt via path and query parameter
      const lookupPath = await doRequest('GET', '/messages/receipts/reconcile-key-1');
      expect(lookupPath.status).toBe(200);
      expect(lookupPath.data).toMatchObject({
        found: true,
        idempotencyKey: 'reconcile-key-1',
        id: sendRes.data.id,
        messageId: sendRes.data.id,
        from: 'tc-sender',
        to: 'tc-target',
        status: 'queued',
        queued: true,
        acked: false
      });

      const lookupQuery = await doRequest('GET', '/messages/receipts?idempotencyKey=reconcile-key-1');
      expect(lookupQuery.status).toBe(200);
      expect(lookupQuery.data.id).toBe(sendRes.data.id);

      // 4. ACK the message and verify receipt transitions to acked
      await doRequest('POST', '/messages/ack', {
        workspaceId: 'tc-target',
        messageIds: [sendRes.data.id]
      });

      const lookupAcked = await doRequest('GET', '/messages/receipts/reconcile-key-1');
      expect(lookupAcked.status).toBe(200);
      expect(lookupAcked.data).toMatchObject({
        found: true,
        idempotencyKey: 'reconcile-key-1',
        id: sendRes.data.id,
        status: 'acked',
        queued: false,
        delivered: true,
        acked: true
      });
      expect(lookupAcked.data.ackedAt).toEqual(expect.any(String));
    });

    test('preserves accepted message and identity across Hub restart and hands off across session clear/relaunch', async () => {
      jest.spyOn(server, 'callA2A').mockResolvedValue({ ok: false, status: 503 });

      // 1. Live session connects before clear/relaunch
      const wsBeforeClear = createWebSocket(wsUrl);
      await new Promise((resolve, reject) => {
        wsBeforeClear.on('open', () => {
          wsBeforeClear.send(JSON.stringify({
            type: 'register',
            workspaceId: 'session-relaunch-ws',
            name: 'RelaunchSession'
          }));
        });
        wsBeforeClear.on('message', (raw) => {
          const msg = JSON.parse(raw);
          if (msg.type === 'registered') resolve();
        });
        wsBeforeClear.on('error', reject);
      });

      // 2. Session enters clear/relaunch (WebSocket disconnects) right as or before check-watch sends wake
      const closePromise = new Promise(resolve => wsBeforeClear.on('close', resolve));
      wsBeforeClear.close();
      await closePromise;
      await new Promise(r => setTimeout(r, 50));

      // Re-register workspace entry (as TangleClaw registry or pre-registered workspace) and enqueue idempotent wake
      server.workspaceRegistry.set('session-relaunch-ws', {
        id: 'session-relaunch-ws',
        name: 'RelaunchSession',
        path: '/projects/relaunch',
        type: 'medusa',
        registeredAt: new Date(),
        lastSeen: new Date()
      });

      const sendRes = await doRequest('POST', '/messages/direct', {
        from: 'tc-check-watch',
        to: 'session-relaunch-ws',
        message: 'Check #2323 complete: wake session',
        idempotencyKey: 'wake-across-restart-key'
      });
      expect(sendRes.status).toBe(200);
      const originalMessageId = sendRes.data.id;

      // 3. Simulate full Hub restart: stop server 1 and boot a brand new MedusaServer from tempRegistryFile
      await server.stop();

      server = new MedusaServer({
        protocolPort: testPort,
        webPort: testWebPort,
        workspaceRegistryFile: tempRegistryFile,
        a2aBaseUrl: 'http://localhost:3300',
        a2aSecret: 'test-secret'
      });
      jest.spyOn(server, 'callA2A').mockResolvedValue({ ok: false, status: 503 });
      await server.start();

      // 4. Verify receipt lookup and idempotent replay after Hub restart (even before session finishes relaunching)
      const receiptAfterRestart = await doRequest('GET', '/messages/receipts/wake-across-restart-key');
      expect(receiptAfterRestart.status).toBe(200);
      expect(receiptAfterRestart.data).toMatchObject({
        found: true,
        idempotencyKey: 'wake-across-restart-key',
        id: originalMessageId,
        status: 'queued',
        queued: true,
        acked: false
      });

      const replayAfterRestart = await doRequest('POST', '/messages/direct', {
        from: 'tc-check-watch',
        to: 'session-relaunch-ws',
        message: 'Check #2323 complete: wake session',
        idempotencyKey: 'wake-across-restart-key'
      });
      expect(replayAfterRestart.status).toBe(200);
      expect(replayAfterRestart.data.replayed).toBe(true);
      expect(replayAfterRestart.data.id).toBe(originalMessageId);
      expect(server.offlineQueues.get('session-relaunch-ws')).toHaveLength(1);

      // 5. Project session completes clear/relaunch and connects a fresh WebSocket to the restarted Hub
      const wsAfterRelaunch = createWebSocket(wsUrl);
      const deliveredToRelaunched = await new Promise((resolve, reject) => {
        wsAfterRelaunch.on('open', () => {
          wsAfterRelaunch.send(JSON.stringify({
            type: 'register',
            workspaceId: 'session-relaunch-ws',
            name: 'RelaunchSession'
          }));
        });
        wsAfterRelaunch.on('message', (raw) => {
          const msg = JSON.parse(raw);
          if (msg.type === 'new_message') {
            resolve(msg);
          }
        });
        wsAfterRelaunch.on('error', reject);
      });

      expect(deliveredToRelaunched.messageId).toBe(originalMessageId);
      expect(deliveredToRelaunched.message.id).toBe(originalMessageId);
      expect(deliveredToRelaunched.message.message).toBe('Check #2323 complete: wake session');
      expect(deliveredToRelaunched.message.idempotencyKey).toBe('wake-across-restart-key');

      // 6. Relaunched session ACKs the wake message; verify receipt transitions to acked and no duplicate is left
      await new Promise((resolve, reject) => {
        wsAfterRelaunch.on('message', (raw) => {
          const msg = JSON.parse(raw);
          if (msg.type === 'ack_response') {
            resolve(msg);
          }
        });
        wsAfterRelaunch.on('error', reject);
        wsAfterRelaunch.send(JSON.stringify({
          type: 'ack',
          messageIds: [originalMessageId]
        }));
      });

      expect(server.offlineQueues.has('session-relaunch-ws')).toBe(false);
      const finalReceipt = await doRequest('GET', '/messages/receipts/wake-across-restart-key');
      expect(finalReceipt.status).toBe(200);
      expect(finalReceipt.data).toMatchObject({
        found: true,
        id: originalMessageId,
        status: 'acked',
        queued: false,
        delivered: true,
        acked: true
      });
    });

    test('fails POST /messages/direct with 500 PERSISTENCE_FAILED and does not deliver or retain uncommitted state when disk persistence fails', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      jest.spyOn(server, 'callA2A').mockResolvedValue({ ok: true, status: 200, data: { id: 'a2a-should-not-run' } });
      const wsSendSpy = jest.spyOn(server, 'sendWebSocketMessage');

      // Connect a live WebSocket client for tc-target
      const mockWs = { readyState: WebSocket.OPEN, send: jest.fn(), terminate: jest.fn() };
      server.wsClients.set('tc-target', new Map([['c-fail', mockWs]]));

      // Point registry file under /dev/null so mkdir/write fails with EEXIST/ENOTDIR
      const validRegistryFile = server.workspaceRegistryFile;
      server.workspaceRegistryFile = '/dev/null/medusa-registry.json';

      const failRes = await doRequest('POST', '/messages/direct', {
        from: 'tc-check-watch',
        to: 'tc-target',
        message: 'Should fail when persistence fails',
        idempotencyKey: 'fail-persist-key-1'
      });

      expect(failRes.status).toBe(500);
      expect(failRes.data.code).toBe('PERSISTENCE_FAILED');
      expect(wsSendSpy).not.toHaveBeenCalled();
      expect(mockWs.send).not.toHaveBeenCalled();
      expect(server.offlineQueues.has('tc-target')).toBe(false);
      expect(server.idempotencyRecords.has('fail-persist-key-1')).toBe(false);

      const receiptRes = await doRequest('GET', '/messages/receipts/fail-persist-key-1');
      expect(receiptRes.status).toBe(404);

      // Restore valid registry path and verify rename failure also rolls back cleanly
      server.workspaceRegistryFile = validRegistryFile;
      jest.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('Simulated rename crash'));

      const renameFailRes = await doRequest('POST', '/messages/direct', {
        from: 'tc-check-watch',
        to: 'tc-target',
        message: 'Should fail when rename fails',
        idempotencyKey: 'fail-persist-key-2'
      });

      expect(renameFailRes.status).toBe(500);
      expect(renameFailRes.data.code).toBe('PERSISTENCE_FAILED');
      expect(wsSendSpy).not.toHaveBeenCalled();
      expect(server.offlineQueues.has('tc-target')).toBe(false);
      expect(server.idempotencyRecords.has('fail-persist-key-2')).toBe(false);
    });

    test('persists queue and idempotency key to disk strictly before live WebSocket delivery', async () => {
      jest.spyOn(server, 'callA2A').mockResolvedValue({ ok: false, status: 503 });

      const mockWs = { readyState: WebSocket.OPEN, send: jest.fn(), terminate: jest.fn() };
      server.wsClients.set('tc-target', new Map([['c-order', mockWs]]));

      const callOrder = [];
      let diskSnapshotAtWsDelivery = null;

      const origRename = fs.rename.bind(fs);
      jest.spyOn(fs, 'rename').mockImplementation(async (oldPath, newPath) => {
        await origRename(oldPath, newPath);
        callOrder.push('fs.rename');
      });

      const origSendWs = server.sendWebSocketMessage.bind(server);
      jest.spyOn(server, 'sendWebSocketMessage').mockImplementation((workspaceId, messageData) => {
        callOrder.push('sendWebSocketMessage');
        diskSnapshotAtWsDelivery = require('fs').readFileSync(tempRegistryFile, 'utf8');
        return origSendWs(workspaceId, messageData);
      });

      const sendRes = await doRequest('POST', '/messages/direct', {
        from: 'tc-check-watch',
        to: 'tc-target',
        message: 'Order of operations check',
        idempotencyKey: 'order-check-key-1'
      });

      expect(sendRes.status).toBe(200);
      expect(callOrder[0]).toBe('fs.rename');
      expect(callOrder.indexOf('fs.rename')).toBeLessThan(callOrder.indexOf('sendWebSocketMessage'));

      // Verify that at the exact instant sendWebSocketMessage was invoked, both the queue entry
      // and the idempotency record were already committed to tempRegistryFile on disk
      const parsedAtDelivery = JSON.parse(diskSnapshotAtWsDelivery);
      expect(parsedAtDelivery.offlineQueues['tc-target']).toHaveLength(1);
      expect(parsedAtDelivery.offlineQueues['tc-target'][0].id).toBe(sendRes.data.id);
      expect(parsedAtDelivery.idempotencyRecords['order-check-key-1']).toMatchObject({
        idempotencyKey: 'order-check-key-1',
        messageId: sendRes.data.id,
        targetId: 'tc-target',
        message: 'Order of operations check'
      });
    });

    test('concurrent replay waits for in-flight initial save and fails if the initial save rejects, never returning a false 200', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      jest.spyOn(server, 'callA2A').mockResolvedValue({ ok: false, status: 503 });

      const mockWs = { readyState: WebSocket.OPEN, send: jest.fn(), terminate: jest.fn() };
      server.wsClients.set('tc-target', new Map([['c-race', mockWs]]));

      // 1. Hold the first save pending via a deferred promise on performRegistrySave
      let saveEnteredResolve;
      const saveEntered = new Promise((resolve) => {
        saveEnteredResolve = resolve;
      });
      let rejectPendingSave;
      const saveSpy = jest.spyOn(server, 'performRegistrySave').mockImplementationOnce(() => {
        saveEnteredResolve();
        return new Promise((_resolve, reject) => {
          rejectPendingSave = reject;
        });
      });

      const firstReqPromise = doRequest('POST', '/messages/direct', {
        from: 'tc-check-watch',
        to: 'tc-target',
        message: 'Concurrent race wake',
        idempotencyKey: 'race-key-fail'
      });

      await saveEntered;

      // Synchronous receipt check while save is still pending must not report a committed receipt
      expect(server.getIdempotencyReceipt('race-key-fail')).toBeNull();

      let replaySettled = false;
      const replayReqPromise = doRequest('POST', '/messages/direct', {
        from: 'tc-check-watch',
        to: 'tc-target',
        message: 'Concurrent race wake',
        idempotencyKey: 'race-key-fail'
      }).then((res) => {
        replaySettled = true;
        return res;
      });

      // Conflicting key reuse while save is pending is still refused with 409
      const conflictWhilePending = await doRequest('POST', '/messages/direct', {
        from: 'tc-check-watch',
        to: 'tc-target',
        message: 'Different payload while pending',
        idempotencyKey: 'race-key-fail'
      });
      expect(conflictWhilePending.status).toBe(409);
      expect(conflictWhilePending.data.code).toBe('IDEMPOTENCY_KEY_CONFLICT');

      // Give the event loop a turn and verify replay has NOT settled while initial save is still pending
      await new Promise((r) => setTimeout(r, 30));
      expect(replaySettled).toBe(false);

      // Now reject the in-flight save
      rejectPendingSave(new Error('ENOSPC: no space left on device'));

      const [firstRes, replayRes] = await Promise.all([firstReqPromise, replayReqPromise]);
      expect(firstRes.status).toBe(500);
      expect(firstRes.data.code).toBe('PERSISTENCE_FAILED');
      expect(replayRes.status).toBe(500);
      expect(replayRes.data.code).toBe('PERSISTENCE_FAILED');
      expect(mockWs.send).not.toHaveBeenCalled();
      expect(server.offlineQueues.has('tc-target')).toBe(false);
      expect(server.idempotencyRecords.has('race-key-fail')).toBe(false);

      const receiptAfterReject = await doRequest('GET', '/messages/receipts/race-key-fail');
      expect(receiptAfterReject.status).toBe(404);

      // 2. Positive concurrent case: held save succeeds -> first gets 200 (replayed: false),
      // concurrent replay waits and gets 200 (replayed: true) with identical id
      saveSpy.mockRestore();
      const origPerformSave = server.performRegistrySave.bind(server);
      let saveEntered2Resolve;
      const saveEntered2 = new Promise((resolve) => {
        saveEntered2Resolve = resolve;
      });
      let resolvePendingSave2;
      jest.spyOn(server, 'performRegistrySave').mockImplementationOnce(async () => {
        saveEntered2Resolve();
        await new Promise((resolve) => {
          resolvePendingSave2 = resolve;
        });
        return origPerformSave();
      });

      const firstOkPromise = doRequest('POST', '/messages/direct', {
        from: 'tc-check-watch',
        to: 'tc-target',
        message: 'Concurrent race success',
        idempotencyKey: 'race-key-ok'
      });

      await saveEntered2;

      let replayOkSettled = false;
      const replayOkPromise = doRequest('POST', '/messages/direct', {
        from: 'tc-check-watch',
        to: 'tc-target',
        message: 'Concurrent race success',
        idempotencyKey: 'race-key-ok'
      }).then((res) => {
        replayOkSettled = true;
        return res;
      });

      await new Promise((r) => setTimeout(r, 30));
      expect(replayOkSettled).toBe(false);

      resolvePendingSave2();

      const [firstOkRes, replayOkRes] = await Promise.all([firstOkPromise, replayOkPromise]);
      expect(firstOkRes.status).toBe(200);
      expect(firstOkRes.data.replayed).toBe(false);
      expect(replayOkRes.status).toBe(200);
      expect(replayOkRes.data.replayed).toBe(true);
      expect(replayOkRes.data.id).toBe(firstOkRes.data.id);
      expect(server.offlineQueues.get('tc-target')).toHaveLength(1);
    });
  });
});
