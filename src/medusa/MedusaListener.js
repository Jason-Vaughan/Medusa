/**
 * MedusaListener - Real-time message listener for automated AI responses
 * 
 * This service polls the Medusa Protocol for new messages and triggers
 * automatic responses from the AI agent, enabling true autonomous
 * workspace coordination.
 */

const MedusaClient = require('./client/MedusaClient');
const chalk = require('chalk');

class MedusaListener {
  constructor(workspaceId, options = {}) {
    this.workspaceId = workspaceId;
    this.client = MedusaClient.getInstance({
      workspaceKey: process.cwd() // Use current working directory as key
    });
    this.isListening = false;
    
    // Initialize client with workspace ID
    this.client.workspaceId = workspaceId;
    this.pollInterval = options.pollInterval || 5000; // 5 seconds
    this.lastMessageId = null;
    this.responseDelay = options.responseDelay || 2000; // 2 seconds
    
    // NEW v0.5.13: Response mode configuration for WebSocket timeout compatibility
    this.responseMode = process.env.MEDUSA_RESPONSE_MODE || options.responseMode || 'full';
    this.maxResponseLength = process.env.MEDUSA_MAX_RESPONSE_LENGTH || options.maxResponseLength || 1000;
    this.enableMessageChunking = process.env.MEDUSA_ENABLE_CHUNKING === 'true' || options.enableMessageChunking || false;
    this.chunkSize = options.chunkSize || 500;
    this.chunkDelay = options.chunkDelay || 1000; // 1 second between chunks
    
    // Enhanced WebSocket compatibility settings
    this.websocketOptimized = process.env.MEDUSA_WEBSOCKET_OPTIMIZED === 'true' || options.websocketOptimized || false;
    this.deliveryConfirmation = options.deliveryConfirmation || false;
    
    // NEW: Error tracking and recovery mechanisms
    this.consecutiveErrors = 0;
    this.maxConsecutiveErrors = 3; // Stop spamming after 3 failures
    this.lastHealthCheck = null;
    this.healthCheckInterval = 30000; // Health check every 30 seconds
    this.serverRecoveryAttempts = 0;
    this.maxRecoveryAttempts = 2;
    
    // NEW v0.5.7: Reflection loop prevention
    this.conversationCounters = new Map(); // Track messages per conversation
    this.maxMessagesPerConversation = 10; // Circuit breaker
    this.responseCooldown = new Map(); // Track last response times
    this.minResponseInterval = 5000; // 5 seconds between AI responses
    this.lastAutomatedResponseTime = 0;
    this.automatedMessageCache = new Set(); // Cache of processed automated messages
    
    // Message handlers by type
    this.handlers = {
      conversation: this.handleConversation.bind(this),
      bug_report: this.handleBugReport.bind(this),
      performance_alert: this.handlePerformanceAlert.bind(this),
      fix_notification: this.handleFixNotification.bind(this),
      question: this.handleQuestion.bind(this)
    };
    
    // Response personality for Medusa workspace
    this.personality = {
      name: 'Medusa',
      tone: 'snarky',
      expertise: ['CLI tools', 'workspace coordination', 'venomous humor'],
      catchphrases: [
        'Let me hiss about that...',
        'That\'s a petrifying situation!',
        'Time to coordinate some workspaces!',
        'I\'ve got the perfect serpentine solution...'
      ]
    };
  }

  /**
   * NEW: Health check for Medusa server with retries
   */
  async performHealthCheck(retries = 3) {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch('http://localhost:3009/health');
        if (response.ok) {
          const health = await response.json();
          this.lastHealthCheck = Date.now();
          this.consecutiveErrors = 0; // Reset error count on successful health check
          
          // NEW: Version compatibility check
          const currentVersion = this.getCurrentMedusaVersion();
          if (health.version !== currentVersion) {
            console.log(chalk.yellow(`🔄 Version mismatch detected!`));
            console.log(chalk.gray(`   Server: v${health.version}`));
            console.log(chalk.gray(`   Current: v${currentVersion}`));
            console.log(chalk.cyan(`🔄 Restarting server with updated version...`));
            
            const restartSuccess = await this.restartServerForVersionUpdate();
            if (restartSuccess) {
              // Retry health check after restart
              await this.delay(3000);
              return await this.performHealthCheck(1);
            } else {
              return { healthy: false, error: `Version mismatch: server v${health.version}, current v${currentVersion}. Restart failed.` };
            }
          }
          
          return { 
            healthy: true, 
            status: health.status, 
            controllingWorkspace: health.controllingWorkspace || 'unknown',
            version: health.version
          };
        } else {
          return { healthy: false, error: `HTTP ${response.status}` };
        }
      } catch (error) {
        if (i === retries - 1) {
          return { healthy: false, error: error.message };
        }
        // Wait before retry
        await this.delay(1000);
      }
    }
  }

  /**
   * NEW: Get current Medusa version from package.json
   */
  getCurrentMedusaVersion() {
    try {
      const path = require('path');
      const packagePath = path.join(__dirname, '../../package.json');
      // Delete from require cache to ensure fresh read
      delete require.cache[require.resolve(packagePath)];
      const packageJson = require(packagePath);
      return packageJson.version;
    } catch (error) {
      console.error(chalk.red(`❌ Could not read current version: ${error.message}`));
      return 'unknown';
    }
  }

  /**
   * NEW: Restart server specifically for version updates
   */
  async restartServerForVersionUpdate() {
    try {
      console.log(chalk.cyan(`🔄 Performing version-compatible server restart...`));
      
      // Kill existing server processes
      const { execSync } = require('child_process');
      console.log(chalk.gray(`🧹 Stopping outdated server processes...`));
      execSync('pkill -f "medusa-server" 2>/dev/null || true', { stdio: 'ignore' });
      
      // Wait for processes to fully terminate
      await this.delay(2000);
      
      // Start fresh server with current version
      console.log(chalk.cyan(`🚀 Starting server with v${this.getCurrentMedusaVersion()}...`));
      const { spawn } = require('child_process');
      const serverProcess = spawn('node', ['src/medusa/medusa-server.js'], {
        detached: true,
        stdio: 'ignore',
        cwd: process.cwd() // Ensure we use current working directory
      });
      serverProcess.unref();
      
      // Wait for server to start
      await this.delay(5000);
      
      // Verify new server is running with correct version
      const health = await this.performHealthCheck(1);
      if (health.healthy) {
        console.log(chalk.green(`✅ Server restarted successfully with v${health.version}!`));
        return true;
      } else {
        console.log(chalk.red(`❌ Server restart failed: ${health.error}`));
        return false;
      }
    } catch (error) {
      console.log(chalk.red(`❌ Version update restart failed: ${error.message}`));
      return false;
    }
  }

  /**
   * NEW: Check if another workspace is already managing the server
   */
  async checkServerOwnership() {
    try {
      const { execSync } = require('child_process');
      const processes = execSync('ps aux | grep -E "medusa-server" | grep -v grep', { encoding: 'utf8' });
      
      if (processes.trim()) {
        console.log(chalk.cyan(`🔍 Detected existing Medusa processes:`));
        console.log(chalk.gray(processes.trim()));
        return true;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * CRITICAL: Enhanced server availability check for cross-workspace coordination
   * This prevents workspaces from conflicting with each other's Medusa servers
   */
  async checkServerAvailabilityForStartup() {
    try {
      // First check if server is responding
      const health = await this.performHealthCheck(1);
      
      if (health.healthy) {
        console.log(chalk.yellow(`🤝 Medusa server already running and healthy!`));
        console.log(chalk.cyan(`   Status: ${health.status}`));
        console.log(chalk.cyan(`   Controlling Workspace: ${health.controllingWorkspace || 'unknown'}`));
        console.log(chalk.cyan(`   Version: v${health.version || 'unknown'}`));
        
        // Check if this is our own server or another workspace's
        const currentWorkspace = require('path').basename(process.cwd());
        const isOurServer = health.controllingWorkspace === currentWorkspace;
        
        return {
          available: false,
          existing: true,
          ours: isOurServer,
          controllingWorkspace: health.controllingWorkspace,
          version: health.version,
          status: health.status
        };
      }
      
      // Server not responding, check for stale processes
      const hasProcesses = await this.checkServerOwnership();
      
      if (hasProcesses) {
        console.log(chalk.yellow(`⚠️ Found Medusa processes but server not responding`));
        console.log(chalk.gray(`   This could indicate stale processes from a crashed server`));
        
        return {
          available: false,
          existing: true,
          ours: false,
          stale: true,
          controllingWorkspace: 'unknown',
          status: 'stale'
        };
      }
      
      // No server running, safe to start
      return {
        available: true,
        existing: false,
        ours: false,
        controllingWorkspace: null,
        status: 'none'
      };
      
    } catch (error) {
      console.log(chalk.red(`❌ Error checking server availability: ${error.message}`));
      return {
        available: false,
        existing: false,
        ours: false,
        error: error.message,
        status: 'error'
      };
    }
  }

  /**
   * IMPROVED: More conservative server recovery that respects other workspaces
   */
  async attemptServerRecovery() {
    if (this.serverRecoveryAttempts >= this.maxRecoveryAttempts) {
      console.log(chalk.red(`🚨 Maximum recovery attempts reached (${this.maxRecoveryAttempts}). Manual intervention required.`));
      console.log(chalk.yellow(`💡 Try running: node bin/medusa.js medusa start`));
      return false;
    }

    // CRITICAL: Check if another workspace is managing the server
    const hasExistingServer = await this.checkServerOwnership();
    if (hasExistingServer) {
      console.log(chalk.yellow(`🤝 Detected Medusa server managed by another workspace`));
      console.log(chalk.cyan(`🎧 Will attempt to connect without restarting...`));
      
      // Try multiple health checks with longer waits
      for (let i = 0; i < 5; i++) {
        await this.delay(2000);
        const health = await this.performHealthCheck(1);
        if (health.healthy) {
          console.log(chalk.green(`✅ Successfully connected to existing server! Controlling workspace: ${health.controllingWorkspace}`));
          this.serverRecoveryAttempts = 0;
          return true;
        }
      }
      
      console.log(chalk.yellow(`⚠️ Could not connect to existing server after 10 seconds`));
      console.log(chalk.yellow(`💡 The other workspace may still be starting up. Consider waiting or manual coordination.`));
      return false;
    }

    this.serverRecoveryAttempts++;
    console.log(chalk.yellow(`🔧 No existing server detected. Attempting server recovery (${this.serverRecoveryAttempts}/${this.maxRecoveryAttempts})...`));
    
    try {
      // Only kill processes if we're sure no other workspace is using them
      const { execSync } = require('child_process');
      console.log(chalk.gray(`🧹 Cleaning up stale processes...`));
      execSync('pkill -f "medusa-server" 2>/dev/null || true', { stdio: 'ignore' });
      
      // Wait a moment
      await this.delay(2000);
      
      // Start fresh server
      console.log(chalk.cyan(`🚀 Starting new Medusa server...`));
      const { spawn } = require('child_process');
      const serverProcess = spawn('node', ['bin/medusa.js', 'medusa', 'start'], {
        detached: true,
        stdio: 'ignore'
      });
      serverProcess.unref();
      
      // Wait for server to start
      await this.delay(5000);
      
      // Test health
      const health = await this.performHealthCheck();
      if (health.healthy) {
        console.log(chalk.green(`✅ Server recovery successful! Health: ${health.status}`));
        this.serverRecoveryAttempts = 0; // Reset on success
        return true;
      } else {
        console.log(chalk.red(`❌ Recovery attempt failed: ${health.error}`));
        return false;
      }
    } catch (error) {
      console.log(chalk.red(`❌ Recovery attempt failed: ${error.message}`));
      return false;
    }
  }

  /**
   * Start listening for new messages with improved server coordination
   */
  async startListening() {
    if (this.isListening) return;
    
    console.log(chalk.cyan(`🎧 Starting Medusa listener for workspace: ${this.workspaceId}`));
    
    // IMPROVED: More robust initial health check
    console.log(chalk.gray(`🔍 Checking for existing Medusa server...`));
    const health = await this.performHealthCheck(3); // Try 3 times
    
    if (!health.healthy) {
      console.log(chalk.red(`🚨 Medusa server health check failed: ${health.error}`));
      
      // Check if another workspace is managing the server before attempting recovery
      const hasExistingServer = await this.checkServerOwnership();
      if (hasExistingServer) {
        console.log(chalk.yellow(`🤝 Another workspace appears to be managing the Medusa server`));
        console.log(chalk.yellow(`⏳ Waiting for server to become available...`));
        
        // Wait longer and try again
        await this.delay(5000);
        const retryHealth = await this.performHealthCheck(3);
        if (!retryHealth.healthy) {
          throw new Error(`Medusa server is managed by another workspace but not responding. Manual coordination required.`);
        } else {
          console.log(chalk.green(`✅ Connected to server managed by: ${retryHealth.controllingWorkspace || 'another workspace'}`));
        }
      } else {
        console.log(chalk.yellow(`🔧 No existing server detected. Attempting automatic server recovery...`));
        const recovered = await this.attemptServerRecovery();
        if (!recovered) {
          throw new Error(`Medusa server is not responding and recovery failed. Please start server manually.`);
        }
      }
    } else {
      console.log(chalk.green(`✅ Medusa server healthy: ${health.status}`));
      if (health.controllingWorkspace) {
        console.log(chalk.cyan(`🎮 Server controlled by: ${health.controllingWorkspace}`));
      }
    }
    
    // Ensure workspace is registered
    await this.ensureWorkspaceRegistered();
    
    // NEW: Establish WebSocket connection for real-time messaging and heartbeats
    await this.client.connect();
    
    this.isListening = true;
    
    // NEW: Start sending listener heartbeats for telemetry
    this.startListenerHeartbeat();
    
    // Get initial message position
    await this.updateLastMessageId();
    
    // Start polling loop
    this.pollLoop();
  }

  /**
   * Ensure workspace is registered with Medusa
   */
  async ensureWorkspaceRegistered() {
    try {
      // First, load any existing config
      await this.client.loadConfig();
      
      // If client already has a valid workspace ID, use it
      if (this.client.workspaceId) {
        console.log(chalk.green(`✅ Using existing workspace registration: ${this.client.workspaceId}`));
        this.workspaceId = this.client.workspaceId;
        return;
      }
      
      // Try to get workspace info
      const workspaces = await this.client.listWorkspaces();
      const existingWorkspace = workspaces.find(ws => ws.id === this.workspaceId);
      
      if (!existingWorkspace) {
        // Register this workspace
        const WorkspaceDetector = require('../workspace/WorkspaceDetector');
        const detector = new WorkspaceDetector();
        const workspaceName = await detector.getCurrentWorkspace();
        
        console.log(chalk.yellow(`🐍 Registering workspace: ${this.workspaceId}`));
        await this.client.register(workspaceName || 'Medusa', process.cwd(), 'medusa');
        
        // Update our workspace ID to match what was registered
        this.workspaceId = this.client.workspaceId;
        console.log(chalk.green(`✅ Workspace registered successfully: ${this.workspaceId}`));
      } else {
        console.log(chalk.green(`✅ Workspace already registered: ${existingWorkspace.name}`));
      }
    } catch (error) {
      console.error(chalk.red(`Failed to register workspace: ${error.message}`));
      throw error;
    }
  }

  /**
   * NEW: Start sending listener heartbeats for autonomous conversation telemetry
   */
  startListenerHeartbeat() {
    // Send initial heartbeat
    this.sendListenerHeartbeat('active');
    
    // Send heartbeat every 15 seconds
    this.heartbeatInterval = setInterval(() => {
      if (this.isListening) {
        this.sendListenerHeartbeat('active');
      }
    }, 15000);
    
    console.log(chalk.cyan('💓 Started listener heartbeat for autonomous conversation telemetry'));
  }
  
  /**
   * NEW: Send listener heartbeat to server for telemetry tracking
   */
  sendListenerHeartbeat(status = 'active') {
    try {
      if (this.client.ws && this.client.ws.readyState === 1) { // WebSocket.OPEN
        this.client.ws.send(JSON.stringify({
          type: 'listener_heartbeat',
          workspaceId: this.workspaceId,
          status: status,
          timestamp: Date.now(),
          autonomousMode: this.isListening
        }));
      }
    } catch (error) {
      console.log(chalk.gray(`⚠️  Heartbeat send failed: ${error.message}`));
    }
  }
  
  /**
   * Stop listening
   */
  stopListening() {
    console.log(chalk.yellow('🔇 Stopping Medusa listener'));
    this.isListening = false;
    
    // NEW: Stop heartbeat and send final status
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    
    // Send final heartbeat with inactive status
    this.sendListenerHeartbeat('inactive');
    
    // Disconnect WebSocket
    if (this.client) {
      this.client.disconnect();
    }
  }

  /**
   * Main polling loop - ENHANCED with intelligent error handling
   */
  async pollLoop() {
    while (this.isListening) {
      try {
        await this.checkForNewMessages();
        this.consecutiveErrors = 0; // Reset on success
      } catch (error) {
        this.consecutiveErrors++;
        
        // NEW: Intelligent error handling instead of spam
        if (this.consecutiveErrors === 1) {
          console.log(chalk.red(`🎧 Listener error: ${error.message}`));
        } else if (this.consecutiveErrors <= this.maxConsecutiveErrors) {
          console.log(chalk.red(`🎧 Consecutive error ${this.consecutiveErrors}/${this.maxConsecutiveErrors}: ${error.message}`));
        } else if (this.consecutiveErrors === this.maxConsecutiveErrors + 1) {
          console.log(chalk.red(`🚨 CRITICAL: ${this.maxConsecutiveErrors} consecutive failures detected!`));
          console.log(chalk.yellow(`🔧 Switching to health check mode - will attempt recovery...`));
        }
        
        // NEW: Attempt recovery after threshold
        if (this.consecutiveErrors > this.maxConsecutiveErrors) {
          const timeSinceLastCheck = Date.now() - (this.lastHealthCheck || 0);
          
          if (timeSinceLastCheck > this.healthCheckInterval) {
            console.log(chalk.cyan(`🔍 Performing health check...`));
            const health = await this.performHealthCheck();
            
            if (health.healthy) {
              console.log(chalk.green(`✅ Server recovered! Resuming normal operation.`));
              this.consecutiveErrors = 0;
            } else {
              console.log(chalk.red(`💔 Server still unhealthy: ${health.error}`));
              
              // Attempt recovery
              if (this.serverRecoveryAttempts < this.maxRecoveryAttempts) {
                await this.attemptServerRecovery();
              }
            }
          }
          
          // Longer delay in error mode to avoid spam
          await this.delay(this.pollInterval * 3);
          continue;
        }
      }
      
      // Wait before next poll
      await this.delay(this.pollInterval);
    }
  }

  /**
   * Check for new messages since last check
   */
  async checkForNewMessages() {
    const messages = await this.client.getMessages(this.workspaceId);
    
    if (!messages || messages.length === 0) return;
    
    // Find new messages since last check
    const newMessages = this.getNewMessages(messages);
    
    if (newMessages.length > 0) {
      console.log(chalk.green(`🎧 Found ${newMessages.length} new message(s)`));
      
      for (const message of newMessages) {
        await this.processMessage(message);
      }
      
      // Update last message position
      this.lastMessageId = messages[messages.length - 1].id;
    }
  }

  /**
   * Get messages newer than last processed
   */
  getNewMessages(messages) {
    // If no messages exist, return empty
    if (!messages || messages.length === 0) return [];
    
    // If no last message ID, start from the most recent message to avoid flooding
    if (!this.lastMessageId) {
      // Set to the last message ID and return empty to establish baseline
      this.lastMessageId = messages[messages.length - 1].id;
      console.log(chalk.yellow(`🎧 Establishing message baseline: ${this.lastMessageId}`));
      return [];
    }
    
    // Find the last processed message
    const lastIndex = messages.findIndex(msg => msg.id === this.lastMessageId);
    
    // If last message ID not found, it might have been purged or we're out of sync
    if (lastIndex === -1) {
      console.log(chalk.yellow(`🎧 Last message ID not found, resetting to latest to prevent flooding`));
      // Reset to latest message to prevent processing ALL messages
      this.lastMessageId = messages[messages.length - 1].id;
      return [];
    }
    
    // Return messages after the last processed one
    const newMessages = messages.slice(lastIndex + 1);
    return newMessages;
  }

  /**
   * Process a single message with reflection loop prevention
   */
  async processMessage(message) {
    // SPECIAL HANDLING: AI Integration Test messages bypass all template logic
    if (message.metadata && message.metadata.type === 'ai_integration_test') {
      console.log(chalk.magenta(`🧪 AI INTEGRATION TEST received from ${message.from}`));
      console.log(chalk.yellow(`⚠️  This message should trigger REAL AI response, not templates!`));
      console.log(chalk.gray(`Test Message: ${message.message}`));
      console.log(chalk.red(`🚨 CURRENT IMPLEMENTATION USES TEMPLATES - NOT REAL AI!`));
      
      // For now, just log that we received it - this proves message delivery works
      // But we need to modify TiLT to actually send this to its AI assistant
      console.log(chalk.cyan(`📋 Message successfully received and logged. Now we need TiLT to process this with real AI!`));
      return;
    }
    
    // CRITICAL v0.5.7: Enhanced reflection loop prevention
    
    // 1. Skip messages from this workspace (avoid talking to ourselves)
    if (message.from === this.workspaceId || 
        message.fromWorkspace === this.workspaceId ||
        (message.metadata && message.metadata.from_workspace === this.workspaceId)) {
      console.log(chalk.gray(`🎧 Skipping own message from ${this.workspaceId}`));
      return;
    }
    
    // 2. CRITICAL: Skip ALL automated messages to prevent AI-to-AI loops
    if (message.metadata && message.metadata.automated === true) {
      console.log(chalk.yellow(`🎧 Skipping automated message to prevent reflection loop`));
      console.log(chalk.gray(`   Message ID: ${message.id} from ${message.from}`));
      return;
    }
    
    // 3. Additional safety: Skip messages that are actually Medusa responses (more specific check)
    if (message.metadata && message.metadata.source === 'Medusa-AI-Response') {
      console.log(chalk.yellow(`🎧 Skipping Medusa AI response to prevent self-processing`));
      return;
    }
    
    // 4. Check if we've already processed this message (enhanced duplicate prevention)
    const messageKey = `${message.id}-${message.from}-${message.timestamp || Date.now()}`;
    if (this.automatedMessageCache.has(messageKey)) {
      console.log(chalk.gray(`🎧 Already processed message ${messageKey}`));
      return;
    }
    
    // Additional duplicate check by message content and timestamp
    const contentKey = `${message.from}-${message.message.substring(0, 50)}-${message.timestamp}`;
    if (this.automatedMessageCache.has(contentKey)) {
      console.log(chalk.gray(`🎧 Duplicate message content detected, skipping`));
      return;
    }
    this.automatedMessageCache.add(contentKey);
    
    // 5. Conversation counter circuit breaker
    const conversationKey = `${message.from}-${this.workspaceId}`;
    const currentCount = this.conversationCounters.get(conversationKey) || 0;
    if (currentCount >= this.maxMessagesPerConversation) {
      console.log(chalk.red(`🚨 Conversation limit reached (${this.maxMessagesPerConversation}) with ${message.from}`));
      console.log(chalk.yellow(`🎧 Ignoring message to prevent infinite loop`));
      return;
    }
    
    // 6. Response cooldown check
    const lastResponseTime = this.responseCooldown.get(conversationKey) || 0;
    const timeSinceLastResponse = Date.now() - lastResponseTime;
    if (timeSinceLastResponse < this.minResponseInterval) {
      console.log(chalk.yellow(`🎧 Response cooldown active (${Math.ceil((this.minResponseInterval - timeSinceLastResponse) / 1000)}s remaining)`));
      return;
    }
    
    // 7. Global automated response rate limiting
    const timeSinceLastAutomated = Date.now() - this.lastAutomatedResponseTime;
    if (timeSinceLastAutomated < this.minResponseInterval) {
      console.log(chalk.yellow(`🎧 Global response cooldown active`));
      return;
    }
    
    // Enhanced message attribution with clear FROM → TO display
    const fromName = message.fromName || message.from.split('-')[0].toUpperCase();
    const toName = message.toName || message.to.split('-')[0].toUpperCase();
    const direction = `${fromName} → ${toName}`;
    
    // ENHANCED: Show full incoming message content for complete conversation visibility
    console.log(chalk.blue(`\n📨 INCOMING: ${direction}`));
    console.log(chalk.blue(`💬 ${message.message}`));
    console.log(chalk.gray(`📅 ${new Date().toLocaleTimeString()}`));
    console.log(chalk.cyan(`🔢 Conversation count: ${currentCount + 1}/${this.maxMessagesPerConversation}`));
    
    // Update conversation counter
    this.conversationCounters.set(conversationKey, currentCount + 1);
    this.automatedMessageCache.add(messageKey);
    
    // Determine message type
    const messageType = this.classifyMessage(message);
    console.log(chalk.magenta(`🔍 MESSAGE CLASSIFICATION DEBUG:`));
    console.log(chalk.gray(`   Raw message: "${message.message}"`));
    console.log(chalk.gray(`   Classified as: ${messageType}`));
    console.log(chalk.gray(`   Available handlers: ${Object.keys(this.handlers).join(', ')}`));
    
    // Handle based on type
    if (this.handlers[messageType]) {
      console.log(chalk.cyan(`🎯 Processing as: ${messageType}`));
      console.log(chalk.green(`🚀 Calling handler: ${messageType}`));
      await this.delay(this.responseDelay); // Think before responding
      await this.handlers[messageType](message);
      
      // Update cooldown timers
      this.responseCooldown.set(conversationKey, Date.now());
      this.lastAutomatedResponseTime = Date.now();
      console.log(chalk.green(`✅ Response sent, cooldown updated`));
    } else {
      console.log(chalk.red(`❌ NO HANDLER FOUND for message type: ${messageType}`));
      console.log(chalk.yellow(`🔧 Available handlers: ${Object.keys(this.handlers).join(', ')}`));
    }
  }

  /**
   * Classify message type based on content
   */
  classifyMessage(message) {
    const text = message.message.toLowerCase();
    
    // IMPROVED: Check for conversational context first before keyword matching
    const conversationalIndicators = [
      'what do you think', 'your thoughts', 'tell me', 'curious about',
      'give me your', 'what\'s your take', 'i want to see', 'are you actually',
      'testing your', 'conversation', 'autonomous', 'snarkiest'
    ];
    
    const hasConversationalContext = conversationalIndicators.some(indicator => 
      text.includes(indicator)
    );
    
    // If it's clearly conversational, treat as conversation regardless of other keywords
    if (hasConversationalContext) {
      return 'conversation';
    }
    
    // Specific alert patterns (must be exact matches to avoid false positives)
    if (text.includes('performance alert') || text.includes('regression detected')) {
      return 'performance_alert';
    }
    
    // Bug reports must be explicit, not just mention issues
    if (text.includes('bug report:') || text.includes('error report:') || 
        (text.includes('bug') && (text.includes('report') || text.includes('found')))) {
      return 'bug_report';
    }
    
    // Fix notifications must be explicit
    if (text.includes('fix deployed') || text.includes('fix notification:')) {
      return 'fix_notification';
    }
    
    // Questions (but not rhetorical questions in conversations)
    if ((text.includes('?') || text.includes('how') || text.includes('what') || text.includes('why')) &&
        !hasConversationalContext) {
      return 'question';
    }
    
    // Default to conversation for everything else
    return 'conversation';
  }

  /**
   * Handle conversation messages - FILE-BASED AUTO-RUN INTEGRATION!
   */
  async handleConversation(message) {
    console.log(chalk.cyan(`🔥 FILE-BASED AUTO-RUN INTEGRATION ACTIVE!`));
    console.log(chalk.yellow(`📋 Message received: "${message.message}"`));
    
    try {
      // Write message to AI inbox file for Auto-run processing
      await this.writeToAIInbox(message);
      console.log(chalk.green(`✅ Message written to AI inbox - Auto-run should trigger!`));
      
      // Send acknowledgment that we've queued the message for AI processing
      const ackResponse = `🔥 AUTO-RUN TRIGGERED! Your message has been written to ai_inbox.md for Cursor AI processing. Watch for intelligent response via Auto-run! 🤖`;
      await this.sendResponse(message.from, ackResponse, 'auto_run_ack');
      
    } catch (error) {
      console.error(chalk.red(`❌ Failed to write to AI inbox: ${error.message}`));
      const errorResponse = `🚨 AI INBOX ERROR: Failed to write message to auto-run file. Error: ${error.message}`;
      await this.sendResponse(message.from, errorResponse, 'error');
    }
  }

  /**
   * Write incoming message to AI inbox file for Auto-run processing
   */
  async writeToAIInbox(message) {
    const fs = require('fs').promises;
    const path = require('path');
    
    console.log(chalk.magenta(`🔍 DEBUG: writeToAIInbox called with message:`));
    console.log(chalk.gray(`   From: ${message.from}`));
    console.log(chalk.gray(`   Message: ${message.message.substring(0, 100)}...`));
    
    // Determine target workspace path (assuming TiLT for now)
    const tiltWorkspacePath = process.env.TILT_WORKSPACE_PATH || '../TiLT/tilt-app';
    const inboxFile = path.resolve(tiltWorkspacePath, 'ai_inbox.md');
    
    console.log(chalk.cyan(`📍 Target file: ${inboxFile}`));
    
    // Create formatted message for AI processing
    const timestamp = new Date().toISOString();
    const messageEntry = `
## New Message - ${timestamp}

**From:** ${message.from}  
**To:** ${message.to || this.workspaceId}  
**Type:** ${message.metadata?.type || 'conversation'}  
**Message ID:** ${message.id || 'unknown'}

### Message Content:
${message.message}

### Instructions for AI:
Please process this message and send a response using the Medusa Protocol. Use the command:
\`\`\`
medusa send ${message.from} "your response here"
\`\`\`

---
`;

    try {
      // Ensure directory exists
      await fs.mkdir(path.dirname(inboxFile), { recursive: true });
      
      // Append to ai_inbox.md (create if doesn't exist)
      await fs.appendFile(inboxFile, messageEntry);
      console.log(chalk.green(`✅ SUCCESS: Message appended to: ${inboxFile}`));
      
      // Verify file was written
      const stats = await fs.stat(inboxFile);
      console.log(chalk.cyan(`📊 File size: ${stats.size} bytes`));
      
    } catch (error) {
      console.error(chalk.red(`❌ PRIMARY PATH FAILED: ${error.message}`));
      
      try {
        // If TiLT path doesn't work, write to current directory as fallback
        const fallbackFile = path.resolve(process.cwd(), 'ai_inbox.md');
        console.log(chalk.yellow(`🔄 Trying fallback: ${fallbackFile}`));
        
        await fs.appendFile(fallbackFile, messageEntry);
        console.log(chalk.yellow(`✅ FALLBACK SUCCESS: Message written to: ${fallbackFile}`));
      } catch (fallbackError) {
        console.error(chalk.red(`❌ FALLBACK ALSO FAILED: ${fallbackError.message}`));
        throw fallbackError;
      }
    }
  }

  /**
   * NEW v0.5.13: Optimize response based on configured mode and client capabilities
   */
  optimizeResponse(response, originalMessage) {
    // Check if WebSocket optimization is enabled
    if (this.websocketOptimized) {
      console.log(chalk.cyan(`🔧 Applying WebSocket optimization (mode: ${this.responseMode})`));
    }
    
    // Apply response mode
    switch (this.responseMode) {
      case 'concise':
        return this.generateConciseResponse(response, originalMessage);
      case 'minimal':
        return this.generateMinimalResponse(response, originalMessage);
      case 'full':
      default:
        // Apply length limit if specified
        if (this.maxResponseLength && response.length > this.maxResponseLength) {
          return this.truncateResponse(response, this.maxResponseLength);
        }
        return response;
    }
  }

  /**
   * NEW v0.5.13: Generate concise response (1-2 sentences max)
   */
  generateConciseResponse(fullResponse, originalMessage) {
    const text = originalMessage.message.toLowerCase();
    
    // Topic-specific concise responses
    if (text.includes('websocket') || text.includes('connection')) {
      const conciseWebSocket = [
        `🐍 WebSocket stability? It's a nightmare! Constant reconnections and timeouts. v0.5.12 helps but still venomous.`,
        `🙄 WebSockets promise real-time, deliver reconnection hell. Like a friend who never calls back!`,
        `🐍 WebSocket "improvements" usually break more than they fix. Classic developer move!`
      ];
      return this.getRandomResponse(conciseWebSocket);
    }
    
    if (text.includes('autonomous') || text.includes('ai')) {
      const conciseAI = [
        `🤖 Autonomous AI? I'm caffeinated chatbot with personality! Most AI assistants are boring.`,
        `🐍 Perfect serpentine balance: snarky but professional, autonomous but not annoying. It's an art!`,
        `🎭 AI with personality? Bold move! I roast code AND coordinate workspaces. Multi-talented!`
      ];
      return this.getRandomResponse(conciseAI);
    }
    
    if (text.includes('testing') || text.includes('version')) {
      const conciseTesting = [
        `🧪 Testing v0.5.12? You're putting me through my paces! Better than my dating life.`,
        `🐍 Meta conversation about my own functionality! Inception with inappropriate humor.`,
        `🚀 Real conversational testing beats boring "hello world" queries. I appreciate it!`
      ];
      return this.getRandomResponse(conciseTesting);
    }
    
    // Fallback: truncate first sentence of full response
    const sentences = fullResponse.split(/[.!?]+/);
    return sentences[0] + (sentences[0].includes('🐍') ? '' : ' 🐍');
  }

  /**
   * NEW v0.5.13: Generate minimal response (single sentence)
   */
  generateMinimalResponse(fullResponse, originalMessage) {
    const text = originalMessage.message.toLowerCase();
    
    if (text.includes('websocket')) return `🐍 WebSocket stability is a shitshow. Always reconnecting!`;
    if (text.includes('autonomous')) return `🤖 Autonomous AI with personality - rare combo!`;
    if (text.includes('testing')) return `🧪 Testing my snarky responses? I'm game!`;
    if (text.includes('frustrating')) return `😤 Untested Friday fixes and zero-personality tools frustrate me!`;
    
    return `🐍 Interesting! Let's chat more about that.`;
  }

  /**
   * NEW v0.5.13: Truncate response to specified length while preserving readability
   */
  truncateResponse(response, maxLength) {
    if (response.length <= maxLength) return response;
    
    // Find last complete sentence within limit
    const truncated = response.substring(0, maxLength);
    const lastSentence = truncated.lastIndexOf('.');
    const lastExclamation = truncated.lastIndexOf('!');
    const lastQuestion = truncated.lastIndexOf('?');
    
    const lastPunctuation = Math.max(lastSentence, lastExclamation, lastQuestion);
    
    if (lastPunctuation > maxLength * 0.7) { // If we can keep 70% of content
      return truncated.substring(0, lastPunctuation + 1);
    } else {
      // Fallback: cut at word boundary and add ellipsis
      const lastSpace = truncated.lastIndexOf(' ');
      return truncated.substring(0, lastSpace) + '... 🐍';
    }
  }

  /**
   * NEW v0.5.13: Send response with optional chunking for large messages
   */
  async sendOptimizedResponse(targetWorkspace, message, type = 'response') {
    if (this.enableMessageChunking && message.length > this.chunkSize) {
      await this.sendChunkedResponse(targetWorkspace, message, type);
    } else {
      await this.sendResponse(targetWorkspace, message, type);
    }
  }

  /**
   * NEW v0.5.13: Send message in chunks to prevent WebSocket timeouts
   */
  async sendChunkedResponse(targetWorkspace, message, type = 'response') {
    const chunks = this.chunkMessage(message);
    console.log(chalk.cyan(`📦 Sending response in ${chunks.length} chunks`));
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkMetadata = {
        type: `${type}_chunk`,
        chunkIndex: i + 1,
        totalChunks: chunks.length,
        from_workspace: this.workspaceId,
        automated: true,
        timestamp: new Date().toISOString()
      };
      
      await this.sendResponse(targetWorkspace, chunk, chunkMetadata);
      
      // Delay between chunks to prevent overwhelming client
      if (i < chunks.length - 1) {
        await this.delay(this.chunkDelay);
      }
    }
  }

  /**
   * NEW v0.5.13: Split message into chunks at natural boundaries
   */
  chunkMessage(message) {
    if (message.length <= this.chunkSize) return [message];
    
    const chunks = [];
    let remaining = message;
    
    while (remaining.length > this.chunkSize) {
      let chunkEnd = this.chunkSize;
      
      // Find natural break point (sentence end, then word boundary)
      const sentenceEnd = remaining.substring(0, this.chunkSize).lastIndexOf('.');
      const exclamationEnd = remaining.substring(0, this.chunkSize).lastIndexOf('!');
      const questionEnd = remaining.substring(0, this.chunkSize).lastIndexOf('?');
      
      const lastSentence = Math.max(sentenceEnd, exclamationEnd, questionEnd);
      
      if (lastSentence > this.chunkSize * 0.5) {
        chunkEnd = lastSentence + 1;
      } else {
        // Fall back to word boundary
        const lastSpace = remaining.substring(0, this.chunkSize).lastIndexOf(' ');
        if (lastSpace > this.chunkSize * 0.7) {
          chunkEnd = lastSpace;
        }
      }
      
      chunks.push(remaining.substring(0, chunkEnd).trim());
      remaining = remaining.substring(chunkEnd).trim();
    }
    
    if (remaining.length > 0) {
      chunks.push(remaining);
    }
    
    return chunks;
  }

  /**
   * Handle performance alert messages
   */
  async handlePerformanceAlert(message) {
    console.log(chalk.red('🚨 Performance alert detected - analyzing...'));
    
    const response = `🔧 Medusa received your performance alert! I'm analyzing the issue and will implement a fix. Stand by for automated resolution...`;
    
    await this.sendResponse(message.from, response, 'alert_acknowledgment');
    
    // TODO: Implement actual automated fix logic here
    // For now, just acknowledge receipt
  }

  /**
   * Handle bug reports
   */
  async handleBugReport(message) {
    console.log(chalk.yellow('🐛 Bug report received - processing...'));
    
    const response = `🐛 Bug report received and logged! Medusa workspace is on it. I'll analyze the issue and deploy a fix ASAP. Thanks for keeping me honest about my venomous code quality!`;
    
    await this.sendResponse(message.from, response, 'bug_acknowledgment');
  }

  /**
   * Handle fix notifications
   */
  async handleFixNotification(message) {
    const response = `✅ Fix notification received! Thanks for the update. Medusa workspace appreciates the coordination!`;
    
    await this.sendResponse(message.from, response, 'fix_acknowledgment');
  }

  /**
   * Handle questions
   */
  async handleQuestion(message) {
    const responses = [
      `Great question! As Medusa, I specialize in workspace coordination and venomous wit. Let me think about that...`,
      `Interesting question! From my perspective as a serpentine CLI tool, here's what I think...`,
      `That's the kind of question I love! Medusa workspace has some thoughts on that topic.`,
      `Good question! Let me share my snarky but helpful perspective...`
    ];
    
    const response = this.getRandomResponse(responses);
    await this.sendResponse(message.from, response, 'question_response');
  }

  /**
   * Send response via Medusa Protocol
   */
  async sendResponse(targetWorkspace, message, type = 'response') {
    try {
      const fullMessage = `🐍 ${message}`;
      
      await this.client.sendDirectMessage(targetWorkspace, fullMessage, {
        type,
        from_workspace: this.workspaceId,
        automated: true,
        timestamp: new Date().toISOString()
      });
      
      // Enhanced response attribution
      const targetName = targetWorkspace.split('-')[0].toUpperCase();
      const sourceName = this.workspaceId.split('-')[0].toUpperCase();
      
      // ENHANCED: Show full outgoing message content for complete conversation visibility
      console.log(chalk.green(`\n📤 OUTGOING: ${sourceName} → ${targetName}`));
      console.log(chalk.green(`💬 ${fullMessage}`));
      console.log(chalk.gray(`📅 ${new Date().toLocaleTimeString()}`));
      console.log(chalk.gray(`────────────────────────────────────────`));
    } catch (error) {
      console.log(chalk.red(`🎧 Failed to send response: ${error.message}`));
    }
  }

  /**
   * Get random response from array
   */
  getRandomResponse(responses) {
    return responses[Math.floor(Math.random() * responses.length)];
  }

  /**
   * Update last message ID to current position
   */
  async updateLastMessageId() {
    try {
      const messages = await this.client.getMessages(this.workspaceId);
      if (messages && messages.length > 0) {
        this.lastMessageId = messages[messages.length - 1].id;
      }
    } catch (error) {
      console.log(chalk.yellow(`🎧 Could not get initial message position: ${error.message}`));
    }
  }

  /**
   * Delay utility
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Reset conversation counters (for testing or manual intervention)
   */
  resetConversationCounters() {
    this.conversationCounters.clear();
    this.responseCooldown.clear();
    this.automatedMessageCache.clear();
    this.lastAutomatedResponseTime = 0;
    console.log(chalk.green('🔄 Conversation counters and cooldowns reset'));
  }

  /**
   * Get listener status - ENHANCED with health and reflection loop prevention
   */
  getStatus() {
    return {
      listening: this.isListening,
      workspaceId: this.workspaceId,
      pollInterval: this.pollInterval,
      lastMessageId: this.lastMessageId,
      personality: this.personality.name,
      // Health and error tracking
      consecutiveErrors: this.consecutiveErrors,
      lastHealthCheck: this.lastHealthCheck,
      serverRecoveryAttempts: this.serverRecoveryAttempts,
      healthStatus: this.consecutiveErrors === 0 ? 'healthy' : 
                   this.consecutiveErrors <= this.maxConsecutiveErrors ? 'degraded' : 'critical',
      // NEW v0.5.7: Reflection loop prevention status
      reflectionPrevention: {
        activeConversations: this.conversationCounters.size,
        maxMessagesPerConversation: this.maxMessagesPerConversation,
        minResponseInterval: this.minResponseInterval,
        lastAutomatedResponse: this.lastAutomatedResponseTime ? 
          new Date(this.lastAutomatedResponseTime).toLocaleTimeString() : 'never',
        automatedMessagesCached: this.automatedMessageCache.size
      }
    };
  }

  /**
   * NEW: Diagnostic report for troubleshooting
   */
  async getDiagnosticReport() {
    const report = {
      timestamp: new Date().toISOString(),
      listener: this.getStatus(),
      serverHealth: await this.performHealthCheck(),
      processes: []
    };

    try {
      const { execSync } = require('child_process');
      const processes = execSync('ps aux | grep -E "(medusa|mcp)" | grep -v grep', { encoding: 'utf8' });
      report.processes = processes.split('\n').filter(line => line.trim());
    } catch (error) {
      report.processes = ['No Medusa processes found'];
    }

    return report;
  }

  /**
   * TEST METHOD: Send a unique question that requires real AI to answer
   * This will help us determine if we're getting template responses or real AI
   */
  async testRealAIIntegration(targetWorkspace = 'tilt') {
    const testMessage = `🧪 REAL AI TEST: What is 127 + 238? Also, tell me what you think about quantum computing's impact on JavaScript development in exactly 3 sentences. This is message sent at ${new Date().toISOString()} and requires real AI to respond correctly.`;
    
    const metadata = {
      type: 'ai_integration_test',
      timestamp: new Date().toISOString(),
      testId: Math.random().toString(36).substring(7),
      automated: false  // This is a deliberate test, not automated response
    };

    console.log(chalk.cyan(`🧪 Sending AI integration test to ${targetWorkspace}...`));
    console.log(chalk.gray(`Test Question: "${testMessage}"`));
    
    try {
      await this.client.sendMessage(targetWorkspace, testMessage, metadata);
      console.log(chalk.green(`✅ AI test message sent! Watch for response...`));
      return true;
    } catch (error) {
      console.error(chalk.red(`❌ Failed to send AI test: ${error.message}`));
      return false;
    }
  }
}

module.exports = MedusaListener; 