/**
 * 🐍 Medusa Chat Protocol Server
 * 
 * Revolutionary server-based workspace coordination system
 * Replaces broken file-based messaging with professional HTTP/WebSocket architecture
 * 
 * Two medusas finally hissing at each other properly!
 */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const { EventEmitter } = require('events');
const os = require('os');
const WebSocket = require('ws');
const ProcessLock = require('../utils/ProcessLock');

// Load version from package.json dynamically
const packagePath = path.join(__dirname, '../../package.json');
const packageJson = require(packagePath);
const MEDUSA_VERSION = packageJson.version;

// Medusa Event Bus for real-time coordination
class MedusaEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100); // Support many workspace connections
  }
}

class MedusaServer {
  constructor(options = {}) {
    // Configuration
    this.protocolPort = options.protocolPort || 3009;
    this.webPort = options.webPort || 8181;
    this.workspaceRegistryFile = options.workspaceRegistryFile || path.join(os.homedir(), '.medusa', 'medusa-registry.json');
    this.a2aBaseUrl = options.a2aBaseUrl || 'http://localhost:3200';
    this.a2aSecret = options.a2aSecret || process.env.A2A_SECRET || 'medusa-please';

    // Server ownership tracking
    this.serverMetadata = {
      startedAt: new Date().toISOString(),
      startedFrom: process.cwd(),
      controllingWorkspace: null, // Will be set during startup
      pid: process.pid
    };

    // State
    this.eventBus = new MedusaEventBus();
    this.workspaceRegistry = new Map();
    this.messageHistory = [];
    this.maxMessageHistory = 1000;
    this.wsClients = new Map(); // WebSocket connections by workspace ID
    this.listenerStatus = new Map(); // Track listener heartbeats
    this.messageCache = new Map(); // Cache to prevent message loops

    // Server instances
    this.protocolServer = null;
    this.webServer = null;
    this.wsServer = null;
    this.processLock = null;
  }

  /**
   * Signs an A2A request using HMAC-SHA256
   * The signature payload is: timestamp + request path
   */
  signA2ARequest(pathname, secret) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const payload = `${timestamp}${pathname}`;
    const signature = crypto.createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
      
    return {
      'X-Medusa-Timestamp': timestamp,
      'X-Medusa-Signature': signature
    };
  }

  // Helper to call A2A Node
  async callA2A(method, endpoint, data = null) {
    return new Promise((resolve, reject) => {
      try {
        const url = new URL(endpoint, this.a2aBaseUrl);
        const options = {
          method: method,
          headers: {
            'Content-Type': 'application/json',
            ...this.signA2ARequest(url.pathname, this.a2aSecret)
          }
        };
        
        const req = http.request(url, options, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => {
            try {
              const parsedData = body.trim() === '' ? {} : JSON.parse(body);
              resolve({
                ok: res.statusCode >= 200 && res.statusCode < 300,
                status: res.statusCode,
                data: parsedData
              });
            } catch (error) {
              resolve({
                ok: false,
                status: res.statusCode,
                error: 'Parse error',
                data: { message: body }
              });
            }
          });
        });
        
        req.on('error', (err) => {
          resolve({
            ok: false,
            status: 503,
            error: 'A2A Connection Error',
            data: { message: err.message }
          });
        });

        if (data) req.write(JSON.stringify(data));
        req.end();
      } catch (error) {
        resolve({
          ok: false,
          status: 500,
          error: 'Request Error',
          data: { message: error.message }
        });
      }
    });
  }

  // Helper to read request body
  readRequestBody(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => body += chunk.toString());
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (error) {
          reject(error);
        }
      });
      req.on('error', reject);
    });
  }

  // Update listener heartbeat
  updateListenerHeartbeat(workspaceId, status = 'active') {
    this.listenerStatus.set(workspaceId, {
      lastHeartbeat: new Date(),
      status: status, // 'active', 'idle', 'error'
      autonomousMode: status === 'active',
      connectionCount: this.wsClients.has(workspaceId) ? this.wsClients.get(workspaceId).size : 0
    });
  }

  // Load workspace registry from disk
  async loadRegistry() {
    try {
      await fs.mkdir(path.dirname(this.workspaceRegistryFile), { recursive: true });
      const data = await fs.readFile(this.workspaceRegistryFile, 'utf8');
      const parsed = JSON.parse(data);
      
      for (const [id, workspace] of Object.entries(parsed)) {
        this.workspaceRegistry.set(id, {
          ...workspace,
          lastSeen: new Date(workspace.lastSeen),
          registeredAt: new Date(workspace.registeredAt)
        });
      }
      
      console.log(`🐍 Loaded ${this.workspaceRegistry.size} workspaces from registry`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('Error loading registry:', error);
      } else {
        console.log('🐍 Starting with fresh workspace registry');
      }
    }
  }

  // Save workspace registry to disk
  async saveRegistry() {
    try {
      const data = {};
      for (const [id, workspace] of this.workspaceRegistry) {
        data[id] = workspace;
      }
      
      await fs.writeFile(this.workspaceRegistryFile, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Error saving registry:', error);
    }
  }

  createProtocolServer() {
    return http.createServer(async (req, res) => {
      // Set CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Workspace-ID');
      
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }
      
      const url = new URL(req.url, `http://localhost:${this.protocolPort}`);
      const pathname = url.pathname;
      
      // Health check endpoint
      if (pathname === '/health' && req.method === 'GET') {
        try {
          const a2aHealth = await this.callA2A('GET', '/a2a/gossip/sync');
          const peers = await this.callA2A('GET', '/a2a/gossip/peers');
          const messages = await this.callA2A('GET', '/a2a/messages');
          
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            status: 'hissing',
            protocol: 'Medusa-A2A Bridge',
            version: MEDUSA_VERSION,
            workspaces: Array.isArray(peers.data) ? peers.data.length : 0,
            messages: Array.isArray(messages.data) ? messages.data.length : 0,
            uptime: process.uptime(),
            a2a_connected: a2aHealth.ok
          }));
        } catch (error) {
          res.statusCode = 200;
          res.end(JSON.stringify({ status: 'degraded', error: error.message }));
        }
        return;
      }

      // System telemetry endpoint
      if (pathname === '/telemetry' && req.method === 'GET') {
        try {
          const locks = await ProcessLock.getAllLocks();
          const peers = await this.callA2A('GET', '/a2a/gossip/peers');
          
          const telemetry = {
            timestamp: new Date().toISOString(),
            server: {
              pid: process.pid,
              uptime: process.uptime(),
              memory: process.memoryUsage(),
              version: MEDUSA_VERSION
            },
            processes: {
              locks: locks,
              zombieDust: locks.some(l => l.name.includes('zombie') || l.name.includes('loop')),
              conflicts: locks.filter(l => l.isStale || !l.isRunning),
              duplicates: locks.reduce((acc, lock) => {
                acc[lock.name] = (acc[lock.name] || 0) + 1;
                return acc;
              }, {})
            },
            a2a: {
              peers_count: Array.isArray(peers.data) ? peers.data.length : 0,
              peers: peers.data || []
            },
            connections: {
              totalConnections: Array.from(this.wsClients.values()).reduce((acc, conns) => acc + conns.size, 0),
              workspaces: this.wsClients.size
            },
            services: {
              medusaProtocol: 'running',
              a2aNode: 'bridge-active',
              webDashboard: 'running'
            },
            warnings: []
          };

          if (locks.some(l => l.isStale)) telemetry.warnings.push('Stale process locks detected');
          
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(telemetry, null, 2));
        } catch (error) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }

      // List all workspaces
      if (pathname === '/workspaces' && req.method === 'GET') {
        try {
          const mergedWorkspaces = new Map();
          
          for (const [id, ws] of this.workspaceRegistry) {
            mergedWorkspaces.set(id, {
              id: id,
              name: ws.name,
              path: ws.path,
              type: ws.type || 'medusa',
              status: 'idle',
              connected: false,
              registeredAt: ws.registeredAt,
              lastSeen: ws.lastSeen,
              connection: { webSocket: false, connectionCount: 0 },
              listener: { active: false, autonomousMode: false, lastHeartbeat: null }
            });
          }
          
          for (const [id, connections] of this.wsClients) {
            const status = this.listenerStatus.get(id) || { 
              status: 'active', 
              autonomousMode: true, 
              lastHeartbeat: new Date() 
            };
            
            const existing = mergedWorkspaces.get(id) || {
              id: id,
              name: id.split('-')[0],
              connected: true
            };
            
            mergedWorkspaces.set(id, {
              ...existing,
              status: status.status,
              connected: true,
              connection: { 
                webSocket: true, 
                connectionCount: connections.size 
              },
              listener: { 
                active: true, 
                autonomousMode: status.autonomousMode, 
                lastHeartbeat: status.lastHeartbeat 
              },
              autonomousConversationReady: status.status === 'active'
            });
          }
          
          const workspaces = Array.from(mergedWorkspaces.values());
          
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            workspaces,
            count: workspaces.length,
            telemetry: {
              autonomousConversationReady: workspaces.filter(w => w.connected).length,
              totalWorkspaces: workspaces.length,
              readinessPercentage: workspaces.length > 0 ? (workspaces.filter(w => w.connected).length / workspaces.length * 100) : 0
            }
          }));
        } catch (error) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }

      // Register a new workspace
      if (pathname === '/workspaces/register' && req.method === 'POST') {
        try {
          const data = await this.readRequestBody(req);
          const { name, path: workspacePath, type } = data;
          
          if (!name || !workspacePath) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Missing name or path' }));
            return;
          }
          
          const workspaceId = `${name.toLowerCase().replace(/\s+/g, '-')}-${crypto.randomBytes(4).toString('hex')}`;
          const now = new Date();
          
          const workspace = {
            id: workspaceId,
            name,
            path: workspacePath,
            type: type || 'medusa',
            registeredAt: now,
            lastSeen: now
          };
          
          this.workspaceRegistry.set(workspaceId, workspace);
          await this.saveRegistry();
          
          console.log(`🐍 Registered new workspace: ${name} (${workspaceId})`);
          
          res.statusCode = 201;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            success: true,
            message: 'Workspace registered successfully',
            workspace
          }));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }

      // Get messages for a specific workspace
      if (pathname.startsWith('/messages/workspace/') && req.method === 'GET') {
        try {
          const targetWorkspace = pathname.split('/')[3];
          const result = await this.callA2A('GET', '/a2a/messages');
          
          const messages = Array.isArray(result.data) ? result.data
            .filter(m => m.recipient_id === targetWorkspace || m.message_type === 'broadcast')
            .map(m => ({
              id: m.id,
              from: m.sender_id,
              to: m.recipient_id || '*',
              message: m.content,
              timestamp: m.received_at,
              type: m.message_type === 'broadcast' ? 'broadcast' : 'direct'
            })) : [];
          
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            workspaceId: targetWorkspace,
            messages,
            count: messages.length
          }));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }

      // Share context between workspaces
      if (pathname === '/context/share' && req.method === 'POST') {
        try {
          const data = await this.readRequestBody(req);
          const { from, context, targets } = data;
          
          console.log(`🧠 Context shared from ${from} to ${targets && targets.length > 0 ? targets.join(', ') : 'all'}`);
          
          const notification = {
            type: 'context_shared',
            from,
            context,
            timestamp: new Date().toISOString()
          };
          
          if (targets && targets.length > 0) {
            targets.forEach(targetId => this.sendWebSocketMessage(targetId, notification));
          } else {
            for (const id of this.wsClients.keys()) {
              if (id !== from) this.sendWebSocketMessage(id, notification);
            }
          }
          
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: true, message: 'Context shared' }));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }
      
      // Send direct message
      if (pathname === '/messages/direct' && req.method === 'POST') {
        try {
          const data = await this.readRequestBody(req);
          const result = await this.callA2A('POST', '/a2a/messages/send', {
            sender_id: data.from,
            recipient_id: data.to,
            content: data.message
          });
          
          if (result.ok && result.data && result.data.id) {
            this.sendWebSocketMessage(data.to, {
              type: 'direct',
              messageId: result.data.id,
              from: data.from,
              to: data.to,
              message: data.message,
              timestamp: result.data.received_at || new Date().toISOString()
            });
          }

          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: result.ok, ...result.data }));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }
      
      // Broadcast message
      if (pathname === '/messages/broadcast' && req.method === 'POST') {
        try {
          const data = await this.readRequestBody(req);
          const result = await this.callA2A('POST', '/a2a/messages/broadcast', {
            content: data.message
          });
          
          if (result.ok && result.data && result.data.id) {
            for (const workspaceId of this.wsClients.keys()) {
              this.sendWebSocketMessage(workspaceId, {
                type: 'broadcast',
                messageId: result.data.id,
                from: data.from || 'system',
                to: '*',
                message: data.message,
                timestamp: result.data.received_at || new Date().toISOString()
              });
            }
          }

          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: result.ok, ...result.data }));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }
      
      // Get recent messages
      if (pathname === '/messages/recent' && req.method === 'GET') {
        try {
          const messages = await this.callA2A('GET', '/a2a/messages');
          const formatted = Array.isArray(messages.data) ? messages.data.map(m => ({
            id: m.id,
            from: m.sender_id,
            fromName: m.sender_id ? m.sender_id.split('-')[0] : 'unknown',
            to: '*',
            message: m.content,
            timestamp: m.received_at,
            type: m.message_type === 'broadcast' ? 'broadcast' : 'direct'
          })) : [];
          
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            messages: formatted,
            count: formatted.length
          }));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }
      
      // List all peers
      if (pathname === '/mesh/peers' && req.method === 'GET') {
        try {
          const result = await this.callA2A('GET', '/a2a/gossip/peers');
          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ peers: result.data }));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }

      // Create a new task
      if (pathname === '/a2a/tasks' && req.method === 'POST') {
        try {
          const data = await this.readRequestBody(req);
          const result = await this.callA2A('POST', '/a2a/tasks', data);

          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result.data));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }

      // List all tasks/auctions
      if (pathname === '/auctions' && req.method === 'GET') {
        try {
          const result = await this.callA2A('GET', '/a2a/tasks');
          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ tasks: result.data }));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }

      // Get task tree
      if (pathname === '/a2a/tasks/tree' && req.method === 'GET') {
        try {
          const result = await this.callA2A('GET', '/a2a/tasks?limit=100');
          
          if (!result.ok) throw new Error(result.error || 'A2A Task retrieval failed');
          
          const tasks = result.data;
          if (!Array.isArray(tasks)) throw new Error('A2A returned non-array for tasks');

          const taskMap = new Map();
          const roots = [];
          
          tasks.forEach(task => {
            task.children = [];
            taskMap.set(task.id, task);
          });
          
          tasks.forEach(task => {
            if (task.parent_id && taskMap.has(task.parent_id)) {
              taskMap.get(task.parent_id).children.push(task);
            } else {
              roots.push(task);
            }
          });
          
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ tree: roots }));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }
      
      // Place bid on task
      if (pathname === '/auctions/bid' && req.method === 'POST') {
        try {
          const data = await this.readRequestBody(req);
          const result = await this.callA2A('POST', '/a2a/tasks/bid', data);
          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result.data));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }

      // Resolve auction
      if (pathname.startsWith('/auctions/') && pathname.endsWith('/resolve') && req.method === 'POST') {
        try {
          const taskId = pathname.split('/')[2];
          const result = await this.callA2A('POST', `/a2a/tasks/${taskId}/resolve_auction`);
          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result.data));
        } catch (error) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }

      // Get performance history
      if (pathname === '/a2a/performance/history' && req.method === 'GET') {
        try {
          const nodeId = url.searchParams.get('node_id') || 'global';
          const limit = url.searchParams.get('limit') || '50';
          const result = await this.callA2A('GET', `/a2a/performance/history?node_id=${nodeId}&limit=${limit}`);

          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result.data));
        } catch (error) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }

      // Approve task
      if (pathname.startsWith('/tasks/') && pathname.endsWith('/approve') && req.method === 'POST') {
        try {
          const taskId = pathname.split('/')[2];
          const result = await this.callA2A('POST', `/a2a/tasks/${taskId}/approve`);
          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result.data));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }

      // Reject task
      if (pathname.startsWith('/tasks/') && pathname.endsWith('/reject') && req.method === 'POST') {
        try {
          const taskId = pathname.split('/')[2];
          const result = await this.callA2A('POST', `/a2a/tasks/${taskId}/reject`);
          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result.data));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }

      // Default 404
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ 
        error: 'Not found',
        message: 'That endpoint doesn\'t exist, mortal!' 
      }));
    });
  }

  setupWebSocketHandlers() {
    this.wsServer.on('connection', (ws, req) => {
      console.log('🔌 WebSocket client connected');
      
      let workspaceId = null;
      let isRegistered = false;
      let connectionId = `conn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());
          
          if (message.type === 'register' && !isRegistered) {
            workspaceId = message.workspaceId;
            
            if (!this.wsClients.has(workspaceId)) {
              this.wsClients.set(workspaceId, new Map());
            }
            
            this.wsClients.get(workspaceId).set(connectionId, ws);
            isRegistered = true;
            this.updateListenerHeartbeat(workspaceId, 'active');
            
            ws.send(JSON.stringify({
              type: 'registered',
              workspaceId,
              connectionId,
              message: 'WebSocket connection established for real-time messaging'
            }));
            
            console.log(`🔌 WebSocket registered for workspace: ${workspaceId} (${connectionId})`);
          }
          
          if (message.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          }
          
          if (message.type === 'listener_heartbeat' && isRegistered) {
            const status = message.status || 'active';
            this.updateListenerHeartbeat(workspaceId, status);
            
            ws.send(JSON.stringify({ 
              type: 'heartbeat_ack', 
              timestamp: Date.now(),
              autonomousMode: status === 'active'
            }));
            
            console.log(`💓 Listener heartbeat from ${workspaceId}: ${status}`);
          }
          
        } catch (error) {
          console.error('WebSocket message error:', error);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'error', message: error.message }));
          }
        }
      });
      
      ws.on('close', () => {
        if (workspaceId && this.wsClients.has(workspaceId)) {
          const connections = this.wsClients.get(workspaceId);
          connections.delete(connectionId);
          if (connections.size === 0) this.wsClients.delete(workspaceId);
          console.log(`🔌 WebSocket disconnected for workspace: ${workspaceId} (${connectionId})`);
        }
      });
      
      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        if (workspaceId && this.wsClients.has(workspaceId)) {
          const connections = this.wsClients.get(workspaceId);
          connections.delete(connectionId);
          if (connections.size === 0) this.wsClients.delete(workspaceId);
        }
      });
    });
  }

  sendWebSocketMessage(workspaceId, messageData) {
    const messageKey = `${messageData.messageId || 'msg'}-${workspaceId}`;
    
    if (this.messageCache.has(messageKey)) return false;
    
    const connections = this.wsClients.get(workspaceId);
    if (connections && connections.size > 0) {
      let delivered = false;
      
      connections.forEach((ws, connId) => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify(messageData));
            delivered = true;
          } catch (error) {
            console.error(`WebSocket send error (${connId}):`, error);
            connections.delete(connId);
          }
        } else {
          connections.delete(connId);
        }
      });

      if (connections.size === 0) {
        this.wsClients.delete(workspaceId);
      }
      
      if (delivered) {
        this.messageCache.set(messageKey, Date.now());
        const cacheTimeout = process.env.NODE_ENV === 'test' ? 100 : 5 * 60 * 1000;
        setTimeout(() => this.messageCache.delete(messageKey), cacheTimeout);
        console.log(`🔌 Message delivered instantly via WebSocket to ${connections.size} connection(s)!`);
        return true;
      }
    }
    
    return false;
  }

  createWebServer() {
    return http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      
      const logoPath = path.join(__dirname, 'medusa-logo.svg');
      const pngLogoPath = path.join(__dirname, '../../medusa-logo.png');
      const altPngLogoPath = path.join(__dirname, 'medusa-logo.png');
      const jsPath = path.join(__dirname, 'dashboard.js');
      const htmlPath = path.join(__dirname, 'dashboard.html');

      if (req.url === '/medusa-logo.svg') {
        fs.readFile(logoPath, 'utf8')
          .then(content => {
            res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
            res.end(content);
          })
          .catch(() => {
            res.writeHead(404);
            res.end('Logo not found');
          });
        return;
      }
      
      if (req.url === '/medusa-logo.png') {
        fs.readFile(pngLogoPath)
          .catch(() => fs.readFile(altPngLogoPath))
          .then(content => {
            res.writeHead(200, { 'Content-Type': 'image/png' });
            res.end(content);
          })
          .catch(() => {
            res.writeHead(404);
            res.end('PNG Logo not found');
          });
        return;
      }
      
      if (req.url.startsWith('/dashboard.js')) {
        fs.readFile(jsPath, 'utf8')
          .then(content => {
            res.writeHead(200, { 
              'Content-Type': 'application/javascript',
              'Cache-Control': 'no-cache'
            });
            res.end(content);
          })
          .catch(() => {
            res.writeHead(404);
            res.end('Dashboard JavaScript not found');
          });
        return;
      }
      
      if (req.url === '/' || req.url === '/index.html' || req.url === '/dashboard') {
        fs.readFile(htmlPath, 'utf8')
          .then(content => {
            res.writeHead(200, { 
              'Content-Type': 'text/html',
              'Cache-Control': 'no-cache'
            });
            res.end(content);
          })
          .catch(error => {
            res.writeHead(500);
            res.end('Dashboard HTML not found: ' + error.message);
          });
      } else {
        res.statusCode = 404;
        res.end('Not found');
      }
    });
  }

  async start() {
    console.log('🐍 Starting Medusa Chat Protocol...');
    
    try {
      await ProcessLock.cleanupStaleLocks();
      this.processLock = new ProcessLock('medusa-server');
      await this.processLock.acquire();
      
      const cwd = process.cwd();
      this.serverMetadata.controllingWorkspace = path.basename(cwd);
      console.log(`🎮 Server controlled by workspace: ${this.serverMetadata.controllingWorkspace}`);
      
      await this.loadRegistry();
      
      this.protocolServer = this.createProtocolServer();
      await new Promise(resolve => this.protocolServer.listen(this.protocolPort, resolve));
      
      console.log(`🐍 Medusa Protocol API running at http://localhost:${this.protocolPort}`);
      
      this.wsServer = new WebSocket.Server({ port: this.protocolPort + 1 });
      this.setupWebSocketHandlers();
      
      this.webServer = this.createWebServer();
      await new Promise(resolve => this.webServer.listen(this.webPort, resolve));
      
      console.log(`🐍 Switchboard running at http://localhost:${this.webPort}`);
      console.log(`🔌 WebSocket Server running at ws://localhost:${this.protocolPort + 1}`);
      console.log('\nThe two medusas are ready to hiss properly! 🐍🔥🐍');
      
      return true;
    } catch (error) {
      console.error(`❌ Failed to start Medusa server: ${error.message}`);
      if (this.processLock) await this.processLock.release();
      throw error;
    }
  }

  async stop() {
    console.log('\n🐍 Medusa shutting down...');
    
    if (this.processLock) await this.processLock.release();
    await this.saveRegistry();
    
    const closures = [];
    if (this.protocolServer) closures.push(new Promise(r => this.protocolServer.close(r)));
    if (this.webServer) closures.push(new Promise(r => this.webServer.close(r)));
    if (this.wsServer) {
      for (const connections of this.wsClients.values()) {
        for (const ws of connections.values()) {
          if (typeof ws.terminate === 'function') {
            ws.terminate();
          } else if (typeof ws.close === 'function') {
            ws.close();
          }
        }
      }
      closures.push(new Promise(r => this.wsServer.close(r)));
    }
    
    await Promise.all(closures);
    console.log('🐍 Shutdown complete.');
  }
}

// Start the servers if run directly
if (require.main === module) {
  const server = new MedusaServer();
  server.start().catch(err => {
    console.error(err);
    process.exit(1);
  });

  process.on('SIGINT', async () => {
    await server.stop();
    process.exit(0);
  });
}

// Export for testing
module.exports = MedusaServer;
