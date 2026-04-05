/**
 * 🐍 Medusa Chat Protocol Server
 * 
 * Revolutionary server-based workspace coordination system
 * Replaces broken file-based messaging with professional HTTP/WebSocket architecture
 * 
 * Two medusas finally hissing at each other properly!
 */

const http = require('http');
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

// Configuration
const PROTOCOL_PORT = 3009;  // Medusa Protocol API
const WEB_PORT = 8181;       // Web Dashboard
const WORKSPACE_REGISTRY_FILE = path.join(os.homedir(), '.medusa', 'medusa-registry.json');

// Server ownership tracking
const serverMetadata = {
  startedAt: new Date().toISOString(),
  startedFrom: process.cwd(),
  controllingWorkspace: null, // Will be set during startup
  pid: process.pid
};

// Medusa Event Bus for real-time coordination
class MedusaEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100); // Support many workspace connections
  }
}

// Global instances
const eventBus = new MedusaEventBus();
const workspaceRegistry = new Map();
const messageHistory = [];
const MAX_MESSAGE_HISTORY = 1000;
const wsClients = new Map(); // WebSocket connections by workspace ID - supports multiple connections per workspace

// A2A Integration Configuration
const A2A_BASE_URL = 'http://localhost:3200';
const A2A_SECRET = process.env.A2A_SECRET || 'medusa-please';

// Helper to call A2A Node
async function callA2A(method, endpoint, data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, A2A_BASE_URL);
    const options = {
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'X-Medusa-Secret': A2A_SECRET
      }
    };
    
    const req = http.request(url, options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          if (body.trim() === '') return resolve({ success: res.statusCode < 400 });
          resolve(JSON.parse(body));
        } catch (error) {
          resolve({ error: 'Parse error', body });
        }
      });
    });
    
    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

// Helper to read request body
function readRequestBody(req) {
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

// NEW: Listener status tracking for autonomous conversation telemetry
const listenerStatus = new Map(); // Track listener heartbeats and autonomous conversation readiness

// NEW: Update listener heartbeat
function updateListenerHeartbeat(workspaceId, status = 'active') {
  listenerStatus.set(workspaceId, {
    lastHeartbeat: new Date(),
    status: status, // 'active', 'idle', 'error'
    autonomousMode: status === 'active',
    connectionCount: wsClients.has(workspaceId) ? wsClients.get(workspaceId).size : 0
  });
}

// Load workspace registry from disk
async function loadRegistry() {
  try {
    await fs.mkdir(path.dirname(WORKSPACE_REGISTRY_FILE), { recursive: true });
    const data = await fs.readFile(WORKSPACE_REGISTRY_FILE, 'utf8');
    const parsed = JSON.parse(data);
    
    for (const [id, workspace] of Object.entries(parsed)) {
      workspaceRegistry.set(id, {
        ...workspace,
        lastSeen: new Date(workspace.lastSeen),
        registeredAt: new Date(workspace.registeredAt)
      });
    }
    
    console.log(`🐍 Loaded ${workspaceRegistry.size} workspaces from registry`);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Error loading registry:', error);
    } else {
      console.log('🐍 Starting with fresh workspace registry');
    }
  }
}

// Save workspace registry to disk
async function saveRegistry() {
  try {
    const data = {};
    for (const [id, workspace] of workspaceRegistry) {
      data[id] = workspace;
    }
    
    await fs.writeFile(WORKSPACE_REGISTRY_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error saving registry:', error);
  }
}

// Create Medusa Protocol Server
const protocolServer = http.createServer(async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Workspace-ID');
  
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  
  const url = new URL(req.url, `http://localhost:${PROTOCOL_PORT}`);
  const path = url.pathname;
  
  // Health check endpoint (Bridged)
  if (path === '/health' && req.method === 'GET') {
    try {
      const a2aHealth = await callA2A('GET', '/a2a/gossip/sync'); // Minimal check
      const peers = await callA2A('GET', '/a2a/gossip/peers');
      const messages = await callA2A('GET', '/a2a/messages');
      
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        status: 'hissing',
        protocol: 'Medusa-A2A Bridge',
        version: MEDUSA_VERSION,
        workspaces: Array.isArray(peers) ? peers.length : 0,
        messages: Array.isArray(messages) ? messages.length : 0,
        uptime: process.uptime(),
        a2a_connected: !a2aHealth.error
      }));
    } catch (error) {
      res.statusCode = 200;
      res.end(JSON.stringify({ status: 'degraded', error: error.message }));
    }
    return;
  }

  // System telemetry endpoint (Bridged)
  if (path === '/telemetry' && req.method === 'GET') {
    try {
      const locks = await ProcessLock.getAllLocks();
      const peers = await callA2A('GET', '/a2a/gossip/peers');
      
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
          peers_count: Array.isArray(peers) ? peers.length : 0,
          peers: peers
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

  // List all workspaces (Bridged to Peers)
  if (path === '/workspaces' && req.method === 'GET') {
    try {
      const peers = await callA2A('GET', '/a2a/gossip/peers');
      const workspaces = Array.isArray(peers) ? peers.map(p => ({
        id: p.id,
        name: p.id.split('-')[0], // Extract name
        status: p.status,
        connected: p.status === 'active',
        connection: { webSocket: true, connectionCount: 1 },
        listener: { active: true, autonomousMode: true, lastHeartbeat: p.last_seen },
        autonomousConversationReady: p.status === 'active'
      })) : [];
      
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        workspaces,
        count: workspaces.length,
        telemetry: {
          autonomousConversationReady: workspaces.filter(w => w.connected).length,
          totalWorkspaces: workspaces.length,
          readinessPercentage: workspaces.length > 0 ? 100 : 0
        }
      }));
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }
  
  // Send direct message (Bridged)
  if (path === '/messages/direct' && req.method === 'POST') {
    try {
      const data = await readRequestBody(req);
      const result = await callA2A('POST', '/a2a/messages/send', {
        sender_id: data.from,
        recipient_id: data.to,
        content: data.message
      });
      
      res.statusCode = 201;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: !result.error, ...result }));
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }
  
  // Broadcast message (Bridged)
  if (path === '/messages/broadcast' && req.method === 'POST') {
    try {
      const data = await readRequestBody(req);
      const result = await callA2A('POST', '/a2a/messages/broadcast', {
        content: data.message
      });
      
      res.statusCode = 201;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: !result.error, ...result }));
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }
  
  // Get recent messages (Bridged)
  if (path === '/messages/recent' && req.method === 'GET') {
    try {
      const messages = await callA2A('GET', '/a2a/messages');
      const formatted = Array.isArray(messages) ? messages.map(m => ({
        id: m.id,
        from: m.sender_id,
        fromName: m.sender_id.split('-')[0],
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
  
  // List all peers in the mesh (Bridged)
  if (path === '/mesh/peers' && req.method === 'GET') {
    try {
      const peers = await callA2A('GET', '/a2a/gossip/peers');
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ peers }));
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }
  
  // List all tasks/auctions (Bridged)
  if (path === '/auctions' && req.method === 'GET') {
    try {
      const tasks = await callA2A('GET', '/a2a/tasks');
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ tasks }));
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // Get task tree (Bridged & Processed)
  if (path === '/a2a/tasks/tree' && req.method === 'GET') {
    try {
      const tasks = await callA2A('GET', '/a2a/tasks?limit=100');
      
      if (tasks.error) throw new Error(tasks.error);
      
      // Build tree
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
  
  // Place bid on task (Bridged)
  if (path === '/auctions/bid' && req.method === 'POST') {
    try {
      const data = await readRequestBody(req);
      const result = await callA2A('POST', '/a2a/tasks/bid', data);
      res.statusCode = 201;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result));
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // Resolve auction (Bridged)
  if (path.startsWith('/auctions/') && path.endsWith('/resolve') && req.method === 'POST') {
    try {
      const taskId = path.split('/')[2];
      const result = await callA2A('POST', `/a2a/tasks/${taskId}/resolve_auction`);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result));
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // Approve task (Bridged)
  if (path.startsWith('/tasks/') && path.endsWith('/approve') && req.method === 'POST') {
    try {
      const taskId = path.split('/')[2];
      const result = await callA2A('POST', `/a2a/tasks/${taskId}/approve`);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result));
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // Reject task (Bridged)
  if (path.startsWith('/tasks/') && path.endsWith('/reject') && req.method === 'POST') {
    try {
      const taskId = path.split('/')[2];
      const result = await callA2A('POST', `/a2a/tasks/${taskId}/reject`);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result));
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

// WebSocket server and message cache (initialized in startMedusa)
let wsServer = null;
const messageCache = new Map(); // Cache to prevent message loops

// WebSocket connection handler (defined as function to be used in startMedusa)
function setupWebSocketHandlers() {
  wsServer.on('connection', (ws, req) => {
    console.log('🔌 WebSocket client connected');
    
    let workspaceId = null;
    let isRegistered = false;
    let connectionId = `conn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        // Handle workspace registration via WebSocket
        if (message.type === 'register' && !isRegistered) {
          workspaceId = message.workspaceId;
          
          // Support multiple connections per workspace
          if (!wsClients.has(workspaceId)) {
            wsClients.set(workspaceId, new Map());
          }
          
          // Add this connection to the workspace's connection pool
          wsClients.get(workspaceId).set(connectionId, ws);
          isRegistered = true;
          
          ws.send(JSON.stringify({
            type: 'registered',
            workspaceId,
            connectionId,
            message: 'WebSocket connection established for real-time messaging'
          }));
          
          console.log(`🔌 WebSocket registered for workspace: ${workspaceId} (${connectionId})`);
        }
        
        // Handle ping/pong for connection health
        if (message.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        }
        
        // NEW: Handle listener heartbeat for autonomous conversation telemetry
        if (message.type === 'listener_heartbeat' && isRegistered) {
          const status = message.status || 'active';
          updateListenerHeartbeat(workspaceId, status);
          
          ws.send(JSON.stringify({ 
            type: 'heartbeat_ack', 
            timestamp: Date.now(),
            autonomousMode: status === 'active'
          }));
          
          console.log(`💓 Listener heartbeat from ${workspaceId}: ${status}`);
        }
        
      } catch (error) {
        console.error('WebSocket message error:', error);
        ws.send(JSON.stringify({ type: 'error', message: error.message }));
      }
    });
    
    ws.on('close', () => {
      if (workspaceId && wsClients.has(workspaceId)) {
        const connections = wsClients.get(workspaceId);
        connections.delete(connectionId);
        
        // Clean up empty workspace entries
        if (connections.size === 0) {
          wsClients.delete(workspaceId);
        }
        
        console.log(`🔌 WebSocket disconnected for workspace: ${workspaceId} (${connectionId})`);
      }
    });
    
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      if (workspaceId && wsClients.has(workspaceId)) {
        const connections = wsClients.get(workspaceId);
        connections.delete(connectionId);
        
        if (connections.size === 0) {
          wsClients.delete(workspaceId);
        }
      }
    });
  });
}

// Function to send WebSocket message with deduplication (updated for multiple connections)
function sendWebSocketMessage(workspaceId, messageData) {
  const messageKey = `${messageData.messageId}-${workspaceId}`;
  
  // Check if we've already sent this message to this workspace
  if (messageCache.has(messageKey)) {
    return false; // Message already sent
  }
  
  const connections = wsClients.get(workspaceId);
  if (connections && connections.size > 0) {
    let delivered = false;
    
    // Send to all connections for this workspace
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
        // Clean up dead connections
        connections.delete(connId);
      }
    });
    
    if (delivered) {
      messageCache.set(messageKey, Date.now());
      
      // Clean up old cache entries (older than 5 minutes)
      setTimeout(() => {
        messageCache.delete(messageKey);
      }, 5 * 60 * 1000);
      
      console.log(`🔌 Message delivered instantly via WebSocket to ${connections.size} connection(s)!`);
      return true;
    }
  }
  
  return false;
}

// Create Web Dashboard Server
const webServer = http.createServer((req, res) => {
  // Set CORS headers for dashboard
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.url === '/medusa-logo.svg') {
    const fs = require('fs');
    const path = require('path');
    const logoPath = path.join(__dirname, 'medusa-logo.svg');
    
    try {
      const svgContent = fs.readFileSync(logoPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      res.end(svgContent);
    } catch (error) {
      res.writeHead(404);
      res.end('Logo not found');
    }
    return;
  }
  
  if (req.url === '/medusa-logo.png') {
    const fs = require('fs');
    const path = require('path');
    const logoPath = path.join(__dirname, '../../medusa-logo.png'); // Check project root first
    const altLogoPath = path.join(__dirname, 'medusa-logo.png'); // Then local directory
    
    try {
      let logoContent;
      try {
        logoContent = fs.readFileSync(logoPath);
      } catch {
        logoContent = fs.readFileSync(altLogoPath);
      }
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(logoContent);
    } catch (error) {
      res.writeHead(404);
      res.end('PNG Logo not found - please save your medusa-logo.png file');
    }
    return;
  }
  
  // Serve the dashboard JavaScript file (handle query parameters for cache-busting)
  if (req.url.startsWith('/dashboard.js')) {
    const fs = require('fs');
    const path = require('path');
    const jsPath = path.join(__dirname, 'dashboard.js');
    
    try {
      const jsContent = fs.readFileSync(jsPath, 'utf8');
      res.writeHead(200, { 
        'Content-Type': 'application/javascript',
        'Cache-Control': 'no-cache'
      });
      res.end(jsContent);
    } catch (error) {
      res.writeHead(404);
      res.end('Dashboard JavaScript not found');
    }
    return;
  }
  
  if (req.url === '/' || req.url === '/index.html' || req.url === '/dashboard') {
    const fs = require('fs');
    const path = require('path');
    const htmlPath = path.join(__dirname, 'dashboard.html');
    
    try {
      const htmlContent = fs.readFileSync(htmlPath, 'utf8');
      res.writeHead(200, { 
        'Content-Type': 'text/html',
        'Cache-Control': 'no-cache'
      });
      res.end(htmlContent);
    } catch (error) {
      res.writeHead(500);
      res.end('Dashboard HTML not found: ' + error.message);
    }
  } else {
    res.statusCode = 404;
    res.end('Not found');
  }
});

// Global process lock
let processLock = null;



// Start servers
async function startMedusa() {
  console.log('🐍 Starting Medusa Chat Protocol...');
  
  try {
    // Clean up any stale locks first
    await ProcessLock.cleanupStaleLocks();
    
    // Acquire process lock to prevent multiple instances
    processLock = new ProcessLock('medusa-server');
    await processLock.acquire();
    
    // Detect controlling workspace
    const cwd = process.cwd();
    const workspaceName = path.basename(cwd);
    serverMetadata.controllingWorkspace = workspaceName;
    console.log(`🎮 Server controlled by workspace: ${workspaceName}`);
    
    // Load registry
    await loadRegistry();
    
    // Start Protocol Server
    protocolServer.listen(PROTOCOL_PORT, () => {
      console.log(`🐍 Medusa Protocol API running at http://localhost:${PROTOCOL_PORT}`);
      console.log('');
      console.log('API Endpoints:');
      console.log('  GET  /health                    - Check server status');
      console.log('  POST /workspaces/register       - Register a workspace');
      console.log('  GET  /workspaces                - List all workspaces');
      console.log('  POST /messages/direct           - Send direct message');
      console.log('  POST /messages/broadcast        - Broadcast to all workspaces');
      console.log('  GET  /messages/workspace/:id    - Get messages for workspace');
      console.log('  POST /context/share             - Share context between workspaces');
      console.log('  GET  /telemetry                 - Get system telemetry');
      console.log('');
    });
    
    // Create and start WebSocket Server (after process lock is acquired)
    wsServer = new WebSocket.Server({ port: PROTOCOL_PORT + 1 }); // Port 3010
    setupWebSocketHandlers();
    
    // Start Web Server
    webServer.listen(WEB_PORT, () => {
      console.log(`🐍 Switchboard running at http://localhost:${WEB_PORT}`);
      console.log(`🔌 WebSocket Server running at ws://localhost:${PROTOCOL_PORT + 1}`);
      console.log('');
      
      console.log('The two medusas are ready to hiss properly! 🐍🔥🐍');
      console.log('🎯 Ready for Cursor MCP integration!');
    });
    
  } catch (error) {
    console.error(`❌ Failed to start Medusa server: ${error.message}`);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🐍 Medusa shutting down...');
  
  // Release process lock
  if (processLock) {
    await processLock.release();
  }
  
  // Save registry
  await saveRegistry();
  
  // Close servers
  protocolServer.close();
  webServer.close();
  if (wsServer) {
    wsServer.close();
  }
  
  process.exit(0);
});

// Start the servers
if (require.main === module) {
  startMedusa().catch(console.error);
}

// Export for testing
module.exports = {
  eventBus,
  workspaceRegistry,
  messageHistory
};