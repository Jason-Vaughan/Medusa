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
      expect(spy).toHaveBeenCalledWith('Error saving registry:', expect.any(Error));
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

    test('POST /messages/broadcast should bridge to A2A and notify all WS', async () => {
      jest.spyOn(server, 'callA2A').mockResolvedValue({ 
        ok: true, 
        status: 200,
        data: { id: 'm1' } 
      });
      const mockWs = { readyState: WebSocket.OPEN, send: jest.fn() };
      server.wsClients.set('w1', new Map([['c1', mockWs]]));
      
      const { status } = await doPost('/messages/broadcast', { from: 's1', message: 'hello all' });
      expect(status).toBe(200);
      expect(mockWs.send).toHaveBeenCalled();
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

    test('should handle listener heartbeats', (done) => {
      const ws = createWebSocket(wsUrl);
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'register', workspaceId: 'test-ws' }));
      });
      ws.on('message', (data) => {
        const msg = JSON.parse(data);
        if (msg.type === 'registered') {
          ws.send(JSON.stringify({ type: 'listener_heartbeat', status: 'idle' }));
        }
        if (msg.type === 'heartbeat_ack') {
          expect(server.listenerStatus.get('test-ws').status).toBe('idle');
          done();
        }
      });
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

    test('Server.stop should handle missing servers', async () => {
      // Should not throw
      await server.stop();
    });
  });
});
