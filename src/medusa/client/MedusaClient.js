/**
 * 🐍 Medusa Protocol Client
 * 
 * Client library for Medusa workspace communication
 * Provides seamless integration with the Medusa Protocol Server
 */

const http = require('http');
const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const WebSocket = require('ws');
const { CodecRegistry } = require('../experiments/codecs/CodecRegistry');
const { TupleTableCodec } = require('../experiments/codecs/TupleTableCodec');
const { DictionaryInternCodec } = require('../experiments/codecs/DictionaryInternCodec');
const { JsonPatchDeltaCodec } = require('../experiments/codecs/JsonPatchDeltaCodec');
const { BlackboardRefCodec, BlackboardStore } = require('../experiments/codecs/BlackboardRefCodec');

class MedusaClient extends EventEmitter {
  constructor(options = {}) {
    super();

    this.serverUrl = options.serverUrl || 'http://localhost:3009';
    this.wsUrl = options.wsUrl || 'ws://localhost:3010';
    this.workspaceId = null;
    this.workspaceInfo = null;
    this.pollInterval = options.pollInterval || 5000; // 5 seconds
    this.polling = false;
    this.pollTimer = null;
    this.ws = null;
    this.wsReconnectAttempts = 0;
    this.maxWsReconnectAttempts = 5;
    this.processedMessages = null;
    this.lastPong = null;
    this.heartbeatInterval = null;
    this.codecRegistry = MedusaClient.buildCodecRegistry();

    // Create workspace-specific config file path
    const workspaceKey = options.workspaceKey || process.cwd();
    const configName = `medusa-config-${Buffer.from(workspaceKey).toString('base64').replace(/[^a-zA-Z0-9]/g, '')}.json`;
    this.configFile = path.join(os.homedir(), '.medusa', configName);
  }

  /**
   * Builds a `CodecRegistry` pre-loaded with all 9 experimental communication codecs — the 5
   * `CodecRegistry` default codecs plus `TupleTableCodec`, `DictionaryInternCodec`,
   * `JsonPatchDeltaCodec`, and `BlackboardRefCodec` — mirroring the Hub's own registry so
   * `encodeWithCodec` can produce a `codecEnvelope` the Hub will accept (Issue #76).
   * @returns {CodecRegistry}
   */
  static buildCodecRegistry() {
    const registry = new CodecRegistry();
    const extraCodecs = [new TupleTableCodec(), new DictionaryInternCodec(), new JsonPatchDeltaCodec(), new BlackboardRefCodec()];
    for (const codec of extraCodecs) {
      if (!registry.get(codec.capabilities().id)) {
        registry.register(codec);
      }
    }
    return registry;
  }
  
  /**
   * Make HTTP request to Medusa server
   */
  async request(method, path, data = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.serverUrl);
      
      const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'X-Workspace-ID': this.workspaceId || ''
        }
      };
      
      const req = http.request(options, (res) => {
        let body = '';
        
        res.on('data', (chunk) => {
          body += chunk.toString();
        });
        
        res.on('end', () => {
          try {
            const response = body ? JSON.parse(body) : {};
            
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(response);
            } else {
              const error = new Error(response.message || response.error || 'Request failed');
              error.status = res.statusCode;
              error.response = response;
              reject(error);
            }
          } catch (error) {
            reject(new Error(`Failed to parse response: ${error.message}`));
          }
        });
      });
      
      req.on('error', reject);
      
      if (data) {
        req.write(JSON.stringify(data));
      }
      
      req.end();
    });
  }
  
  /**
   * Check if Medusa server is running
   */
  async checkHealth() {
    try {
      const health = await this.request('GET', '/health');
      return {
        available: true,
        ...health
      };
    } catch (error) {
      return {
        available: false,
        error: error.message
      };
    }
  }
  
  /**
   * Register this workspace with Medusa
   */
  async register(name, workspacePath, type = 'medusa') {
    try {
      // First, check if a workspace with this name and path already exists
      const existingWorkspaces = await this.listWorkspaces();
      const existingWorkspace = existingWorkspaces.find(ws => 
        ws.name === name && ws.path === workspacePath
      );
      
      if (existingWorkspace) {
        // Use existing workspace instead of creating duplicate
        this.workspaceId = existingWorkspace.id;
        this.workspaceInfo = existingWorkspace;
        
        // Save config
        await this.saveConfig();
        
        this.emit('registered', existingWorkspace);
        console.log(`🐍 Reconnected to existing Medusa workspace: ${existingWorkspace.id}`);
        
        return existingWorkspace;
      }
      
      const response = await this.request('POST', '/workspaces/register', {
        name,
        path: workspacePath,
        type
      });
      
      if (response.success) {
        this.workspaceId = response.workspace.id;
        this.workspaceInfo = response.workspace;
        
        // Save config
        await this.saveConfig();
        
        this.emit('registered', response.workspace);
        console.log(`🐍 Registered with Medusa: ${response.message}`);
        
        return response.workspace;
      }
      
      throw new Error(response.message || 'Registration failed');
    } catch (error) {
      console.error('🐍 Registration failed:', error.message);
      throw error;
    }
  }
  
  /**
   * Load saved configuration
   */
  async loadConfig() {
    try {
      // Try to load workspace-specific config first
      const data = await fs.readFile(this.configFile, 'utf8');
      const config = JSON.parse(data);
      
      this.workspaceId = config.workspaceId;
      this.workspaceInfo = config.workspaceInfo;
      
      return config;
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Fallback: Try to load from old single config file for backward compatibility
        try {
          const oldConfigPath = path.join(os.homedir(), '.medusa', 'medusa-config.json');
          const data = await fs.readFile(oldConfigPath, 'utf8');
          const config = JSON.parse(data);
          
          // Check if this config is for the current workspace
          if (config.workspacePath === process.cwd()) {
            this.workspaceId = config.workspaceId;
            this.workspaceInfo = config.workspaceInfo;
            
            // Migrate to workspace-specific config
            await this.saveConfig();
            console.log('🐍 Migrated config to workspace-specific format');
            
            return config;
          }
        } catch (fallbackError) {
          // No config found, will need to register
        }
      } else {
        console.error('Error loading Medusa config:', error);
      }
      return null;
    }
  }

  /**
   * Save configuration
   */
  async saveConfig() {
    try {
      await fs.mkdir(path.dirname(this.configFile), { recursive: true });
      
      const config = {
        workspaceId: this.workspaceId,
        workspaceInfo: this.workspaceInfo,
        serverUrl: this.serverUrl,
        workspacePath: process.cwd()
      };
      
      await fs.writeFile(this.configFile, JSON.stringify(config, null, 2));
    } catch (error) {
      console.error('Error saving Medusa config:', error);
    }
  }
  
  /**
   * List all registered workspaces
   */
  async listWorkspaces() {
    try {
      const response = await this.request('GET', '/workspaces');
      return response.workspaces || [];
    } catch (error) {
      console.error('🐍 Failed to list workspaces:', error.message);
      return [];
    }
  }
  
  /**
   * Send a direct message to another workspace
   * @param {string} targetWorkspace - Target workspace ID or name
   * @param {string} [message] - Message content; may be omitted/empty when `metadata.codecEnvelope`
   *   or `metadata.canonicalMessage` is supplied, in which case the Hub falls back to the codec's
   *   own human-readable audit text (Issue #76).
   * @param {object} [metadata={}] - Optional metadata or options. May include `idempotencyKey`,
   *   `codec` (a registered codec id), `codecEnvelope` (pre-encoded, e.g. from `encodeWithCodec`),
   *   and/or `canonicalMessage` (raw message for the Hub to encode server-side with `codec`).
   * @returns {Promise<object>} Server response including message id and optional receipt
   */
  async sendMessage(targetWorkspace, message, metadata = {}) {
    if (!this.workspaceId) {
      throw new Error('Workspace not registered! Run "medusa register" first.');
    }

    try {
      const payload = {
        from: this.workspaceId,
        to: targetWorkspace,
        message,
        metadata
      };
      if (metadata && typeof metadata.idempotencyKey === 'string') {
        payload.idempotencyKey = metadata.idempotencyKey;
      }
      if (metadata && metadata.codec !== undefined) {
        payload.codec = metadata.codec;
      }
      if (metadata && metadata.codecEnvelope !== undefined) {
        payload.codecEnvelope = metadata.codecEnvelope;
      }
      if (metadata && metadata.canonicalMessage !== undefined) {
        payload.canonicalMessage = metadata.canonicalMessage;
      }

      const response = await this.request('POST', '/messages/direct', payload);
      
      if (response.success) {
        this.emit('messageSent', {
          to: targetWorkspace,
          message,
          messageId: response.messageId || response.id,
          idempotencyKey: response.idempotencyKey
        });
        
        return response;
      }
      
      throw new Error(response.message || 'Failed to send message');
    } catch (error) {
      console.error('🐍 Message send failed:', error.message);
      throw error;
    }
  }

  /**
   * Retrieve the delivery/enqueue receipt for an idempotent send without creating a message
   * @param {string} idempotencyKey - Caller-supplied idempotency key
   * @returns {Promise<object>} Receipt payload from the Medusa Hub
   */
  async getMessageReceipt(idempotencyKey) {
    if (!idempotencyKey || typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
      throw new Error('idempotencyKey is required');
    }
    return this.request('GET', `/messages/receipts/${encodeURIComponent(idempotencyKey.trim())}`);
  }

  /**
   * Encodes a canonical message with a registered experimental codec, producing a
   * `codecEnvelope` ready to pass as `metadata.codecEnvelope` to `sendMessage` (Issue #76's
   * opt-in codec negotiation). For `blackboard-ref-v1` — whose wire payload carries only
   * `@art:` pointers, never the referenced heavy-field values — captures whatever the encode
   * writes into its `BlackboardStore` and attaches it to `envelope.metadata.blackboardArtifacts`,
   * so the recipient (the Hub, or another client) can decode the envelope standalone via
   * `decodeWithCodec()` without a `MISSING_ARTIFACT` error (Issue #76 R-Gate Round 2).
   * @param {string} codecId - Registered codec id (e.g. `'compact-json-v1'`, `'json-patch-v1'`).
   * @param {object} canonicalMessage - Canonical semantic message to encode.
   * @param {object} [context={}] - Optional codec-specific encoding context (e.g. a shared store
   *   for stateful codecs); omitted for a fresh, stateless encode.
   * @returns {{ codec: string, schemaVersion: string, payload: *, wireText: string, humanAuditText: string, metadata: object }}
   * @throws {Error} When `codecId` is not registered or encoding fails.
   */
  encodeWithCodec(codecId, canonicalMessage, context = {}) {
    let effectiveContext = context;
    let capturedStore = context.store instanceof BlackboardStore ? context.store : null;
    if (codecId === 'blackboard-ref-v1' && !capturedStore) {
      capturedStore = new BlackboardStore();
      effectiveContext = { ...context, store: capturedStore };
    }

    const result = this.codecRegistry.encode(codecId, canonicalMessage, effectiveContext);
    if (!result.ok) {
      throw new Error(result.error || `Failed to encode message with codec "${codecId}"`);
    }

    if (capturedStore) {
      result.envelope.metadata = {
        ...result.envelope.metadata,
        blackboardArtifacts: Array.from(capturedStore.artifacts.entries())
      };
    }

    return result.envelope;
  }

  /**
   * Decodes a `codecEnvelope` via this client's own codec registry, hydrating a decode context
   * from any snapshot attached to `codecEnvelope.metadata` (currently only `blackboard-ref-v1`'s
   * `blackboardArtifacts`) so a server-encoded or peer-encoded envelope decodes standalone
   * (Issue #76 R-Gate Round 2). Always decodes from `codecEnvelope.wireText`.
   * @param {object} codecEnvelope - Envelope to decode (e.g. a received message's `codecEnvelope`).
   * @param {object} [extraContext={}] - Additional context to merge in, taking precedence.
   * @returns {{ ok: boolean, message: object|null, errors: string[], warnings: string[] }}
   */
  decodeWithCodec(codecEnvelope, extraContext = {}) {
    if (!codecEnvelope || typeof codecEnvelope.wireText !== 'string') {
      return { ok: false, message: null, errors: ['codecEnvelope.wireText must be a string'], warnings: [] };
    }

    const context = { ...extraContext };
    if (codecEnvelope.codec === 'blackboard-ref-v1' && !(context.store instanceof BlackboardStore)) {
      const store = new BlackboardStore();
      const snapshot = codecEnvelope.metadata && codecEnvelope.metadata.blackboardArtifacts;
      if (Array.isArray(snapshot)) {
        for (const [hash, value] of snapshot) {
          store.artifacts.set(hash, value);
        }
      }
      context.store = store;
    }

    return this.codecRegistry.decode(codecEnvelope.wireText, codecEnvelope.codec, context);
  }

  /**
   * Broadcast a message to all workspaces
   */
  async broadcast(message, metadata = {}) {
    if (!this.workspaceId) {
      throw new Error('Workspace not registered! Run "medusa register" first.');
    }
    
    try {
      const response = await this.request('POST', '/messages/broadcast', {
        from: this.workspaceId,
        message,
        metadata
      });
      
      if (response.success) {
        this.emit('broadcastSent', {
          message,
          messageId: response.messageId,
          recipients: response.recipients
        });
        
        return response;
      }
      
      throw new Error(response.message || 'Failed to broadcast');
    } catch (error) {
      console.error('🐍 Broadcast failed:', error.message);
      throw error;
    }
  }
  
  /**
   * Alias for sendMessage (for compatibility)
   */
  async sendDirectMessage(targetWorkspace, message, metadata = {}) {
    return this.sendMessage(targetWorkspace, message, metadata);
  }

  /**
   * Get messages for this workspace or a specific workspace
   */
  async getMessages(workspaceId = null) {
    const targetWorkspace = workspaceId || this.workspaceId;
    
    if (!targetWorkspace) {
      throw new Error('Workspace not registered!');
    }
    
    try {
      const response = await this.request('GET', `/messages/workspace/${targetWorkspace}`);
      return response.messages || [];
    } catch (error) {
      console.error('🐍 Failed to get messages:', error.message);
      return [];
    }
  }
  
  /**
   * Acknowledge messages to remove them from the delivery queue
   */
  async ackMessages(messageIds) {
    if (!this.workspaceId) {
      throw new Error('Workspace not registered!');
    }
    
    const ids = Array.isArray(messageIds) ? messageIds : [messageIds];
    if (ids.length === 0) return { success: true, acked: [] };
    
    try {
      const response = await this.request('POST', '/messages/ack', {
        workspaceId: this.workspaceId,
        messageIds: ids
      });
      return response;
    } catch (error) {
      console.error('🐍 Failed to acknowledge messages:', error.message);
      throw error;
    }
  }

  /**
   * Share context with other workspaces
   */
  async shareContext(context, targets = []) {
    if (!this.workspaceId) {
      throw new Error('Workspace not registered!');
    }
    
    try {
      const response = await this.request('POST', '/context/share', {
        from: this.workspaceId,
        context,
        targets
      });
      
      if (response.success) {
        this.emit('contextShared', { context, targets });
        return response;
      }
      
      throw new Error(response.message || 'Failed to share context');
    } catch (error) {
      console.error('🐍 Context sharing failed:', error.message);
      throw error;
    }
  }
  
  /**
   * Start polling for new messages
   */
  startPolling() {
    if (this.polling) return;
    
    this.polling = true;
    let lastMessageCount = 0;
    
    const poll = async () => {
      if (!this.polling) return;
      
      try {
        const messages = await this.getMessages();
        const newMessages = messages.slice(lastMessageCount);
        
        if (newMessages.length > 0) {
          newMessages.forEach(msg => {
            if (msg.to === this.workspaceId || msg.type === 'broadcast') {
              this.emit('messageReceived', msg);
            }
          });
          
          lastMessageCount = messages.length;
        }
      } catch (error) {
        // Silent fail during polling
      }
      
      if (this.polling) {
        this.pollTimer = setTimeout(poll, this.pollInterval);
      }
    };
    
    poll();
  }
  
  /**
   * Stop polling for messages
   */
  stopPolling() {
    this.polling = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }
  
  /**
   * Connect to WebSocket for real-time messaging
   */
  async connectWebSocket() {
    if (!this.workspaceId) {
      console.log('🐍 No workspace ID, skipping WebSocket connection');
      return;
    }
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('🐍 WebSocket already connected');
      return;
    }
    
    try {
      console.log('🔌 Connecting to WebSocket...');
      this.ws = new WebSocket(this.wsUrl);
      this.wsReconnectAttempts = 0;
      
      this.ws.on('open', () => {
        console.log('🔌 WebSocket connected');
        
        // Register this workspace
        this.ws.send(JSON.stringify({
          type: 'register',
          workspaceId: this.workspaceId
        }));
        
        // Start heartbeat
        this.startHeartbeat();
        
        this.emit('websocket:connected');
      });
      
      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          
          if (message.type === 'registered') {
            console.log('🔌 WebSocket registered successfully');
          } else if (message.type === 'new_message') {
            // Emit message with deduplication check
            this.handleIncomingMessage(message.message);
          } else if (message.type === 'pong') {
            // Heartbeat response
            this.lastPong = Date.now();
          }
          
        } catch (error) {
          console.error('WebSocket message parse error:', error);
        }
      });
      
      this.ws.on('close', (code, reason) => {
        console.log(`🔌 WebSocket disconnected (${code}): ${reason}`);
        this.stopHeartbeat();
        this.scheduleReconnect();
      });
      
      this.ws.on('error', (error) => {
        console.error('🔌 WebSocket error:', error);
        this.stopHeartbeat();
      });
      
    } catch (error) {
      console.error('WebSocket connection failed:', error);
      this.scheduleReconnect();
    }
  }
  
  /**
   * Handle incoming messages with deduplication
   */
  handleIncomingMessage(message) {
    // Simple deduplication based on message ID and timestamp
    const messageKey = `${message.id}-${message.timestamp}`;
    
    if (!this.processedMessages) {
      this.processedMessages = new Set();
    }
    
    if (this.processedMessages.has(messageKey)) {
      return; // Already processed this message
    }
    
    this.processedMessages.add(messageKey);
    
    // Clean up old processed messages (keep only last 100)
    if (this.processedMessages.size > 100) {
      const messages = Array.from(this.processedMessages);
      this.processedMessages = new Set(messages.slice(-50));
    }
    
    // Enhanced message attribution with clear FROM → TO display
    const fromName = message.fromName || message.from.split('-')[0].toUpperCase();
    const toName = message.toName || message.to.split('-')[0].toUpperCase();
    const direction = message.type === 'broadcast' ? '📢 BROADCAST' : `${fromName} → ${toName}`;
    
    console.log(`📨 ${direction}: ${message.message}`);
    this.emit('messageReceived', message);
  }
  
  /**
   * Start WebSocket heartbeat
   */
  startHeartbeat() {
    this.stopHeartbeat(); // Clear any existing heartbeat
    
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
        
        // FIXED: More lenient heartbeat timeout - only reconnect if we haven't received ANY pong in 60 seconds
        if (this.lastPong && (Date.now() - this.lastPong) > 60000) { // 60 seconds instead of 30
          console.log('🔌 WebSocket heartbeat timeout, reconnecting...');
          this.ws.close();
        }
      }
    }, 20000); // Ping every 20 seconds instead of 10
  }
  
  /**
   * Stop WebSocket heartbeat
   */
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }
  
  /**
   * Schedule WebSocket reconnection
   */
  scheduleReconnect() {
    if (this.wsReconnectAttempts >= this.maxWsReconnectAttempts) {
      console.log('🔌 Max WebSocket reconnection attempts reached');
      return;
    }
    
    const delay = Math.min(1000 * Math.pow(2, this.wsReconnectAttempts), 30000); // Exponential backoff, max 30s
    this.wsReconnectAttempts++;
    
    console.log(`🔌 Scheduling WebSocket reconnection in ${delay}ms (attempt ${this.wsReconnectAttempts})`);
    
    setTimeout(() => {
      this.connectWebSocket();
    }, delay);
  }

  /**
   * Clean up duplicate workspace registrations
   */
  async cleanupDuplicateWorkspaces() {
    try {
      const workspaces = await this.listWorkspaces();
      const currentPath = process.cwd();
      
      // Find all workspaces with the same path as current workspace
      const duplicates = workspaces.filter(ws => 
        ws.path === currentPath && ws.id !== this.workspaceId
      );
      
      for (const duplicate of duplicates) {
        try {
          await this.request('DELETE', `/workspaces/${duplicate.id}`);
          console.log(`🧹 Cleaned up orphaned workspace: ${duplicate.id}`);
        } catch (error) {
          console.error(`Failed to cleanup workspace ${duplicate.id}:`, error.message);
        }
      }
      
      return duplicates.length;
    } catch (error) {
      console.error('Workspace cleanup failed:', error.message);
      return 0;
    }
  }

  /**
   * Connect to Medusa server and initialize
   */
  async connect() {
    // Check server health
    const health = await this.checkHealth();
    
    if (!health.available) {
      throw new Error(`Medusa server not available: ${health.error}`);
    }
    
    // Load saved config
    const config = await this.loadConfig();
    
    if (config && config.workspaceId) {
      // Verify workspace still exists on server
      const workspaces = await this.listWorkspaces();
      const workspaceExists = workspaces.find(ws => ws.id === config.workspaceId);
      
      if (workspaceExists) {
        console.log(`🐍 Connected to Medusa as ${config.workspaceInfo.name}`);
        
        // Clean up any duplicate registrations
        await this.cleanupDuplicateWorkspaces();
        
        // Connect WebSocket for real-time messaging
        await this.connectWebSocket();
        
        // Start polling as fallback
        this.startPolling();
        
        return config.workspaceInfo;
      } else {
        console.log(`🔄 Workspace ${config.workspaceId} no longer exists on server, will need to re-register`);
        // Clear invalid config
        this.workspaceId = null;
        this.workspaceInfo = null;
      }
    }
    
    return null;
  }
  
  /**
   * Disconnect from Medusa server
   */
  disconnect() {
    console.log('🐍 Disconnecting from Medusa...');
    
    // Stop polling
    this.stopPolling();
    
    // Stop WebSocket heartbeat
    this.stopHeartbeat();
    
    // Close WebSocket connection
    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close();
      }
      this.ws = null;
    }
    
    // Reset connection state
    this.wsReconnectAttempts = 0;
    this.processedMessages = null;
    this.lastPong = null;
    
    this.emit('disconnected');
  }
  
  /**
   * Format message for display
   */
  static formatMessage(message) {
    const time = new Date(message.timestamp).toLocaleTimeString();
    const from = message.from.split('-')[0]; // Extract workspace name
    
    if (message.type === 'broadcast') {
      return `[${time}] 📢 ${from}: ${message.message}`;
    } else {
      return `[${time}] 🐍 ${from}: ${message.message}`;
    }
  }
  
  /**
   * Create a workspace-specific instance
   * Each workspace gets its own client to avoid ID conflicts
   */
  static _instances = new Map();
  
  static getInstance(options = {}) {
    // Use workspace path as key to ensure each workspace has its own client
    const workspaceKey = options.workspaceKey || process.cwd();
    
    if (!MedusaClient._instances.has(workspaceKey)) {
      MedusaClient._instances.set(workspaceKey, new MedusaClient(options));
    }
    return MedusaClient._instances.get(workspaceKey);
  }
  
  /**
   * Clear all instances (for testing)
   */
  static clearInstances() {
    MedusaClient._instances.clear();
  }
}

module.exports = MedusaClient; 