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
