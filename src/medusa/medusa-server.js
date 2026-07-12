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
const { spawn } = require('child_process');
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
    this.protocolPort = options.protocolPort || parseInt(process.env.MEDUSA_PROTOCOL_PORT) || 3009;
    this.protocolHost = options.protocolHost || process.env.MEDUSA_PROTOCOL_HOST || '127.0.0.1';
    this.webPort = options.webPort || parseInt(process.env.MEDUSA_WEB_PORT) || 8181;
    this.webHost = options.webHost || process.env.MEDUSA_WEB_HOST || '127.0.0.1';
    this.workspaceRegistryFile = options.workspaceRegistryFile || path.join(os.homedir(), '.medusa', 'medusa-registry.json');
    this.a2aBaseUrl = options.a2aBaseUrl || process.env.A2A_BASE_URL || 'http://localhost:3200';
    this.a2aSecret = options.a2aSecret || process.env.A2A_SECRET;
    if (!this.a2aSecret) {
      if (process.env.NODE_ENV === 'test') {
        this.a2aSecret = 'medusa-please';
      } else {
        throw new Error('A2A_SECRET environment variable is required to start Medusa Hub!');
      }
    }

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
    this.offlineQueues = new Map(); // Queue of offline messages for workspaces

    // Swarm Management State (Chunk 34)
    this.lastSpawnTime = 0;
    this.spawnApprovalCount = 0;
    this.spawnApprovalGateLiftsAt = 5;
    this.pendingSpawnRequests = []; // HITL queue
    this.spawnPortRange = { min: 4220, max: 4239 };
    this.lastContractTime = 0;
    this.spawnedChildrenExpected = new Set(); // node_ids we have spawned and expect to be alive
    this.spawnReconcilerInterval = null;

    // Server instances
    this.protocolServer = null;
    this.webServer = null;
    this.wsServer = null;
    this.processLock = null;
    this.loops = new Map();
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

  /**
   * Verifies an A2A request signature using HMAC-SHA256
   */
  verifyA2ASignature(headers, pathname) {
    const timestamp = headers['x-medusa-timestamp'];
    const signature = headers['x-medusa-signature'];
    
    if (!timestamp || !signature) return false;
    
    // Replay protection: 5 minute window
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp)) > 300) return false;
    
    const payload = `${timestamp}${pathname}`;
    const expectedSignature = crypto.createHmac('sha256', this.a2aSecret)
      .update(payload)
      .digest('hex');
      
    try {
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
    } catch (e) {
      return false;
    }
  }

  /**
   * Finds an available port in the dedicated range using TangleClaw PortHub
   */
  async getAvailablePortFromTangleClaw() {
    const tangleClawUrl = 'http://localhost:3102/api/ports';
    const http = require('http');
    
    return new Promise((resolve, reject) => {
      const url = new URL(tangleClawUrl);
      const options = {
        method: 'GET'
      };
      
      const req = http.request(url, options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            const takenPorts = new Set(data.leases.map(l => l.port));
            
            for (let port = this.spawnPortRange.min; port <= this.spawnPortRange.max; port++) {
              if (!takenPorts.has(port)) {
                resolve(port);
                return;
              }
            }
            reject(new Error(`No available ports in dedicated range ${this.spawnPortRange.min}-${this.spawnPortRange.max}`));
          } catch (e) {
            reject(new Error(`Failed to parse TangleClaw response: ${e.message}`));
          }
        });
      });
      
      req.on('error', (e) => reject(new Error(`TangleClaw connection failed: ${e.message}`)));
      req.end();
    });
  }

  /**
   * Spawns a new A2A Node child process
   */
  async spawnA2ANode(port) {
    const a2aPath = path.join(__dirname, '..', 'a2a_node', 'main.py');
    const venvPython = path.join(__dirname, '..', 'a2a_node', 'venv', 'bin', 'python');
    const pythonCmd = require('fs').existsSync(venvPython) ? venvPython : 'python3';
    
    const nodeId = `${this.serverMetadata.controllingWorkspace}-spawned-${port}`;
    console.log(`🚀 Spawning A2A Node: ${nodeId} on port ${port}`);
    
    const a2aProcess = spawn(pythonCmd, [a2aPath], {
      detached: true,
      stdio: 'ignore',
      env: { 
        ...process.env, 
        A2A_PORT: port,
        A2A_PROJECT_NAME: `${this.serverMetadata.controllingWorkspace}-spawned`,
        A2A_NODE_TYPE: 'spawned',
        A2A_SECRET: this.a2aSecret,
        AUTO_TERM_UPTIME_FLOOR: process.env.AUTO_TERM_UPTIME_FLOOR || '900',
        AUTO_TERM_IDLE_TIMEOUT: process.env.AUTO_TERM_IDLE_TIMEOUT || '600',
        TASK_JANITOR_INTERVAL: process.env.TASK_JANITOR_INTERVAL || '60',
        PERFORMANCE_MONITOR_INTERVAL: process.env.PERFORMANCE_MONITOR_INTERVAL || '60',
        MEDUSA_PROTOCOL_PORT: process.env.MEDUSA_PROTOCOL_PORT || '3009',
        MEDUSA_PROTOCOL_HOST: process.env.MEDUSA_PROTOCOL_HOST || '127.0.0.1'
      }
    });
    
    a2aProcess.unref();
    this.lastSpawnTime = Date.now();
    this.spawnedChildrenExpected.add(nodeId);
    
    // Log telemetry
    this.messageHistory.push({
      id: `sys-${Date.now()}`,
      from: 'system',
      to: 'dashboard',
      message: `mesh.expand.executed: ${nodeId} on port ${port}`,
      timestamp: new Date().toISOString(),
      type: 'telemetry'
    });

    // Monitor for success to lift HITL gate
    if (this.spawnApprovalCount < this.spawnApprovalGateLiftsAt) {
      this.pollForSpawnSuccess(nodeId);
    }
    
    return nodeId;
  }

  /**
   * Polls the gossip mesh until the new node is active
   */
  async pollForSpawnSuccess(nodeId, attempts = 0) {
    if (attempts > 12) return; // 1 minute timeout (5s * 12)
    
    try {
      const result = await this.callA2A('GET', '/a2a/gossip/peers');
      if (result.ok && Array.isArray(result.data)) {
        const node = result.data.find(p => p.id === nodeId && p.status === 'active');
        if (node) {
          console.log(`✅ Spawned node ${nodeId} is now active. Incrementing approval count.`);
          this.spawnApprovalCount++;
          await this.saveRegistry();
          return;
        }
      }
    } catch (e) {
      // Ignore polling errors
    }
    
    setTimeout(() => this.pollForSpawnSuccess(nodeId, attempts + 1), 5000);
  }

  /**
   * Diffs spawnedChildrenExpected against the live gossip mesh; emits
   * mesh.contract.crashed for any expected child that no longer appears
   * in gossip with an active status. Major #5 fix.
   */
  async reconcileSpawnedChildren() {
    try {
      const result = await this.callA2A('GET', '/a2a/gossip/peers');
      if (!result.ok || !Array.isArray(result.data)) return;
      
      const liveIds = new Set(
        result.data
          .filter(p => p.status === 'active' && p.id.includes('-spawned-'))
          .map(p => p.id)
      );
      
      for (const expectedId of [...this.spawnedChildrenExpected]) {
        if (!liveIds.has(expectedId)) {
          console.log(`📉 Detected crashed spawned child: ${expectedId}`);
          this.messageHistory.push({
            id: `sys-${Date.now()}`,
            from: 'system',
            to: 'dashboard',
            message: `mesh.contract.crashed: ${expectedId}`,
            timestamp: new Date().toISOString(),
            type: 'telemetry',
          });
          this.spawnedChildrenExpected.delete(expectedId);
        }
      }
    } catch (e) {
      console.error('reconcileSpawnedChildren error:', e.message);
    }
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
      
      // Handle both old format (direct map) and new format (nested)
      const workspaces = parsed.workspaces || parsed;
      for (const [id, workspace] of Object.entries(workspaces)) {
        if (id === 'spawnApprovalCount') continue;
        
        // Guard "test-id" behind NODE_ENV === 'test'
        if (id === 'test-id' && process.env.NODE_ENV !== 'test') {
          continue;
        }

        this.workspaceRegistry.set(id, {
          ...workspace,
          lastSeen: new Date(workspace.lastSeen),
          registeredAt: new Date(workspace.registeredAt)
        });
      }

      this.spawnApprovalCount = parsed.spawnApprovalCount || 0;
      
      // Reap any stale workspaces loaded from disk
      this.reapStaleWorkspaces();
      
      console.log(`🐍 Loaded ${this.workspaceRegistry.size} workspaces from registry (Spawn count: ${this.spawnApprovalCount})`);
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
      const registry = {
        workspaces: Object.fromEntries(this.workspaceRegistry),
        spawnApprovalCount: this.spawnApprovalCount
      };
      
      await fs.writeFile(this.workspaceRegistryFile, JSON.stringify(registry, null, 2));
    } catch (error) {
      console.error('Error saving registry:', error);
    }
  }

  // Reap stale disconnected workspaces based on lastSeen TTL
  reapStaleWorkspaces() {
    const now = Date.now();
    // Default TTL: 5 minutes. In test mode: 5 seconds.
    const ttl = process.env.NODE_ENV === 'test' ? 5000 : 5 * 60 * 1000;
    let changed = false;

    for (const [id, ws] of this.workspaceRegistry) {
      // Never reap if it's currently connected via WebSocket
      if (this.wsClients.has(id)) {
        continue;
      }
      
      // Never reap the test-id in test mode
      if (id === 'test-id' && process.env.NODE_ENV === 'test') {
        continue;
      }

      const lastSeenTime = ws.lastSeen ? new Date(ws.lastSeen).getTime() : now;
      if (now - lastSeenTime > ttl) {
        this.workspaceRegistry.delete(id);
        changed = true;
        console.log(`🧹 TTL-expired and reaped stale workspace: ${id}`);
      }
    }

    if (changed) {
      this.saveRegistry();
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
            history: this.messageHistory,
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
          this.reapStaleWorkspaces();
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
      
      // Deregister/Delete a workspace
      if (pathname.startsWith('/workspaces/') && req.method === 'DELETE') {
        try {
          const workspaceId = pathname.split('/')[2];
          if (this.workspaceRegistry.has(workspaceId)) {
            this.workspaceRegistry.delete(workspaceId);
            await this.saveRegistry();
            console.log(`🧹 Deregistered/Deleted workspace: ${workspaceId}`);
            
            // Also cleanup active WebSocket connections
            if (this.wsClients.has(workspaceId)) {
              const connections = this.wsClients.get(workspaceId);
              for (const ws of connections.values()) {
                ws.close();
              }
              this.wsClients.delete(workspaceId);
            }
            
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, message: `Workspace ${workspaceId} deregistered successfully.` }));
          } else {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: `Workspace ${workspaceId} not found.` }));
          }
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
          
          let messages = Array.isArray(result.data) ? result.data
            .filter(m => m.recipient_id === targetWorkspace || m.message_type === 'broadcast')
            .map(m => ({
              id: m.id,
              from: m.sender_id,
              to: m.recipient_id || '*',
              message: m.content,
              timestamp: m.received_at,
              type: m.message_type === 'broadcast' ? 'broadcast' : 'direct'
            })) : [];
          
          if (this.offlineQueues.has(targetWorkspace)) {
            const queuedMsgs = this.offlineQueues.get(targetWorkspace);
            messages = messages.concat(queuedMsgs);
            // Non-destructive read: do not delete here. Messages survive until explicitly ACK'd.
          }
          
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
          
          const isOnline = this.wsClients.has(data.to);
          const isRegistered = this.workspaceRegistry.has(data.to) || isOnline;
          
          if (!isRegistered) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: `Peer/Workspace ${data.to} not found.` }));
            return;
          }
          
          let directDelivered = false;
          let generatedId = crypto.randomUUID();
          const timestamp = new Date().toISOString();
          
          const msgPayload = {
            id: generatedId,
            type: 'direct',
            from: data.from,
            to: data.to,
            message: data.message,
            timestamp: timestamp
          };
          
          // Always queue in offlineQueues (durable inbox) until explicitly ACK'd
          if (!this.offlineQueues.has(data.to)) {
            this.offlineQueues.set(data.to, []);
          }
          this.offlineQueues.get(data.to).push(msgPayload);

          if (isOnline) {
            this.sendWebSocketMessage(data.to, {
              type: 'new_message',
              messageId: generatedId,
              message: msgPayload
            });
            directDelivered = true;
          }
          
          // Also attempt to propagate through the A2A mesh (fails gracefully if node is down)
          const result = await this.callA2A('POST', '/a2a/messages/send', {
            sender_id: data.from,
            recipient_id: data.to,
            content: data.message
          }).catch(() => ({ ok: false, status: 503 }));
          
          if (result.ok && result.data && result.data.id) {
            msgPayload.id = result.data.id;
          }

          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ 
            success: true, 
            status: isOnline ? 'received' : 'queued', 
            id: msgPayload.id, 
            message: isOnline 
              ? 'Message delivered directly to workspace via WebSocket.' 
              : 'Workspace offline. Message queued in Hub inbox.'
          }));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }

      // Acknowledge messages (non-destructive queue support)
      if (pathname === '/messages/ack' && req.method === 'POST') {
        try {
          const data = await this.readRequestBody(req);
          const { workspaceId, messageIds } = data;
          
          if (!workspaceId || !messageIds) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Missing required fields (workspaceId, messageIds)' }));
            return;
          }
          
          const ids = Array.isArray(messageIds) ? messageIds : [messageIds];
          this.ackMessages(workspaceId, ids);
          
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: true, acked: ids }));
        } catch (error) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
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
                type: 'new_message',
                messageId: result.data.id,
                message: {
                  id: result.data.id,
                  type: 'broadcast',
                  from: data.from || 'system',
                  to: '*',
                  message: data.message,
                  timestamp: result.data.received_at || new Date().toISOString()
                }
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
      
      // Open a loop
      if (pathname === '/loops' && req.method === 'POST') {
        try {
          const data = await this.readRequestBody(req);
          const { initiator, target, task, doneCriteria, mode, guards } = data;
          
          if (!initiator || !target || !task || !doneCriteria) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Missing required loop fields (initiator, target, task, doneCriteria)' }));
            return;
          }
          
          // Verify workspaces exist
          const initiatorExists = this.workspaceRegistry.has(initiator) || this.wsClients.has(initiator);
          const targetExists = this.workspaceRegistry.has(target) || this.wsClients.has(target);
          if (!initiatorExists || !targetExists) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Initiator or target workspace not found' }));
            return;
          }
          
          const loopId = crypto.randomUUID();
          const now = new Date();
          const loopObj = {
            id: loopId,
            initiator,
            target,
            task,
            doneCriteria,
            mode: mode || 'supervised',
            guards: guards || { maxRounds: 10, maxWallTimeSeconds: 600 },
            round: 0,
            state: 'initiated',
            closeSignal: null,
            createdAt: now.toISOString()
          };
          
          this.loops.set(loopId, loopObj);
          
          res.statusCode = 201;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(loopObj));
        } catch (error) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }
      
      // Loop operations (GET state, POST message, POST close)
      if (pathname.startsWith('/loops/')) {
        const parts = pathname.split('/');
        const loopId = parts[2];
        const action = parts[3]; // undefined for GET /loops/:id, 'message' or 'close' for POSTs
        
        if (!this.loops.has(loopId)) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: `Loop ${loopId} not found` }));
          return;
        }
        
        const loop = this.loops.get(loopId);
        
        // Helper to check wall time guard before any operation
        const checkWallTimeGuard = () => {
          if (loop.state !== 'complete' && loop.state !== 'halted') {
            const elapsed = (Date.now() - new Date(loop.createdAt).getTime()) / 1000;
            if (loop.guards && loop.guards.maxWallTimeSeconds && elapsed > loop.guards.maxWallTimeSeconds) {
              loop.state = 'halted';
              this.loops.set(loopId, loop);
              
              // Push telemetry message
              this.messageHistory.push({
                id: `sys-loop-halt-${Date.now()}`,
                from: 'system',
                to: 'dashboard',
                message: `loop.halted.timeout: ${loopId} (elapsed: ${elapsed}s)`,
                timestamp: new Date().toISOString(),
                type: 'telemetry'
              });
              return true;
            }
          }
          return false;
        };
        
        checkWallTimeGuard();
        
        // 1. Read loop state (GET /loops/:id)
        if (!action && req.method === 'GET') {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(loop));
          return;
        }
        
        // 2. Post a round message (POST /loops/:id/message)
        if (action === 'message' && req.method === 'POST') {
          try {
            const data = await this.readRequestBody(req);
            const { from, message } = data;
            
            if (!from || !message) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Missing required message fields (from, message)' }));
              return;
            }
            
            if (loop.state === 'complete' || loop.state === 'halted') {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: `Loop is already in ${loop.state} state` }));
              return;
            }
            
            // Validate sender
            if (from !== loop.initiator && from !== loop.target) {
              res.statusCode = 403;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Sender is not a participant in this loop' }));
              return;
            }
            
            // Validate state progression (who can send when)
            if (loop.state === 'initiated' && from !== loop.target) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Initiated loop expects target response first' }));
              return;
            }
            if (loop.state === 'responded' && from !== loop.initiator) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Responded loop expects initiator message to continue' }));
              return;
            }
            if (loop.state === 'continue' && from !== loop.target) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Continued loop expects target response' }));
              return;
            }
            
            // Increment round
            loop.round += 1;
            
            // Transition state
            if (from === loop.target) {
              loop.state = 'responded';
            } else {
              loop.state = 'continue';
            }
            
            // Deliver the message to the other participant
            const recipient = from === loop.initiator ? loop.target : loop.initiator;
            const isOnline = this.wsClients.has(recipient);
            const msgId = crypto.randomUUID();
            const timestamp = new Date().toISOString();
            
            const msgPayload = {
              id: msgId,
              type: 'direct',
              from: from,
              to: recipient,
              message: message,
              timestamp: timestamp,
              loopId: loopId
            };
            
            // Always queue in offlineQueues (durable inbox) until explicitly ACK'd
            if (!this.offlineQueues.has(recipient)) {
              this.offlineQueues.set(recipient, []);
            }
            this.offlineQueues.get(recipient).push(msgPayload);

            if (isOnline) {
              this.sendWebSocketMessage(recipient, {
                type: 'new_message',
                messageId: msgId,
                message: msgPayload
              });
            }
            
            // Check maxRounds guard after incrementing
            if (loop.guards && loop.guards.maxRounds && loop.round >= loop.guards.maxRounds) {
              loop.state = 'halted';
              // Push telemetry message
              this.messageHistory.push({
                id: `sys-loop-halt-${Date.now()}`,
                from: 'system',
                to: 'dashboard',
                message: `loop.halted.max_rounds: ${loopId} (round: ${loop.round})`,
                timestamp: new Date().toISOString(),
                type: 'telemetry'
              });
            }
            
            this.loops.set(loopId, loop);
            
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              success: true,
              loopState: loop.state,
              round: loop.round,
              messageId: msgId,
              delivered: isOnline
            }));
          } catch (error) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: error.message }));
          }
          return;
        }
        
        // 3. Close the loop (POST /loops/:id/close)
        if (action === 'close' && req.method === 'POST') {
          try {
            const data = await this.readRequestBody(req);
            const { from, closeSignal } = data;
            
            if (!from || !closeSignal) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Missing required close fields (from, closeSignal)' }));
              return;
            }
            
            // ONLY the initiator may close the loop
            if (from !== loop.initiator) {
              res.statusCode = 403;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Only the initiator may close the loop.' }));
              return;
            }
            
            if (loop.state === 'complete' || loop.state === 'halted') {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: `Loop is already in ${loop.state} state` }));
              return;
            }
            
            loop.state = 'complete';
            loop.closeSignal = closeSignal;
            this.loops.set(loopId, loop);
            
            // Deliver close notification to target participant
            const recipient = loop.target;
            const isOnline = this.wsClients.has(recipient);
            const msgId = crypto.randomUUID();
            const timestamp = new Date().toISOString();
            
            const msgPayload = {
              id: msgId,
              type: 'direct',
              from: loop.initiator,
              to: recipient,
              message: `Loop closed: ${closeSignal.reason || 'completed'}`,
              timestamp: timestamp,
              loopId: loopId,
              closeSignal: closeSignal
            };
            
            // Always queue in offlineQueues (durable inbox) until explicitly ACK'd
            if (!this.offlineQueues.has(recipient)) {
              this.offlineQueues.set(recipient, []);
            }
            this.offlineQueues.get(recipient).push(msgPayload);

            if (isOnline) {
              this.sendWebSocketMessage(recipient, {
                type: 'new_message',
                messageId: msgId,
                message: msgPayload
              });
            }
            
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              success: true,
              loopState: loop.state,
              closeSignal: loop.closeSignal
            }));
          } catch (error) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: error.message }));
          }
          return;
        }
        
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Endpoint action not found' }));
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

      // --- GOVERNANCE BRIDGE (Issue #20) ---

      // Quarantine peer
      if (pathname.startsWith('/peers/') && pathname.endsWith('/quarantine') && req.method === 'POST') {
        try {
          const nodeId = pathname.split('/')[2];
          const data = await this.readRequestBody(req);
          const result = await this.callA2A('POST', `/a2a/gossip/peers/${nodeId}/quarantine`, data);
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

      // Unquarantine peer
      if (pathname.startsWith('/peers/') && pathname.endsWith('/unquarantine') && req.method === 'POST') {
        try {
          const nodeId = pathname.split('/')[2];
          const data = await this.readRequestBody(req);
          const result = await this.callA2A('POST', `/a2a/gossip/peers/${nodeId}/unquarantine`, data);
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

      // List all capability profiles
      if (pathname === '/capabilities/profiles' && req.method === 'GET') {
        try {
          const result = await this.callA2A('GET', '/a2a/capabilities/profiles');
          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ profiles: result.data }));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }

      // List grants for a workspace
      if (pathname.startsWith('/workspaces/') && pathname.endsWith('/grants') && req.method === 'GET') {
        try {
          const workspaceId = pathname.split('/')[2];
          const result = await this.callA2A('GET', `/a2a/workspaces/${workspaceId}/grants`);
          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ grants: result.data }));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }

      // Revoke a grant
      if (pathname.startsWith('/grants/') && req.method === 'DELETE') {
        try {
          const grantId = pathname.split('/')[2];
          const result = await this.callA2A('DELETE', `/a2a/grants/${grantId}`);
          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result.data));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }

      // --- SWARM MANAGEMENT (Issue #21) ---

      // Expand mesh capacity
      if (pathname === '/mesh/expand' && req.method === 'POST') {
        try {
          // 1. Authentication
          if (!this.verifyA2ASignature(req.headers, pathname)) {
            res.statusCode = 401;
            res.end(JSON.stringify({ error: 'Unauthorized: Invalid HMAC signature' }));
            return;
          }

          // 2. Spawn Rate Limit (Max 1 per 60s)
          const now = Date.now();
          if (now - this.lastSpawnTime < 60000) {
            console.log('⚠️ Mesh expansion rate limited (60s cooldown)');
            this.messageHistory.push({
              id: `sys-${Date.now()}`,
              from: 'system', to: 'dashboard',
              message: `mesh.expand.rate_limited: cooldown ${Math.round((60000 - (now - this.lastSpawnTime))/1000)}s remaining`,
              timestamp: new Date().toISOString(),
              type: 'telemetry',
            });
            res.statusCode = 429;
            res.end(JSON.stringify({ error: 'Rate limited: 60s cooldown between spawns' }));
            return;
          }

          // 3. Hard Cap & Reconciliation (Max 4 children)
          const peersResult = await this.callA2A('GET', '/a2a/gossip/peers');
          let liveChildren = 0;
          if (peersResult.ok && Array.isArray(peersResult.data)) {
            liveChildren = peersResult.data.filter(p => p.status === 'active' && p.id.includes('-spawned-')).length;
          }
          
          if (liveChildren >= 4) {
            console.log(`❌ Mesh expansion cap hit (${liveChildren} children)`);
            this.messageHistory.push({
              id: `sys-${Date.now()}`,
              from: 'system', to: 'dashboard',
              message: `mesh.expand.cap_hit: ${liveChildren} children active`,
              timestamp: new Date().toISOString(),
              type: 'telemetry',
            });
            res.statusCode = 403;
            res.end(JSON.stringify({ error: 'Capacity cap hit: max 4 spawned children' }));
            return;
          }

          // 4. HITL Gate (First 5 successful spawns)
          if (this.spawnApprovalCount < this.spawnApprovalGateLiftsAt) {
            const requestId = `spawn-${Date.now()}`;
            this.pendingSpawnRequests.push({
              id: requestId,
              requestedAt: new Date().toISOString(),
              status: 'pending'
            });
            
            console.log(`🛡️ HITL Gate: Spawn request ${requestId} queued for operator approval`);
            
            // Emit telemetry for Discord/Dashboard
            this.messageHistory.push({
              id: `sys-${Date.now()}`,
              from: 'system',
              to: 'dashboard',
              message: `mesh.expand.requested: Approval required (ID: ${requestId})`,
              timestamp: new Date().toISOString(),
              type: 'telemetry'
            });

            res.statusCode = 202; // Accepted
            res.end(JSON.stringify({ 
              status: 'awaiting_approval', 
              requestId,
              message: 'First 5 spawns require manual approval. Check the dashboard.'
            }));
            return;
          }

          // 5. Execute Spawn
          const port = await this.getAvailablePortFromTangleClaw();
          const nodeId = await this.spawnA2ANode(port);

          res.statusCode = 200;
          res.end(JSON.stringify({ status: 'spawning', nodeId, port }));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }

      // Contract mesh capacity
      if (pathname === '/mesh/contract' && req.method === 'POST') {
        try {
          // Authentication (Same as expand)
          if (!this.verifyA2ASignature(req.headers, pathname)) {
            res.statusCode = 401;
            res.end(JSON.stringify({ error: 'Unauthorized: Invalid HMAC signature' }));
            return;
          }

          const data = await this.readRequestBody(req);
          const { node_id, kind } = data;
          
          if (kind === 'self_terminate_idle') {
            await this.callA2A('POST', `/a2a/gossip/peers/${node_id}/terminate`);
          }

          this.spawnedChildrenExpected.delete(node_id);
          this.lastContractTime = Date.now();
          console.log(`📉 Mesh contraction: Node ${node_id} reported ${kind}`);
          
          this.messageHistory.push({
            id: `sys-${Date.now()}`,
            from: 'system',
            to: 'dashboard',
            message: `mesh.contract.received: ${node_id} (${kind})`,
            timestamp: new Date().toISOString(),
            type: 'telemetry'
          });

          res.statusCode = 200;
          res.end(JSON.stringify({ status: 'acknowledged' }));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }

      // Approve pending spawn request (HITL)
      if (pathname.startsWith('/mesh/approve/') && req.method === 'POST') {
        try {
          const requestId = pathname.split('/')[3];
          const reqIndex = this.pendingSpawnRequests.findIndex(r => r.id === requestId);
          
          if (reqIndex === -1) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'Request not found' }));
            return;
          }
          
          this.pendingSpawnRequests.splice(reqIndex, 1);
          
          const port = await this.getAvailablePortFromTangleClaw();
          const nodeId = await this.spawnA2ANode(port);
          
          this.messageHistory.push({
            id: `sys-${Date.now()}`,
            from: 'system', to: 'dashboard',
            message: `mesh.expand.approved: ${requestId} _ ${nodeId} on port ${port}`,
            timestamp: new Date().toISOString(),
            type: 'telemetry',
          });

          console.log(`✅ Operator approved spawn request ${requestId}`);
          
          res.statusCode = 200;
          res.end(JSON.stringify({ status: 'approved', nodeId, port }));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }

      // Deny pending spawn request (HITL)
      if (pathname.startsWith('/mesh/deny/') && req.method === 'POST') {
        try {
          const requestId = pathname.split('/')[3];
          const reqIndex = this.pendingSpawnRequests.findIndex(r => r.id === requestId);
          
          if (reqIndex === -1) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'Request not found' }));
            return;
          }
          
          this.pendingSpawnRequests.splice(reqIndex, 1);
          console.log(`❌ Operator denied spawn request ${requestId}`);
          
          res.statusCode = 200;
          res.end(JSON.stringify({ status: 'denied' }));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }

      // Get swarm status (for dashboard)
      if (pathname === '/mesh/status' && req.method === 'GET') {
        try {
          const peersResult = await this.callA2A('GET', '/a2a/gossip/peers');
          let liveChildren = 0;
          if (peersResult.ok && Array.isArray(peersResult.data)) {
            liveChildren = peersResult.data.filter(p => p.status === 'active' && p.id.includes('-spawned-')).length;
          }

          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            liveChildren,
            maxChildren: 4,
            spawnApprovalCount: this.spawnApprovalCount,
            spawnApprovalGateLiftsAt: this.spawnApprovalGateLiftsAt,
            lastSpawnTime: this.lastSpawnTime,
            lastContractTime: this.lastContractTime,
            pendingRequests: this.pendingSpawnRequests
          }));
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
            
            // Drain offline queue and deliver immediately over WS!
            if (this.offlineQueues.has(workspaceId)) {
              const queuedMsgs = this.offlineQueues.get(workspaceId);
              for (const queuedMsg of queuedMsgs) {
                ws.send(JSON.stringify({
                  type: 'new_message',
                  messageId: queuedMsg.id,
                  message: queuedMsg
                }));
              }
              // Non-destructive: do not delete here. Messages survive until explicitly ACK'd.
            }
          }
          
          if (message.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          }

          if (message.type === 'ack') {
            let messageIds = message.messageIds;
            if (message.messageId && !messageIds) {
              messageIds = [message.messageId];
            }
            if (workspaceId && (Array.isArray(messageIds) || typeof messageIds === 'string')) {
              const ids = Array.isArray(messageIds) ? messageIds : [messageIds];
              this.ackMessages(workspaceId, ids);
              ws.send(JSON.stringify({
                type: 'ack_response',
                success: true,
                messageIds: ids
              }));
            }
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
          if (connections.size === 0) {
            this.wsClients.delete(workspaceId);
            // Reap on WS close
            this.workspaceRegistry.delete(workspaceId);
            this.saveRegistry();
          }
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

  ackMessages(workspaceId, messageIds) {
    if (!this.offlineQueues.has(workspaceId)) return;
    const queue = this.offlineQueues.get(workspaceId);
    const updatedQueue = queue.filter(msg => !messageIds.includes(msg.id));
    if (updatedQueue.length === 0) {
      this.offlineQueues.delete(workspaceId);
    } else {
      this.offlineQueues.set(workspaceId, updatedQueue);
    }
    console.log(`✅ ACKed ${messageIds.length} messages for workspace: ${workspaceId}`);
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
      await new Promise(resolve => this.protocolServer.listen(this.protocolPort, this.protocolHost, resolve));
      
      console.log(`🐍 Medusa Protocol API running at http://${this.protocolHost}:${this.protocolPort}`);
      
      this.wsServer = new WebSocket.Server({ 
        port: this.protocolPort + 1,
        host: this.protocolHost 
      });
      this.setupWebSocketHandlers();
      
      this.webServer = this.createWebServer();
      await new Promise(resolve => this.webServer.listen(this.webPort, this.webHost, resolve));
      
      console.log(`🐍 Switchboard running at http://${this.webHost}:${this.webPort}`);
      console.log(`🔌 WebSocket Server running at ws://${this.protocolHost}:${this.protocolPort + 1}`);
      console.log('\nThe two medusas are ready to hiss properly! 🐍🔥🐍');
      
      this.spawnReconcilerInterval = setInterval(() => {
        this.reconcileSpawnedChildren().catch(() => {});
      }, 30000); // every 30s

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
    
    if (this.spawnReconcilerInterval) {
      clearInterval(this.spawnReconcilerInterval);
      this.spawnReconcilerInterval = null;
    }

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
