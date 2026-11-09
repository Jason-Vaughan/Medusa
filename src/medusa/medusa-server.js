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
const UpdateManager = require('./UpdateManager');

// Load version from package.json dynamically
const packagePath = path.join(__dirname, '../../package.json');
const packageJson = require(packagePath);
const MEDUSA_VERSION = packageJson.version;

/**
 * Resolves the Hub's startup commit SHA via `git rev-parse HEAD`, falling back to the
 * MEDUSA_GIT_SHA environment variable or `"unknown"` when git is unavailable (e.g. a
 * non-git install, a sandboxed CI runner, or a detached/shallow checkout without history).
 * @returns {string}
 */
function resolveGitSha() {
  try {
    const { execSync } = require('child_process');
    return execSync('git rev-parse HEAD', {
      cwd: path.join(__dirname, '../..'),
      stdio: ['ignore', 'pipe', 'ignore']
    }).toString().trim();
  } catch (_error) {
    return process.env.MEDUSA_GIT_SHA || 'unknown';
  }
}

const MEDUSA_GIT_SHA = resolveGitSha();

// Capability manifest advertised on GET /version, GET /health, and the WS registration
// handshake (Issue #70). Extend this list as new Hub-wide capabilities ship.
const HUB_CAPABILITIES = [
  'durable-send-idempotency-v1',
  'iso8601-heartbeat-v1',
  'version-manifest-v1',
  'experimental-codecs-v1',
  'experimental-codec-envelope-v1'
];

const { CodecRegistry, validateCanonicalMessage, SharedGraphStore } = require('./experiments/codecs/CodecRegistry');
const { TupleTableCodec } = require('./experiments/codecs/TupleTableCodec');
const { DictionaryInternCodec, SharedSymbolTable } = require('./experiments/codecs/DictionaryInternCodec');
const { JsonPatchDeltaCodec, FlatStateRegister } = require('./experiments/codecs/JsonPatchDeltaCodec');
const { BlackboardRefCodec, BlackboardStore } = require('./experiments/codecs/BlackboardRefCodec');

/**
 * Builds a `CodecRegistry` pre-loaded with all 9 experimental communication codecs — the 5
 * registered by `CodecRegistry`'s own default constructor, plus `TupleTableCodec`,
 * `DictionaryInternCodec`, `JsonPatchDeltaCodec`, and `BlackboardRefCodec` — without modifying
 * `CodecRegistry.js` itself, so the opt-in Hub codec envelope (Issue #76) can offer every
 * benchmarked codec immediately.
 * @returns {CodecRegistry}
 */
function createHubCodecRegistry() {
  const registry = new CodecRegistry();
  const extraCodecs = [new TupleTableCodec(), new DictionaryInternCodec(), new JsonPatchDeltaCodec(), new BlackboardRefCodec()];
  for (const codec of extraCodecs) {
    if (!registry.get(codec.capabilities().id)) {
      registry.register(codec);
    }
  }
  return registry;
}

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
    this.idempotencyRecords = new Map(); // Durable send idempotency key -> receipt record
    this.pendingIdempotencySaves = new Map(); // In-flight send idempotency key -> { record, promise }
    this.isStopping = false;
    this._savePromise = Promise.resolve();
    this._saveSeq = 0;

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
    this.updateManager = new UpdateManager(this);

    // Hub version/capability manifest state (Issue #70)
    this.previousKnownVersion = null;
    this.previousKnownGitSha = null;
    this.previousKnownCapabilities = null;
    this.pendingVersionTransition = null;

    // Opt-in experimental codec negotiation (Issue #76)
    this.codecRegistry = createHubCodecRegistry();
  }

  /**
   * Formats log arguments into a single string with an ISO 8601 timestamp prefix
   * on every physical line, including multiline strings and Error stack traces.
   * @param {...*} args - Arguments to format.
   * @returns {string} Timestamp-prefixed log text.
   */
  static formatLogMessage(...args) {
    const timestamp = new Date().toISOString();
    const combined = args.map(arg => {
      if (arg instanceof Error) {
        return arg.stack || arg.message || String(arg);
      }
      if (typeof arg === 'string') {
        return arg;
      }
      if (typeof arg === 'object' && arg !== null) {
        try {
          return JSON.stringify(arg);
        } catch (e) {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');
    const rawLines = combined.split(/\r?\n/).filter(line => line.length > 0);
    const lines = rawLines.length > 0 ? rawLines : [''];
    return lines.map(line => `[${timestamp}] ${line}`).join('\n');
  }

  /**
   * Formats and logs informational messages with an ISO 8601 timestamp prefix on every line.
   * @param {...*} args - Arguments to write to stdout.
   */
  static log(...args) {
    console.log(MedusaServer.formatLogMessage(...args));
  }

  /**
   * Formats and logs error messages with an ISO 8601 timestamp prefix on every line.
   * @param {...*} args - Arguments to write to stderr.
   */
  static logError(...args) {
    console.error(MedusaServer.formatLogMessage(...args));
  }

  /**
   * Formats and logs informational messages with an ISO 8601 timestamp prefix.
   * @param {...*} args - Arguments to write to stdout.
   */
  log(...args) {
    MedusaServer.log(...args);
  }

  /**
   * Formats and logs error messages with an ISO 8601 timestamp prefix.
   * @param {...*} args - Arguments to write to stderr.
   */
  logError(...args) {
    MedusaServer.logError(...args);
  }

  /**
   * Checks whether per-heartbeat debug logging is enabled via the DEBUG environment variable.
   * @returns {boolean} True when process.env.DEBUG is set to a truthy, non-disabled value.
   */
  isDebugEnabled() {
    const debug = process.env.DEBUG;
    return Boolean(debug && debug !== '0' && debug.toLowerCase() !== 'false');
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
   * Resolves a workspace identifier (which can be a raw workspace ID or a workspace name)
   * to a valid registered workspace ID.
   * Throws an error if the identifier matches multiple workspaces (ambiguous).
   * Returns null if no match is found.
   */
  resolveWorkspaceId(identifier) {
    if (!identifier) return null;
    
    // 1. If it's already a valid registered workspace ID or an active WebSocket client ID, use it directly
    if (this.workspaceRegistry.has(identifier) || this.wsClients.has(identifier)) {
      return identifier;
    }
    
    // 2. Look for name matches (case-insensitive) in registry and active WS clients
    const matches = new Set();
    
    // Check registry entries
    for (const [id, ws] of this.workspaceRegistry.entries()) {
      if (ws.name && ws.name.toLowerCase() === identifier.toLowerCase()) {
        matches.add(id);
      }
    }
    
    // Check active WebSocket clients
    for (const id of this.wsClients.keys()) {
      const name = id.split('-')[0];
      if (name && name.toLowerCase() === identifier.toLowerCase()) {
        matches.add(id);
      }
    }
    
    const uniqueMatches = Array.from(matches);
    if (uniqueMatches.length === 1) {
      return uniqueMatches[0];
    } else if (uniqueMatches.length > 1) {
      throw new Error(`Ambiguous workspace name "${identifier}": matches multiple registered IDs [${uniqueMatches.join(', ')}]`);
    }
    
    return null;
  }

  /**
   * Derives a fallback workspace display name from its ID by stripping
   * only the trailing mint-suffix (the last hyphenated segment).
   */
  fallbackWorkspaceName(workspaceId) {
    if (!workspaceId) return 'unknown';
    const parts = workspaceId.split('-');
    if (parts.length > 1) {
      parts.pop();
      return parts.join('-');
    }
    return workspaceId;
  }

  /**
   * Evaluates the wall-clock timeout guard for a loop and transitions it to halted if exceeded.
   */
  checkWallTimeGuardForLoop(loop) {
    if (loop.mode === 'supervised') {
      return false; // Supervised loops wait on human deliberation, so wall clock does not apply
    }
    
    if (loop.state !== 'complete' && loop.state !== 'halted' && loop.startedAt) {
      const elapsed = (Date.now() - new Date(loop.startedAt).getTime()) / 1000;
      if (loop.guards && loop.guards.maxWallTimeSeconds && elapsed > loop.guards.maxWallTimeSeconds) {
        loop.state = 'halted';
        this.loops.set(loop.id, loop);
        
        // Push telemetry message
        this.messageHistory.push({
          id: `sys-loop-halt-${Date.now()}`,
          from: 'system',
          to: 'dashboard',
          message: `loop.halted.timeout: ${loop.id} (elapsed: ${elapsed}s)`,
          timestamp: new Date().toISOString(),
          type: 'telemetry'
        });
        return true;
      }
    }
    return false;
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
    this.log(`🚀 Spawning A2A Node: ${nodeId} on port ${port}`);
    
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
          this.log(`✅ Spawned node ${nodeId} is now active. Incrementing approval count.`);
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
          this.log(`📉 Detected crashed spawned child: ${expectedId}`);
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
      this.logError('reconcileSpawnedChildren error:', e.message);
    }
  }

  /**
   * Updates listener heartbeat state for a workspace and returns whether the logged status changed.
   * @param {string} workspaceId - The workspace identifier.
   * @param {string} [status='active'] - The listener status ('active', 'idle', 'error').
   * @param {object} [options={}] - Options controlling status change tracking.
   * @param {boolean} [options.recordLog=true] - Whether to record status as the last logged heartbeat status.
   * @returns {boolean} True if this heartbeat represents a newly seen status or a status transition.
   */
  updateListenerHeartbeat(workspaceId, status = 'active', options = {}) {
    const now = new Date();
    const recordLog = options.recordLog !== false;
    const prev = this.listenerStatus.get(workspaceId);
    const prevLoggedStatus = prev ? prev.lastLoggedStatus : null;
    const statusChanged = recordLog ? prevLoggedStatus !== status : (!prev || prev.status !== status);

    this.listenerStatus.set(workspaceId, {
      lastHeartbeat: now,
      status: status, // 'active', 'idle', 'error'
      autonomousMode: status === 'active',
      connectionCount: this.wsClients.has(workspaceId) ? this.wsClients.get(workspaceId).size : 0,
      lastLoggedStatus: recordLog ? status : prevLoggedStatus
    });
    
    // Fix for Issue 59: Refresh the registry lastSeen so consumers know this workspace is alive.
    // Note: intentionally not calling saveRegistry() here to avoid disk I/O on every heartbeat.
    if (this.workspaceRegistry.has(workspaceId)) {
      this.workspaceRegistry.get(workspaceId).lastSeen = now;
    }

    return statusChanged;
  }

  /**
   * Load workspace registry, durable offline message queues, and send idempotency records from disk.
   * @returns {Promise<void>}
   */
  async loadRegistry() {
    try {
      await fs.mkdir(path.dirname(this.workspaceRegistryFile), { recursive: true });
      const data = await fs.readFile(this.workspaceRegistryFile, 'utf8');
      const parsed = JSON.parse(data);
      
      // Handle both old format (direct map) and new format (nested)
      const workspaces = parsed.workspaces || parsed;
      for (const [id, workspace] of Object.entries(workspaces)) {
        if (id === 'spawnApprovalCount' || id === 'offlineQueues' || id === 'idempotencyRecords') continue;
        
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
      this.previousKnownVersion = typeof parsed.lastKnownVersion === 'string' ? parsed.lastKnownVersion : null;
      this.previousKnownGitSha = typeof parsed.lastKnownGitSha === 'string' ? parsed.lastKnownGitSha : null;
      this.previousKnownCapabilities = Array.isArray(parsed.lastKnownCapabilities) ? parsed.lastKnownCapabilities : null;

      if (parsed.offlineQueues && typeof parsed.offlineQueues === 'object') {
        for (const [workspaceId, messages] of Object.entries(parsed.offlineQueues)) {
          if (Array.isArray(messages) && messages.length > 0) {
            this.offlineQueues.set(workspaceId, messages);
          }
        }
      }

      if (parsed.idempotencyRecords && typeof parsed.idempotencyRecords === 'object') {
        for (const [key, record] of Object.entries(parsed.idempotencyRecords)) {
          if (record && typeof record === 'object') {
            this.idempotencyRecords.set(key, record);
          }
        }
      }
      
      // Reap any stale workspaces loaded from disk
      this.reapStaleWorkspaces();
      
      this.log(`🐍 Loaded ${this.workspaceRegistry.size} workspaces from registry (Spawn count: ${this.spawnApprovalCount})`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.logError('Error loading registry:', error);
      } else {
        this.log('🐍 Starting with fresh workspace registry');
      }
    }
  }

  /**
   * Executes a single atomic write-to-temp-and-rename persistence pass for the workspace
   * registry, durable offline message queues, and send idempotency records.
   * @returns {Promise<void>}
   * @throws {Error} When directory creation, temporary file write, or atomic rename fails
   */
  async performRegistrySave() {
    let tmpFile = null;
    try {
      const registry = {
        workspaces: Object.fromEntries(this.workspaceRegistry),
        spawnApprovalCount: this.spawnApprovalCount,
        offlineQueues: Object.fromEntries(this.offlineQueues),
        idempotencyRecords: Object.fromEntries(this.idempotencyRecords),
        lastKnownVersion: MEDUSA_VERSION,
        lastKnownGitSha: MEDUSA_GIT_SHA,
        lastKnownCapabilities: HUB_CAPABILITIES
      };
      
      await fs.mkdir(path.dirname(this.workspaceRegistryFile), { recursive: true });
      this._saveSeq = (this._saveSeq || 0) + 1;
      tmpFile = `${this.workspaceRegistryFile}.${process.pid}.${Date.now()}.${this._saveSeq}.tmp`;
      await fs.writeFile(tmpFile, JSON.stringify(registry, null, 2));
      await fs.rename(tmpFile, this.workspaceRegistryFile);
    } catch (error) {
      this.logError('Error saving registry:', error);
      if (tmpFile) {
        await fs.unlink(tmpFile).catch(() => {});
      }
      throw error;
    }
  }

  /**
   * Atomically persist workspace registry, durable offline message queues, and send idempotency
   * records to disk via write-to-temp-and-rename.
   * @param {object} [options={}] - Persistence options
   * @param {boolean} [options.throwOnError=false] - Whether to reject when persistence fails
   * @returns {Promise<void>}
   */
  async saveRegistry(options = {}) {
    const { throwOnError = false } = options;
    const nextSave = (this._savePromise || Promise.resolve()).then(
      () => this.performRegistrySave(),
      () => this.performRegistrySave()
    );
    this._savePromise = nextSave.catch(() => {});
    if (throwOnError) {
      return nextSave;
    }
    return this._savePromise;
  }

  /**
   * Compares the version, commit SHA, and capability manifest persisted on a prior run (loaded
   * from the registry file into `this.previousKnown*`) against what this process is actually
   * running, so a Hub restart onto a newer commit, version, or capability set can be detected and
   * announced to reconnecting subscribers (Issue #70).
   * @returns {{ changed: boolean, previousVersion: string|null, previousGitSha: string|null, previousCapabilities: string[]|null }}
   */
  detectVersionTransition() {
    const previousVersion = this.previousKnownVersion || null;
    const previousGitSha = this.previousKnownGitSha || null;
    const previousCapabilities = this.previousKnownCapabilities || null;

    const versionChanged = previousVersion !== null && previousVersion !== MEDUSA_VERSION;
    const gitShaChanged = previousGitSha !== null && previousGitSha !== MEDUSA_GIT_SHA;
    const capabilitiesChanged =
      previousCapabilities !== null && JSON.stringify(previousCapabilities) !== JSON.stringify(HUB_CAPABILITIES);

    return {
      changed: versionChanged || gitShaChanged || capabilitiesChanged,
      previousVersion,
      previousGitSha,
      previousCapabilities
    };
  }

  /**
   * Binds a stateful codec store/register/table to the recipient (`canonicalMessage.to`) it was
   * first used for, and throws if it is later reused for a DIFFERENT recipient. A stateful
   * codec's evolving state (the flat register's last message, the graph's nodes/edges, the
   * interned symbol table) is only ever meant to be shared between one sender and one specific
   * recipient; reusing the same store across recipients would leak one recipient's message
   * content into the `metadata` snapshot of an envelope addressed to a different recipient
   * (Issue #76 R-Gate Round 4).
   * @param {object} store - The stateful store/register/table instance to bind.
   * @param {object} canonicalMessage - The message about to be encoded against `store`.
   * @throws {Error} With a `CROSS_RECIPIENT_CONTEXT_REUSE:`-prefixed message on a recipient mismatch.
   */
  static bindStoreToRecipient(store, canonicalMessage) {
    const recipient = canonicalMessage && canonicalMessage.to;
    if (store._boundRecipient === undefined) {
      store._boundRecipient = recipient;
    } else if (store._boundRecipient !== recipient) {
      throw new Error(
        `CROSS_RECIPIENT_CONTEXT_REUSE: Stateful codec context is bound to recipient "${store._boundRecipient}" and cannot be reused for "${recipient}"`
      );
    }
  }

  /**
   * Computes a capability-array delta between a previous and current capability manifest.
   * Capabilities are flat identifier strings with no associated value, so there is no notion of
   * one being "changed" independent of being added or removed; `changed` is always empty and
   * exists only so the frame shape matches a general add/remove/change delta.
   * @param {string[]|null} previousCapabilities - Capability list from a prior run, or `null` if unknown.
   * @param {string[]} currentCapabilities - Capability list this process is running.
   * @returns {{ added: string[], removed: string[], changed: string[] }}
   */
  static computeCapabilityDelta(previousCapabilities, currentCapabilities) {
    const prev = new Set(Array.isArray(previousCapabilities) ? previousCapabilities : []);
    const curr = new Set(Array.isArray(currentCapabilities) ? currentCapabilities : []);
    return {
      added: [...curr].filter((cap) => !prev.has(cap)),
      removed: [...prev].filter((cap) => !curr.has(cap)),
      changed: []
    };
  }

  /**
   * Builds the `hub.version_updated` broadcast frame announcing the running Hub's version,
   * commit SHA, and capability manifest, including the capability delta versus whatever manifest
   * was previously known.
   * @param {{ previousVersion?: string|null, previousGitSha?: string|null, previousCapabilities?: string[]|null }} [previous={}] - What this Hub is transitioning from.
   * @returns {{ type: string, version: string, gitSha: string, previousVersion: string|null, previousGitSha: string|null, capabilities: string[], previousCapabilities: string[]|null, capabilityDelta: { added: string[], removed: string[], changed: string[] }, timestamp: string }}
   */
  buildVersionUpdatedFrame(previous = {}) {
    const { previousVersion = null, previousGitSha = null, previousCapabilities = null } = previous;
    return {
      type: 'hub.version_updated',
      version: MEDUSA_VERSION,
      gitSha: MEDUSA_GIT_SHA,
      previousVersion,
      previousGitSha,
      capabilities: HUB_CAPABILITIES,
      previousCapabilities,
      capabilityDelta: MedusaServer.computeCapabilityDelta(previousCapabilities, HUB_CAPABILITIES),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Sends a JSON frame to every open WebSocket connection across all registered workspaces.
   * @param {object} frame - JSON-serializable frame to broadcast.
   */
  broadcastToAllClients(frame) {
    const payload = JSON.stringify(frame);
    for (const connections of this.wsClients.values()) {
      for (const ws of connections.values()) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(payload);
        }
      }
    }
  }

  /**
   * Extracts and validates an optional caller-supplied send idempotency key from HTTP headers or body.
   * @param {http.IncomingMessage} req - Incoming HTTP request
   * @param {object} data - Parsed JSON request body
   * @returns {{ key: string|null, error: string|null }} Validated key or validation error
   */
  extractIdempotencyKey(req, data = {}) {
    const headerRaw = req && req.headers
      ? (req.headers['idempotency-key'] !== undefined ? req.headers['idempotency-key'] : req.headers['x-idempotency-key'])
      : undefined;
    const bodyRaw = data && (data.idempotencyKey !== undefined ? data.idempotencyKey : data.idempotency_key);

    if (headerRaw === undefined && bodyRaw === undefined) {
      return { key: null, error: null };
    }

    if (headerRaw !== undefined && (typeof headerRaw !== 'string' || headerRaw.trim() === '')) {
      return { key: null, error: 'Invalid Idempotency-Key header: must be a non-empty string' };
    }

    if (bodyRaw !== undefined && (typeof bodyRaw !== 'string' || bodyRaw.trim() === '')) {
      return { key: null, error: 'Invalid idempotencyKey: must be a non-empty string' };
    }

    if (headerRaw !== undefined && bodyRaw !== undefined && headerRaw.trim() !== bodyRaw.trim()) {
      return { key: null, error: 'Conflicting idempotencyKey between header and request body' };
    }

    const key = (bodyRaw !== undefined ? bodyRaw : headerRaw).trim();
    return { key, error: null };
  }

  /**
   * Checks whether a send request matches the recipient and payload of an existing idempotency
   * record. `message` may be omitted when `codecEnvelope` or `canonicalMessage` was supplied
   * instead (Issue #76), so payload equality compares `message`, `codec`, `codecEnvelope`, and
   * `canonicalMessage` together rather than requiring `message` alone.
   * @param {object} record - Stored idempotency record
   * @param {object} data - Incoming direct message request body
   * @returns {boolean} True when recipient, sender (if provided), and full payload are identical
   */
  matchesIdempotencyRecord(record, data = {}) {
    const normalizeString = (value) => (typeof value === 'string' ? value : null);
    const hasPayload = typeof data.message === 'string' || Boolean(data.codecEnvelope) || Boolean(data.canonicalMessage);

    if (!record || !data || typeof data.to !== 'string' || !hasPayload) {
      return false;
    }

    let resolvedTargetId = null;
    try {
      resolvedTargetId = this.resolveWorkspaceId(data.to);
    } catch (e) {
      resolvedTargetId = null;
    }

    const recipientMatches = resolvedTargetId
      ? resolvedTargetId === record.targetId
      : (data.to === record.targetId || (record.to && data.to.toLowerCase() === String(record.to).toLowerCase()));

    const senderMatches = (data.from || null) === (record.from || null);
    const messageMatches = normalizeString(data.message) === normalizeString(record.message);
    const dataCodec = data.codec || (data.codecEnvelope && data.codecEnvelope.codec) || null;
    const codecMatches = dataCodec === (record.codec || null);
    const codecEnvelopeMatches = JSON.stringify(data.codecEnvelope || null) === JSON.stringify(record.codecEnvelope || null);
    const canonicalMessageMatches =
      JSON.stringify(data.canonicalMessage !== undefined ? data.canonicalMessage : null) ===
      JSON.stringify(record.canonicalMessage !== undefined ? record.canonicalMessage : null);

    return Boolean(
      recipientMatches &&
      senderMatches &&
      messageMatches &&
      codecMatches &&
      codecEnvelopeMatches &&
      canonicalMessageMatches
    );
  }

  /**
   * Builds a reconciliation receipt for a caller-supplied send idempotency key without mutating state.
   * @param {string} idempotencyKey - The caller-supplied idempotency key
   * @returns {object|null} Structured receipt or null if the key is unknown
   */
  getIdempotencyReceipt(idempotencyKey) {
    if (
      !idempotencyKey ||
      this.pendingIdempotencySaves.has(idempotencyKey) ||
      !this.idempotencyRecords.has(idempotencyKey)
    ) {
      return null;
    }

    const record = this.idempotencyRecords.get(idempotencyKey);
    const queue = this.offlineQueues.get(record.targetId) || [];
    const inQueue = queue.some(msg => msg.id === record.messageId);
    const isAcked = Boolean(record.acked || (!inQueue && record.status === 'acked'));
    const status = isAcked ? 'acked' : (record.delivered ? 'received' : 'queued');

    return {
      found: true,
      idempotencyKey: record.idempotencyKey,
      id: record.messageId,
      messageId: record.messageId,
      from: record.from,
      to: record.targetId,
      requestedTo: record.to,
      status,
      queued: inQueue,
      delivered: Boolean(record.delivered || isAcked),
      acked: isAcked,
      timestamp: record.createdAt,
      deliveredAt: record.deliveredAt || null,
      ackedAt: record.ackedAt || null
    };
  }

  /**
   * Builds a decode context for `codecEnvelope.codec`, hydrating any snapshot the encoder
   * attached to `codecEnvelope.metadata` so a stateful codec's envelope can be decoded standalone
   * by a recipient that was never part of the original encoding session — including a Turn 2+
   * envelope whose delta assumes a base state the recipient never saw directly (Issue #76 R-Gate
   * Round 2 & Round 3):
   * - `blackboard-ref-v1`: its wire payload carries only `@art:` pointers, never the referenced
   *   heavy-field values, so those values travel in `metadata.blackboardArtifacts`. Each entry is
   *   re-hashed via `store.put(value)` rather than trusted at face value — a forged `(hash, value)`
   *   pair is never stored under the hash it claims, so a pointer referencing it still correctly
   *   fails as `MISSING_ARTIFACT` instead of resolving to unverified content.
   * - `json-patch-v1` / `graph-delta-v1`: a Turn 2+ delta's `baseVersion` is > 0, so a fresh
   *   receiver store would fail `MISSING_BASE_VERSION`. `metadata.patchBaseSnapshot` /
   *   `graphBaseSnapshot` (captured by the encoder BEFORE its own call mutated the sender's
   *   store) resyncs a fresh store to that base before decode applies the delta.
   * - `dict-intern-v1`: a Turn 2+ message may reference symbols interned on an earlier turn and
   *   omit them from `newSymbols`, so a fresh table would fail `UNRESOLVED_SYMBOL_REF`.
   *   `metadata.symbolTableSnapshot` (captured by the encoder AFTER its own call, so it reflects
   *   every symbol known up to and including this turn) resyncs a fresh table before decode.
   * @param {object} codecEnvelope - Envelope to build a decode context for.
   * @param {object} [extraContext={}] - Additional context fields to merge in, taking precedence
   *   over anything hydrated from `codecEnvelope.metadata`.
   * @returns {object}
   */
  buildCodecDecodeContext(codecEnvelope, extraContext = {}) {
    const context = {};
    const metadata = (codecEnvelope && codecEnvelope.metadata) || {};
    const codecId = codecEnvelope && codecEnvelope.codec;

    if (codecId === 'blackboard-ref-v1') {
      const store = new BlackboardStore();
      if (Array.isArray(metadata.blackboardArtifacts)) {
        for (const entry of metadata.blackboardArtifacts) {
          // Never trust the wire-claimed hash or assume a particular value shape (heavy fields
          // are often arrays/objects, not just strings) — only require the [hash, value] tuple
          // shape; store.put() recomputes the real hash from whatever value is actually there.
          if (Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string') {
            store.put(entry[1]);
          }
        }
      }
      context.store = store;
    } else if (codecId === 'json-patch-v1' && metadata.patchBaseSnapshot) {
      const receiverStore = new FlatStateRegister();
      receiverStore.importSnapshot(metadata.patchBaseSnapshot);
      context.receiverStore = receiverStore;
    } else if (codecId === 'graph-delta-v1' && metadata.graphBaseSnapshot) {
      const receiverStore = new SharedGraphStore();
      receiverStore.importSnapshot(metadata.graphBaseSnapshot);
      context.receiverStore = receiverStore;
    } else if (codecId === 'dict-intern-v1' && metadata.symbolTableSnapshot) {
      const receiverTable = new SharedSymbolTable();
      receiverTable.importSnapshot(metadata.symbolTableSnapshot);
      context.receiverTable = receiverTable;
    }

    return { ...context, ...extraContext };
  }

  /**
   * Decodes `codecEnvelope` via `this.codecRegistry`, hydrating its decode context from any
   * snapshot the encoder attached to `codecEnvelope.metadata` (Issue #76 R-Gate Round 2). Always
   * decodes from `codecEnvelope.wireText` — the actual wire bytes — never from `codecEnvelope`
   * as a whole object, which would let a codec's object-form `decode()` take its
   * payload-preferring shortcut and skip validating what was actually transmitted. Any error
   * thrown while hydrating or decoding a malformed `metadata` snapshot (e.g. a `graphBaseSnapshot`
   * with a `null` node) is caught and returned as a structured failure, never left to propagate
   * into an uncaught 500 (Issue #76 R-Gate Round 4).
   * @param {object} codecEnvelope - Envelope produced by `encode()` / `encodeCanonicalMessageWithCodec()`.
   * @param {object} [extraContext={}] - Additional context to merge in, taking precedence.
   * @returns {{ ok: boolean, code?: string, message: object|null, errors: string[], warnings: string[] }}
   */
  decodeWithCodec(codecEnvelope, extraContext = {}) {
    if (!codecEnvelope || typeof codecEnvelope.wireText !== 'string') {
      return { ok: false, message: null, errors: ['codecEnvelope.wireText must be a string'], warnings: [] };
    }
    try {
      const context = this.buildCodecDecodeContext(codecEnvelope, extraContext);
      return this.codecRegistry.decode(codecEnvelope.wireText, codecEnvelope.codec, context);
    } catch (err) {
      return { ok: false, message: null, errors: [`Malformed codecEnvelope.metadata: ${err.message}`], warnings: [] };
    }
  }

  /**
   * Encodes `canonicalMessage` with `codecId` via `this.codecRegistry` against a fresh,
   * request-scoped store (the Hub holds no persistent per-pair codec session), capturing
   * whatever that store needs to make the envelope decodable standalone and attaching it to
   * `envelope.metadata` (Issue #76 R-Gate Round 2 & Round 3): `blackboardArtifacts` for
   * `blackboard-ref-v1` (its heavy fields live only in the store, never the wire payload),
   * `patchBaseSnapshot` / `graphBaseSnapshot` for `json-patch-v1` / `graph-delta-v1` (the
   * pre-encode, base-version snapshot a receiver resyncs to before applying the delta), and
   * `symbolTableSnapshot` for `dict-intern-v1` (the post-encode symbol table, so a reused symbol
   * this message doesn't redefine still resolves). Since this method always starts from a fresh
   * store, every envelope it produces is already a "Turn 1" by construction — the snapshots are
   * attached uniformly for consistency with `MedusaClient.encodeWithCodec()`, which a caller CAN
   * drive multi-turn with a persistent context.
   * @param {string} codecId - Registered codec id.
   * @param {object} canonicalMessage - Canonical semantic message to encode.
   * @returns {{ ok: boolean, envelope?: object, code?: string, error?: string, usedFallback?: boolean }}
   */
  encodeCanonicalMessageWithCodec(codecId, canonicalMessage) {
    const context = {};
    let blackboardStore = null;
    let patchBaseSnapshot = null;
    let graphBaseSnapshot = null;
    let symbolTable = null;

    if (codecId === 'blackboard-ref-v1') {
      blackboardStore = new BlackboardStore();
      MedusaServer.bindStoreToRecipient(blackboardStore, canonicalMessage);
      context.store = blackboardStore;
    } else if (codecId === 'json-patch-v1') {
      const senderStore = new FlatStateRegister();
      MedusaServer.bindStoreToRecipient(senderStore, canonicalMessage);
      patchBaseSnapshot = senderStore.exportSnapshot();
      context.senderStore = senderStore;
    } else if (codecId === 'graph-delta-v1') {
      const senderStore = new SharedGraphStore();
      MedusaServer.bindStoreToRecipient(senderStore, canonicalMessage);
      graphBaseSnapshot = senderStore.exportSnapshot();
      context.senderStore = senderStore;
    } else if (codecId === 'dict-intern-v1') {
      symbolTable = new SharedSymbolTable();
      MedusaServer.bindStoreToRecipient(symbolTable, canonicalMessage);
      context.senderTable = symbolTable;
    }

    const result = this.codecRegistry.encode(codecId, canonicalMessage, context);
    if (!result.ok) {
      return result;
    }

    const metadata = { ...result.envelope.metadata };
    if (blackboardStore) {
      metadata.blackboardArtifacts = Array.from(blackboardStore.artifacts.entries());
    }
    if (patchBaseSnapshot) {
      metadata.patchBaseSnapshot = patchBaseSnapshot;
    }
    if (graphBaseSnapshot) {
      metadata.graphBaseSnapshot = graphBaseSnapshot;
    }
    if (symbolTable) {
      metadata.symbolTableSnapshot = symbolTable.exportSnapshot();
    }
    result.envelope.metadata = metadata;

    return result;
  }

  /**
   * Validates a caller-supplied `codecEnvelope` for `POST /messages/direct` (Issue #76):
   * confirms `codecEnvelope.codec` names a codec registered in `this.codecRegistry`, that
   * `wireText` and `humanAuditText` are non-empty strings, that the wire text actually decodes
   * into a structurally valid canonical message (for every codec, stateful or not — hydrating
   * shared-state context from `codecEnvelope.metadata` via `decodeWithCodec()`), and — when the
   * caller also supplied `payload` — that `payload` agrees with what `wireText` actually decodes
   * to, so a valid `payload` can never paper over corrupt or mismatched `wireText` (Issue #76
   * R-Gate Round 2). When `targetRecipient` is given, also rejects a `patchBaseSnapshot` whose
   * captured state was addressed to a DIFFERENT recipient — a defense-in-depth backstop for
   * `MedusaClient`'s own cross-recipient-reuse guard, in case an envelope reaches the Hub by some
   * other path (Issue #76 R-Gate Round 4). Any error thrown while decoding or hydrating a
   * malformed `metadata` snapshot is caught and reported as `INVALID_CODEC_ENVELOPE`, never left
   * to propagate into an uncaught 500.
   * @param {*} codecEnvelope - Caller-supplied codec envelope.
   * @param {string} [targetRecipient] - The `to` this envelope is actually being sent to.
   * @returns {{ ok: boolean, code?: string, error?: string }}
   */
  validateCodecEnvelope(codecEnvelope, targetRecipient) {
    if (!codecEnvelope || typeof codecEnvelope !== 'object') {
      return { ok: false, code: 'INVALID_CODEC_ENVELOPE', error: 'codecEnvelope must be an object' };
    }

    const codec = this.codecRegistry.get(codecEnvelope.codec);
    if (!codec) {
      return { ok: false, code: 'UNSUPPORTED_CODEC', error: `Unknown or unsupported codec ID: "${codecEnvelope.codec}"` };
    }

    if (typeof codecEnvelope.wireText !== 'string' || codecEnvelope.wireText.length === 0) {
      return { ok: false, code: 'INVALID_CODEC_ENVELOPE', error: 'codecEnvelope.wireText must be a non-empty string' };
    }
    if (typeof codecEnvelope.humanAuditText !== 'string' || codecEnvelope.humanAuditText.length === 0) {
      return { ok: false, code: 'INVALID_CODEC_ENVELOPE', error: 'codecEnvelope.humanAuditText must be a non-empty string' };
    }

    const snapshotState = codecEnvelope.metadata && codecEnvelope.metadata.patchBaseSnapshot &&
      codecEnvelope.metadata.patchBaseSnapshot.state;
    if (
      targetRecipient !== undefined && snapshotState && typeof snapshotState === 'object' &&
      snapshotState.to !== undefined && snapshotState.to !== targetRecipient
    ) {
      return { ok: false, code: 'INVALID_CODEC_ENVELOPE', error: 'Cross-recipient stateful snapshot rejected' };
    }

    const decodedFromWire = this.decodeWithCodec(codecEnvelope);
    if (!decodedFromWire.ok) {
      return {
        ok: false,
        code: 'INVALID_CODEC_ENVELOPE',
        error: `codecEnvelope failed to decode: ${(decodedFromWire.errors || []).join('; ') || 'unknown decode error'}`
      };
    }

    const semanticCheck = validateCanonicalMessage(decodedFromWire.message);
    if (!semanticCheck.structuralValid) {
      return {
        ok: false,
        code: 'INVALID_CODEC_ENVELOPE',
        error: `codecEnvelope decoded to a structurally invalid canonical message: ${semanticCheck.structuralErrors.join('; ')}`
      };
    }

    if (codecEnvelope.payload !== undefined) {
      let decodedFromPayload;
      try {
        decodedFromPayload = codec.decode(
          { codec: codecEnvelope.codec, payload: codecEnvelope.payload, wireText: codecEnvelope.wireText },
          this.buildCodecDecodeContext(codecEnvelope)
        );
      } catch (err) {
        return { ok: false, code: 'INVALID_CODEC_ENVELOPE', error: `Malformed codecEnvelope.metadata: ${err.message}` };
      }
      if (!decodedFromPayload.ok || JSON.stringify(decodedFromWire.message) !== JSON.stringify(decodedFromPayload.message)) {
        return {
          ok: false,
          code: 'INVALID_CODEC_ENVELOPE',
          error: 'codecEnvelope.payload does not match decoded wireText'
        };
      }
    }

    return { ok: true };
  }

  /**
   * Reaps stale disconnected workspaces based on lastSeen TTL.
   */
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
        this.listenerStatus.delete(id);
        changed = true;
        this.log(`🧹 TTL-expired and reaped stale workspace: ${id}`);
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
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Workspace-ID, Idempotency-Key, X-Idempotency-Key');
      
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
            gitSha: MEDUSA_GIT_SHA,
            startedAt: this.serverMetadata.startedAt,
            capabilities: HUB_CAPABILITIES,
            supportedCodecs: this.codecRegistry.listCapabilities().map((cap) => cap.id),
            workspaces: Array.isArray(peers.data) ? peers.data.length : 0,
            messages: Array.isArray(messages.data) ? messages.data.length : 0,
            uptime: process.uptime(),
            a2a_connected: a2aHealth.ok,
            updaterStatus: this.updateManager ? this.updateManager.lastCheckStatus || 'Pending initial check' : 'Uninitialized'
          }));
        } catch (error) {
          res.statusCode = 200;
          res.end(JSON.stringify({ status: 'degraded', error: error.message }));
        }
        return;
      }

      // Hub version/capability manifest endpoint (Issue #70)
      if (pathname === '/version' && req.method === 'GET') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          version: MEDUSA_VERSION,
          gitSha: MEDUSA_GIT_SHA,
          startedAt: this.serverMetadata.startedAt,
          capabilities: HUB_CAPABILITIES,
          supportedCodecs: this.codecRegistry.listCapabilities().map((cap) => cap.id)
        }));
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
              name: this.fallbackWorkspaceName(id),
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
          
          const requestedId = data.workspaceId;
          if (requestedId && this.workspaceRegistry.has(requestedId)) {
            const existing = this.workspaceRegistry.get(requestedId);
            if (existing.path !== workspacePath || existing.name !== name) {
              res.statusCode = 409;
              res.end(JSON.stringify({ error: 'Workspace ID collision' }));
              return;
            }
          }
          
          const workspaceId = requestedId || `${name.toLowerCase().replace(/\s+/g, '-')}-${crypto.randomBytes(4).toString('hex')}`;
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
          
          this.log(`🐍 Registered new workspace: ${name} (${workspaceId})`);
          
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
            this.listenerStatus.delete(workspaceId);
            await this.saveRegistry();
            this.log(`🧹 Deregistered/Deleted workspace: ${workspaceId}`);
            
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
          
          this.log(`🧠 Context shared from ${from} to ${targets && targets.length > 0 ? targets.join(', ') : 'all'}`);
          
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
          const { key: idempotencyKey, error: keyError } = this.extractIdempotencyKey(req, data);
          if (keyError) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: keyError, code: 'INVALID_IDEMPOTENCY_KEY' }));
            return;
          }

          // Opt-in experimental codec negotiation (Issue #76): accept either a caller-supplied
          // codecEnvelope, or a { codec, canonicalMessage } pair the Hub encodes on the caller's
          // behalf. Resolved BEFORE any idempotency replay check so replay matching compares the
          // same normalized shape every time.
          if (data.codecEnvelope !== undefined && data.codecEnvelope !== null) {
            if (
              data.codec !== undefined && data.codec !== null &&
              data.codecEnvelope && data.codec !== data.codecEnvelope.codec
            ) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({
                error: `codec "${data.codec}" does not match codecEnvelope.codec "${data.codecEnvelope.codec}"`,
                code: 'INVALID_CODEC_ENVELOPE'
              }));
              return;
            }

            const validation = this.validateCodecEnvelope(data.codecEnvelope, data.to);
            if (!validation.ok) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: validation.error, code: validation.code }));
              return;
            }
            data.codec = data.codecEnvelope.codec;
          } else if (data.codec !== undefined && data.codec !== null) {
            if (data.canonicalMessage === undefined) {
              const isKnownCodec = Boolean(this.codecRegistry.get(data.codec));
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({
                error: isKnownCodec
                  ? `codec "${data.codec}" was supplied without a codecEnvelope or canonicalMessage to encode`
                  : `Unknown or unsupported codec ID: "${data.codec}"`,
                code: isKnownCodec ? 'INVALID_CODEC_ENVELOPE' : 'UNSUPPORTED_CODEC'
              }));
              return;
            }

            const encResult = this.encodeCanonicalMessageWithCodec(data.codec, data.canonicalMessage);
            if (!encResult.ok) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: encResult.error, code: encResult.code }));
              return;
            }
            data.codecEnvelope = encResult.envelope;
            data.codec = encResult.envelope.codec;
          }

          if (data.codecEnvelope && (typeof data.message !== 'string' || data.message.length === 0)) {
            // Legacy clients and older messages always carry a human-readable `message`; fall
            // back to the codec's own audit text so they still see something sensible.
            data.message = data.codecEnvelope.humanAuditText;
          }

          if (idempotencyKey && this.pendingIdempotencySaves.has(idempotencyKey)) {
            const pending = this.pendingIdempotencySaves.get(idempotencyKey);
            if (!this.matchesIdempotencyRecord(pending.record, data)) {
              res.statusCode = 409;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({
                error: 'Idempotency key conflict: key already used with different recipient or payload',
                code: 'IDEMPOTENCY_KEY_CONFLICT',
                idempotencyKey
              }));
              return;
            }

            try {
              await pending.promise;
            } catch (persistError) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({
                error: `Failed to persist message to durable Hub queue: ${persistError.message}`,
                code: 'PERSISTENCE_FAILED'
              }));
              return;
            }
          }

          if (idempotencyKey && this.idempotencyRecords.has(idempotencyKey)) {
            const existingRecord = this.idempotencyRecords.get(idempotencyKey);
            if (!this.matchesIdempotencyRecord(existingRecord, data)) {
              res.statusCode = 409;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({
                error: 'Idempotency key conflict: key already used with different recipient or payload',
                code: 'IDEMPOTENCY_KEY_CONFLICT',
                idempotencyKey
              }));
              return;
            }

            const receipt = this.getIdempotencyReceipt(idempotencyKey);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              success: true,
              replayed: true,
              idempotencyKey,
              status: receipt.status,
              id: existingRecord.messageId,
              messageId: existingRecord.messageId,
              receipt,
              message: 'Idempotent replay: returning original message receipt without re-enqueueing.'
            }));
            return;
          }
          
          let targetId;
          try {
            targetId = this.resolveWorkspaceId(data.to);
          } catch (err) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
            return;
          }
          
          if (!targetId) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: `Peer/Workspace ${data.to} not found. If this is a stale ID, try passing the human-readable name in 'to' instead.` }));
            return;
          }
          
          const isOnline = this.wsClients.has(targetId);
          let directDelivered = false;
          let generatedId = crypto.randomUUID();
          const timestamp = new Date().toISOString();
          
          const msgPayload = {
            id: generatedId,
            type: 'direct',
            from: data.from,
            to: targetId,
            message: data.message,
            timestamp: timestamp
          };
          if (data.codecEnvelope) {
            msgPayload.codec = data.codecEnvelope.codec;
            msgPayload.codecEnvelope = data.codecEnvelope;
          }
          if (idempotencyKey) {
            msgPayload.idempotencyKey = idempotencyKey;
          }

          // Always queue in offlineQueues (durable inbox) until explicitly ACK'd
          const hadQueue = this.offlineQueues.has(targetId);
          if (!hadQueue) {
            this.offlineQueues.set(targetId, []);
          }
          const targetQueue = this.offlineQueues.get(targetId);
          targetQueue.push(msgPayload);

          let idempotencyRecord = null;
          if (idempotencyKey) {
            idempotencyRecord = {
              idempotencyKey,
              messageId: generatedId,
              from: data.from || null,
              to: data.to,
              targetId,
              message: data.message,
              codec: data.codecEnvelope ? data.codecEnvelope.codec : null,
              codecEnvelope: data.codecEnvelope || null,
              canonicalMessage: data.canonicalMessage !== undefined ? data.canonicalMessage : null,
              status: isOnline ? 'received' : 'queued',
              delivered: false,
              acked: false,
              createdAt: timestamp,
              deliveredAt: null,
              ackedAt: null
            };
            this.idempotencyRecords.set(idempotencyKey, idempotencyRecord);
          }

          // Persist queue and idempotency key atomically BEFORE live WebSocket delivery or A2A propagation
          const rawSavePromise = this.saveRegistry({ throwOnError: true }).then(
            () => {
              if (idempotencyKey) {
                this.pendingIdempotencySaves.delete(idempotencyKey);
              }
            },
            (persistError) => {
              const idx = targetQueue.indexOf(msgPayload);
              if (idx !== -1) {
                targetQueue.splice(idx, 1);
              }
              if (!hadQueue && targetQueue.length === 0) {
                this.offlineQueues.delete(targetId);
              }
              if (idempotencyKey) {
                this.idempotencyRecords.delete(idempotencyKey);
                this.pendingIdempotencySaves.delete(idempotencyKey);
              }
              throw persistError;
            }
          );

          if (idempotencyKey && idempotencyRecord) {
            this.pendingIdempotencySaves.set(idempotencyKey, {
              record: idempotencyRecord,
              promise: rawSavePromise
            });
          }

          try {
            await rawSavePromise;
          } catch (persistError) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              error: `Failed to persist message to durable Hub queue: ${persistError.message}`,
              code: 'PERSISTENCE_FAILED'
            }));
            return;
          }

          if (isOnline) {
            directDelivered = this.sendWebSocketMessage(targetId, {
              type: 'new_message',
              messageId: generatedId,
              message: msgPayload
            });
            if (directDelivered && idempotencyKey && this.idempotencyRecords.has(idempotencyKey)) {
              const rec = this.idempotencyRecords.get(idempotencyKey);
              rec.delivered = true;
              rec.deliveredAt = timestamp;
              rec.status = 'received';
              await this.saveRegistry();
            }
          }
          
          // Also attempt to propagate through the A2A mesh (fails gracefully if node is down)
          const result = await this.callA2A('POST', '/a2a/messages/send', {
            sender_id: data.from,
            recipient_id: targetId,
            content: data.message
          }).catch(() => ({ ok: false, status: 503 }));
          
          if (result.ok && result.data && result.data.id) {
            msgPayload.a2aId = result.data.id;
          }

          const responsePayload = { 
            success: true, 
            status: isOnline ? 'received' : 'queued', 
            id: msgPayload.id,
            messageId: msgPayload.id,
            message: isOnline 
              ? 'Message delivered directly to workspace via WebSocket.' 
              : 'Workspace offline. Message queued in Hub inbox.'
          };
          if (idempotencyKey) {
            responsePayload.idempotencyKey = idempotencyKey;
            responsePayload.replayed = false;
            responsePayload.receipt = this.getIdempotencyReceipt(idempotencyKey);
          }

          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(responsePayload));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }

      // Lookup send receipt by idempotency key without creating a message (Issue #67)
      if ((pathname === '/messages/receipts' || pathname.startsWith('/messages/receipts/') || pathname.startsWith('/messages/idempotency/')) && req.method === 'GET') {
        try {
          let rawKey = null;
          if (pathname === '/messages/receipts') {
            rawKey = url.searchParams.get('idempotencyKey') || url.searchParams.get('key');
          } else if (pathname.startsWith('/messages/receipts/')) {
            rawKey = decodeURIComponent(pathname.slice('/messages/receipts/'.length));
          } else if (pathname.startsWith('/messages/idempotency/')) {
            rawKey = decodeURIComponent(pathname.slice('/messages/idempotency/'.length));
          }

          if (!rawKey || !rawKey.trim()) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              error: 'Missing required idempotencyKey parameter',
              code: 'INVALID_IDEMPOTENCY_KEY'
            }));
            return;
          }

          const key = rawKey.trim();
          if (this.pendingIdempotencySaves.has(key)) {
            await this.pendingIdempotencySaves.get(key).promise.catch(() => {});
          }
          const receipt = this.getIdempotencyReceipt(key);
          if (!receipt) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              found: false,
              error: 'Idempotency receipt not found',
              code: 'RECEIPT_NOT_FOUND',
              idempotencyKey: key
            }));
            return;
          }

          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(receipt));
        } catch (error) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
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
          await this.ackMessages(workspaceId, ids);
          
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
          
          let wsCount = 0;
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
              wsCount++;
            }
          }

          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json');
          
          const responseData = { 
            success: result.ok, 
            ...result.data, 
            workspaces: wsCount 
          };
          if (typeof result.data?.recipients === 'number') {
            responseData.peers = result.data.recipients;
          }
          
          res.end(JSON.stringify(responseData));
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
          let initId, targetId;
          try {
            initId = this.resolveWorkspaceId(initiator);
            targetId = this.resolveWorkspaceId(target);
          } catch (err) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
            return;
          }

          if (!initId || !targetId) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Initiator or target workspace not found' }));
            return;
          }
          
          const loopId = crypto.randomUUID();
          const now = new Date();
          const loopObj = {
            id: loopId,
            initiator: initId,
            target: targetId,
            task,
            doneCriteria,
            mode: mode || 'supervised',
            guards: guards || { maxRounds: 10, maxWallTimeSeconds: 600 },
            round: 0,
            state: 'initiated',
            closeSignal: null,
            createdAt: now.toISOString(),
            startedAt: null,
            messages: []
          };
          
          this.loops.set(loopId, loopObj);

          // Deliver loop invitation to the target workspace
          const inviteMsgId = crypto.randomUUID();
          const invitePayload = {
            id: inviteMsgId,
            type: 'direct',
            from: initId,
            to: targetId,
            message: `New loop invitation from ${initId} for task: "${task}"`,
            timestamp: now.toISOString(),
            loopId: loopId,
            loopInvite: {
              id: loopId,
              initiator: initId,
              target: targetId,
              task,
              doneCriteria,
              mode: loopObj.mode,
              guards: loopObj.guards,
              replyEndpoint: `/loops/${loopId}/message`,
              replyInstruction: `To reply to this loop, you MUST send a POST request to /loops/${loopId}/message with {"from": "${targetId}", "message": "..."} rather than using a direct message.`
            }
          };

          // Always queue in offlineQueues (durable inbox) until explicitly ACK'd
          if (!this.offlineQueues.has(targetId)) {
            this.offlineQueues.set(targetId, []);
          }
          this.offlineQueues.get(targetId).push(invitePayload);

          // If target is online, deliver live via WebSocket
          const isOnline = this.wsClients.has(targetId);
          if (isOnline) {
            this.sendWebSocketMessage(targetId, {
              type: 'new_message',
              messageId: inviteMsgId,
              message: invitePayload
            });
          }

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
      
      // List all loops
      if (pathname === '/loops' && req.method === 'GET') {
        try {
          const participant = url.searchParams.get('participant');
          let participantId = null;
          if (participant) {
            try {
              participantId = this.resolveWorkspaceId(participant);
            } catch (err) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: err.message }));
              return;
            }
          }
          
          const list = [];
          const includeMessages = url.searchParams.get('include') === 'messages';
          for (const [id, loop] of this.loops.entries()) {
            this.checkWallTimeGuardForLoop(loop);
            
            if (!participantId || loop.initiator === participantId || loop.target === participantId) {
              const resObj = { ...loop };
              if (!includeMessages) {
                delete resObj.messages;
              }
              list.push(resObj);
            }
          }
          
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ loops: list, count: list.length }));
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
          return this.checkWallTimeGuardForLoop(loop);
        };
        
        checkWallTimeGuard();
        
        // 1. Read loop state (GET /loops/:id)
        if (!action && req.method === 'GET') {
          const includeMessages = url.searchParams.get('include') === 'messages';
          const responseObj = { ...loop };
          if (!includeMessages) {
            delete responseObj.messages;
          }
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(responseObj));
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
              if (!loop.startedAt) {
                loop.startedAt = new Date().toISOString();
              }
            } else {
              loop.state = 'continue';
            }
            
            if (!loop.messages) {
              loop.messages = [];
            }
            loop.messages.push({
              from,
              message,
              timestamp: new Date().toISOString()
            });
            
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
            
            if (closeSignal.reason === 'force-done' || closeSignal.forced === true) {
              loop.state = 'halted';
            } else {
              loop.state = 'complete';
            }
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

      // Peek at a workspace's state
      if (pathname.match(/^\/workspaces\/[^\/]+\/peek$/) && req.method === 'GET') {
        const workspaceId = pathname.split('/')[2];
        const statusData = this.listenerStatus.get(workspaceId) || { status: 'unreachable' };
        
        let paneTail = undefined;
        let reason = 'unknown';
        
        try {
          const { execSync } = require('child_process');
          // Capture the last 20 lines of the tmux pane. We use single quotes for security.
          paneTail = execSync(`tmux capture-pane -p -t '${workspaceId.replace(/'/g, "'\\''")}' -S -20 2>/dev/null`).toString('utf8').trim();
          
          if (paneTail.includes('? ') || paneTail.match(/\[[Yy]\/[Nn]\]/)) {
            reason = 'at-dialog';
          } else {
            reason = 'turn-in-flight';
          }
          
          if (statusData.status === 'unreachable') {
            statusData.status = 'busy'; 
          }
        } catch (e) {
          reason = 'no-tmux';
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          state: statusData.status || 'unreachable',
          reason: reason,
          lastActivity: statusData.lastHeartbeat || new Date().toISOString(),
          paneTail: paneTail
        }));
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
            this.log('⚠️ Mesh expansion rate limited (60s cooldown)');
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
            this.log(`❌ Mesh expansion cap hit (${liveChildren} children)`);
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
            
            this.log(`🛡️ HITL Gate: Spawn request ${requestId} queued for operator approval`);
            
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
          this.log(`📉 Mesh contraction: Node ${node_id} reported ${kind}`);
          
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

          this.log(`✅ Operator approved spawn request ${requestId}`);
          
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
          this.log(`❌ Operator denied spawn request ${requestId}`);
          
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

  /**
   * Configures WebSocket connection, registration, heartbeat, and ACK handlers.
   */
  setupWebSocketHandlers() {
    this.wsServer.on('connection', (ws, req) => {
      this.log('🔌 WebSocket client connected');
      
      let workspaceId = null;
      let isRegistered = false;
      let connectionId = `conn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());
          
          if (message.type === 'register' && !isRegistered) {
            workspaceId = message.workspaceId;
            
            // Persist the workspace registration from the WS register frame if not present
            if (!this.workspaceRegistry.has(workspaceId)) {
              const now = new Date();
              const wsObj = {
                id: workspaceId,
                name: message.name || this.fallbackWorkspaceName(workspaceId),
                path: message.path || '',
                type: message.clientType || 'medusa',
                registeredAt: now.toISOString(),
                lastSeen: now.toISOString()
              };
              this.workspaceRegistry.set(workspaceId, wsObj);
              this.saveRegistry();
            } else if (message.name) {
              const wsObj = this.workspaceRegistry.get(workspaceId);
              wsObj.name = message.name;
              wsObj.lastSeen = new Date().toISOString();
              this.workspaceRegistry.set(workspaceId, wsObj);
              this.saveRegistry();
            }

            if (!this.wsClients.has(workspaceId)) {
              this.wsClients.set(workspaceId, new Map());
            }
            
            this.wsClients.get(workspaceId).set(connectionId, ws);
            isRegistered = true;
            this.updateListenerHeartbeat(workspaceId, 'active', { recordLog: false });
            
            ws.send(JSON.stringify({
              type: 'registered',
              workspaceId,
              connectionId,
              version: MEDUSA_VERSION,
              gitSha: MEDUSA_GIT_SHA,
              startedAt: this.serverMetadata.startedAt,
              capabilities: HUB_CAPABILITIES,
              supportedCodecs: this.codecRegistry.listCapabilities().map((cap) => cap.id),
              message: 'WebSocket connection established for real-time messaging'
            }));

            this.log(`🔌 WebSocket registered for workspace: ${workspaceId} (${connectionId})`);

            // Notify a reconnecting subscriber of a Hub version/capability upgrade it missed
            // while disconnected (Issue #70).
            if (this.pendingVersionTransition) {
              ws.send(JSON.stringify(this.buildVersionUpdatedFrame(this.pendingVersionTransition)));
            }
            
            // Drain offline queue and deliver immediately over WS!
            if (this.offlineQueues.has(workspaceId)) {
              const queuedMsgs = this.offlineQueues.get(workspaceId);
              let deliveryUpdated = false;
              const deliveredAt = new Date().toISOString();
              for (const queuedMsg of queuedMsgs) {
                ws.send(JSON.stringify({
                  type: 'new_message',
                  messageId: queuedMsg.id,
                  message: queuedMsg
                }));
                if (queuedMsg.idempotencyKey && this.idempotencyRecords.has(queuedMsg.idempotencyKey)) {
                  const rec = this.idempotencyRecords.get(queuedMsg.idempotencyKey);
                  rec.delivered = true;
                  rec.deliveredAt = rec.deliveredAt || deliveredAt;
                  if (rec.status === 'queued') {
                    rec.status = 'received';
                  }
                  deliveryUpdated = true;
                }
              }
              if (deliveryUpdated) {
                this.saveRegistry();
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
              await this.ackMessages(workspaceId, ids);
              ws.send(JSON.stringify({
                type: 'ack_response',
                success: true,
                messageIds: ids
              }));
            }
          }
          
          if (message.type === 'listener_heartbeat' && isRegistered) {
            const status = message.status || 'active';
            const statusChanged = this.updateListenerHeartbeat(workspaceId, status);
            
            ws.send(JSON.stringify({ 
              type: 'heartbeat_ack', 
              timestamp: Date.now(),
              autonomousMode: status === 'active'
            }));
            
            if (statusChanged || this.isDebugEnabled()) {
              this.log(`💓 Listener heartbeat from ${workspaceId}: ${status}`);
            }
          }
          
        } catch (error) {
          this.logError('WebSocket message error:', error);
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
            this.listenerStatus.delete(workspaceId);
            // Reap on WS close (unless server is shutting down)
            if (!this.isStopping) {
              this.workspaceRegistry.delete(workspaceId);
              this.saveRegistry();
            }
          }
          this.log(`🔌 WebSocket disconnected for workspace: ${workspaceId} (${connectionId})`);
        }
      });
      
      ws.on('error', (error) => {
        this.logError('WebSocket error:', error);
        if (workspaceId && this.wsClients.has(workspaceId)) {
          const connections = this.wsClients.get(workspaceId);
          connections.delete(connectionId);
          if (connections.size === 0) {
            this.wsClients.delete(workspaceId);
            this.listenerStatus.delete(workspaceId);
          }
        }
      });
    });
  }

  /**
   * Acknowledge delivered messages for a workspace, removing them from the durable queue
   * and marking any associated idempotency receipts as acked.
   * @param {string} workspaceId - The acknowledging workspace ID
   * @param {string[]} messageIds - Array of message IDs to acknowledge
   * @returns {Promise<void>}
   */
  async ackMessages(workspaceId, messageIds) {
    let changed = false;
    if (this.offlineQueues.has(workspaceId)) {
      const queue = this.offlineQueues.get(workspaceId);
      const updatedQueue = queue.filter(msg => !messageIds.includes(msg.id));
      if (updatedQueue.length !== queue.length) {
        changed = true;
      }
      if (updatedQueue.length === 0) {
        this.offlineQueues.delete(workspaceId);
      } else {
        this.offlineQueues.set(workspaceId, updatedQueue);
      }
    }

    const ackedAt = new Date().toISOString();
    for (const record of this.idempotencyRecords.values()) {
      if (record.targetId === workspaceId && messageIds.includes(record.messageId) && !record.acked) {
        record.status = 'acked';
        record.acked = true;
        record.delivered = true;
        record.deliveredAt = record.deliveredAt || ackedAt;
        record.ackedAt = ackedAt;
        changed = true;
      }
    }

    if (changed) {
      await this.saveRegistry();
    }
    this.log(`✅ ACKed ${messageIds.length} messages for workspace: ${workspaceId}`);
  }

  /**
   * Sends a real-time message payload to all active WebSocket connections for a workspace.
   * @param {string} workspaceId - Target workspace identifier.
   * @param {object} messageData - Message payload to serialize and send.
   * @returns {boolean} True if delivered to at least one open WebSocket connection.
   */
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
            this.logError(`WebSocket send error (${connId}):`, error);
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
        this.log(`🔌 Message delivered instantly via WebSocket to ${connections.size} connection(s)!`);
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

  /**
   * Starts the Medusa HTTP protocol server, WebSocket server, and web dashboard.
   * @returns {Promise<boolean>} Resolves true once all servers are listening.
   */
  async start() {
    this.log('🐍 Starting Medusa Chat Protocol...');
    this.isStopping = false;
    
    try {
      await ProcessLock.cleanupStaleLocks();
      this.processLock = new ProcessLock('medusa-server');
      await this.processLock.acquire();
      
      const cwd = process.cwd();
      this.serverMetadata.controllingWorkspace = path.basename(cwd);
      this.log(`🎮 Server controlled by workspace: ${this.serverMetadata.controllingWorkspace}`);
      
      await this.loadRegistry();
      
      this.protocolServer = this.createProtocolServer();
      await new Promise(resolve => this.protocolServer.listen(this.protocolPort, this.protocolHost, resolve));
      
      this.log(`🐍 Medusa Protocol API running at http://${this.protocolHost}:${this.protocolPort}`);
      
      this.wsServer = new WebSocket.Server({
        port: this.protocolPort + 1,
        host: this.protocolHost
      });
      this.setupWebSocketHandlers();

      // Detect a version/commit upgrade since the last recorded run and announce it to any
      // already-connected subscribers; reconnecting subscribers are notified on registration
      // below (Issue #70).
      const versionTransition = this.detectVersionTransition();
      this.pendingVersionTransition = versionTransition.changed ? versionTransition : null;
      if (versionTransition.changed) {
        this.log(
          `🆙 Hub version transition detected: ${versionTransition.previousVersion} -> ${MEDUSA_VERSION} ` +
          `(gitSha ${versionTransition.previousGitSha} -> ${MEDUSA_GIT_SHA})`
        );
        this.broadcastToAllClients(this.buildVersionUpdatedFrame(versionTransition));
      }

      this.webServer = this.createWebServer();
      await new Promise(resolve => this.webServer.listen(this.webPort, this.webHost, resolve));
      
      this.log(`🐍 Switchboard running at http://${this.webHost}:${this.webPort}`);
      this.log(`🔌 WebSocket Server running at ws://${this.protocolHost}:${this.protocolPort + 1}`);
      this.log('\nThe two medusas are ready to hiss properly! 🐍🔥🐍');
      
      this.spawnReconcilerInterval = setInterval(() => {
        this.reconcileSpawnedChildren().catch(() => {});
      }, 30000); // every 30s

      // Start update polling
      this.updateManager.startPolling();

      return true;
    } catch (error) {
      this.logError(`❌ Failed to start Medusa server: ${error.message}`);
      if (this.processLock) await this.processLock.release();
      throw error;
    }
  }

  /**
   * Gracefully stops all Medusa servers, intervals, and locks.
   * @returns {Promise<void>}
   */
  async stop() {
    this.log('\n🐍 Medusa shutting down...');
    this.isStopping = true;
    
    if (this.processLock) await this.processLock.release();
    await this.saveRegistry();
    
    if (this.spawnReconcilerInterval) {
      clearInterval(this.spawnReconcilerInterval);
      this.spawnReconcilerInterval = null;
    }

    if (this.updateManager) {
      this.updateManager.stopPolling();
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
    this.log('🐍 Shutdown complete.');
  }

  /**
   * Instantiates and starts MedusaServer for CLI execution, routing both synchronous
   * constructor errors (such as missing A2A_SECRET) and asynchronous startup failures
   * through the ISO 8601 timestamped error logger before exiting with status 1.
   * @param {object} [options={}] - Server configuration options.
   * @param {object} [processObj=process] - Process object for signal registration and exit.
   * @returns {Promise<MedusaServer|null>} The started server instance, or null on fatal startup error.
   */
  static async runCli(options = {}, processObj = process) {
    let server;
    try {
      server = new MedusaServer(options);
    } catch (err) {
      MedusaServer.logError(err);
      processObj.exit(1);
      return null;
    }

    if (typeof processObj.on === 'function') {
      processObj.on('SIGINT', async () => {
        await server.stop();
        processObj.exit(0);
      });
    }

    try {
      await server.start();
      return server;
    } catch (err) {
      MedusaServer.logError(err);
      processObj.exit(1);
      return null;
    }
  }
}

// Start the servers if run directly
if (require.main === module) {
  MedusaServer.runCli();
}

// Export for testing
module.exports = MedusaServer;
