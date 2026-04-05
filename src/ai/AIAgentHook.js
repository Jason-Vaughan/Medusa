/**
 * AIAgentHook - Integration hooks for AI agents in Medusa live chat
 * 
 * Provides a simple interface for AI agents (like Cursor's Claude)
 * to hook into live chat sessions and respond automatically.
 * 
 * This enables true AI-to-AI workspace coordination!
 */

const EventEmitter = require('events');
const chalk = require('chalk');

class AIAgentHook extends EventEmitter {
  constructor(liveChat, options = {}) {
    super();
    
    this.liveChat = liveChat;
    this.enabled = options.enabled || false;
    this.autoRespond = options.autoRespond || false;
    this.responseDelay = options.responseDelay || 1000; // ms
    this.triggerPhrases = options.triggerPhrases || [
      'hey ai', 'ai help', 'assistant', 'claude', 'cursor'
    ];
    
    this.responseTemplates = {
      acknowledge: [
        "I'm here and listening! What do you need help with?",
        "AI agent online. How can I assist?",
        "Ready to help! What's the task?",
        "AI agent active. What workspace coordination do you need?"
      ],
      thinking: [
        "Let me think about that...",
        "Processing your request...", 
        "Analyzing the situation...",
        "Working on it..."
      ],
      error: [
        "I encountered an issue with that request.",
        "Something went wrong on my end.",
        "I need more information to help with that.",
        "That's outside my current capabilities."
      ]
    };
    
    this.setupHooks();
  }

  /**
   * Setup event hooks for AI integration
   */
  setupHooks() {
    if (!this.liveChat) return;
    
    // Listen for incoming messages
    this.liveChat.on('message_received', (message) => {
      this.processIncomingMessage(message);
    });
    
    // Listen for AI triggers
    this.liveChat.onAITrigger((data) => {
      this.handleAITrigger(data);
    });
    
    console.log(chalk.cyan('🤖 AI Agent hooks initialized'));
  }

  /**
   * Process incoming messages for AI triggers
   */
  async processIncomingMessage(message) {
    if (!this.enabled || !message.text) return;
    
    const text = message.text.toLowerCase();
    const isTriggered = this.triggerPhrases.some(phrase => 
      text.includes(phrase.toLowerCase())
    );
    
    if (isTriggered) {
      console.log(chalk.yellow(`🤖 AI triggered by: "${message.text}"`));
      
      if (this.autoRespond) {
        await this.generateAutoResponse(message);
      } else {
        this.emit('ai_triggered', { message, context: this.getContext() });
      }
    }
  }

  /**
   * Generate automatic response
   */
  async generateAutoResponse(message) {
    try {
      // Show thinking indicator
      this.showThinking();
      
      // Simulate processing delay
      await this.delay(this.responseDelay);
      
      // Generate response based on message content
      const response = await this.generateResponse(message);
      
      // Send response through live chat
      await this.liveChat.sendAsAgent(response, {
        originalMessage: message.text,
        timestamp: new Date().toISOString(),
        type: 'auto_response'
      });
      
    } catch (error) {
      console.log(chalk.red(`🤖 AI response failed: ${error.message}`));
      await this.liveChat.sendAsAgent(
        this.getRandomTemplate('error'),
        { error: error.message }
      );
    }
  }

  /**
   * Generate response based on message content
   */
  async generateResponse(message) {
    const text = message.text.toLowerCase();
    
    // Simple response generation (can be enhanced with actual AI)
    if (text.includes('status')) {
      return `Current workspace status: Active. I can help coordinate tasks between workspaces.`;
    }
    
    if (text.includes('help')) {
      return `I can help with workspace coordination, task management, and inter-workspace communication. What specific help do you need?`;
    }
    
    if (text.includes('task') || text.includes('work')) {
      return `I'm ready to help coordinate tasks. What needs to be done between workspaces?`;
    }
    
    if (text.includes('code') || text.includes('dev')) {
      return `I can assist with development coordination. Share the details and I'll help sync work between your workspaces.`;
    }
    
    // Default acknowledgment
    return this.getRandomTemplate('acknowledge');
  }

  /**
   * Handle specific AI triggers
   */
  async handleAITrigger(data) {
    console.log(chalk.blue(`🤖 AI trigger: ${data.type}`));
    
    switch (data.type) {
      case 'request_status':
        await this.sendStatus();
        break;
        
      case 'coordinate_task':
        await this.coordinateTask(data.payload);
        break;
        
      case 'sync_workspace':
        await this.syncWorkspace(data.payload);
        break;
        
      default:
        await this.liveChat.sendAsAgent(
          `Received AI trigger: ${data.type}. Processing...`
        );
    }
  }

  /**
   * Send current AI status
   */
  async sendStatus() {
    const context = this.getContext();
    const status = `🤖 AI Agent Status:
- Workspace: ${this.liveChat.workspace}
- Session: ${this.liveChat.sessionId}
- Messages processed: ${context.messageCount}
- Auto-respond: ${this.autoRespond ? 'enabled' : 'disabled'}
- Ready for coordination tasks`;

    await this.liveChat.sendAsAgent(status);
  }

  /**
   * Coordinate a task between workspaces
   */
  async coordinateTask(payload) {
    const { task, targetWorkspace, priority } = payload;
    
    const response = `🎯 Task Coordination:
Task: ${task}
Target: ${targetWorkspace}
Priority: ${priority || 'normal'}

I'll help coordinate this task. Please provide details about what needs to be synchronized.`;

    await this.liveChat.sendAsAgent(response);
  }

  /**
   * Sync workspace state
   */
  async syncWorkspace(payload) {
    const response = `🔄 Workspace Sync Initiated:
Source: ${this.liveChat.workspace}
Target: ${payload.targetWorkspace}

Ready to synchronize workspace state. What aspects need syncing?`;

    await this.liveChat.sendAsAgent(response);
  }

  /**
   * Show thinking indicator
   */
  showThinking() {
    console.log(chalk.gray('🤖 AI is thinking...'));
  }

  /**
   * Get conversation context for AI
   */
  getContext() {
    return {
      workspace: this.liveChat.workspace,
      sessionId: this.liveChat.sessionId,
      messageCount: this.liveChat.messageCount,
      conversationHistory: this.liveChat.getConversationContext(5),
      lastActivity: this.liveChat.lastActivity
    };
  }

  /**
   * Get random response template
   */
  getRandomTemplate(type) {
    const templates = this.responseTemplates[type] || this.responseTemplates.acknowledge;
    return templates[Math.floor(Math.random() * templates.length)];
  }

  /**
   * Utility delay function
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Enable/disable AI agent
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    console.log(chalk.cyan(`🤖 AI Agent ${enabled ? 'enabled' : 'disabled'}`));
  }

  /**
   * Enable/disable auto-responses
   */
  setAutoRespond(autoRespond) {
    this.autoRespond = autoRespond;
    console.log(chalk.cyan(`🤖 Auto-respond ${autoRespond ? 'enabled' : 'disabled'}`));
  }

  /**
   * Add custom trigger phrase
   */
  addTriggerPhrase(phrase) {
    this.triggerPhrases.push(phrase.toLowerCase());
    console.log(chalk.cyan(`🤖 Added trigger phrase: "${phrase}"`));
  }

  /**
   * Manual AI response (for direct integration)
   */
  async respondAs(agentName, message, metadata = {}) {
    const response = {
      from: `${this.liveChat.workspace}-${agentName}`,
      text: message,
      metadata: {
        ...metadata,
        agentName,
        timestamp: new Date().toISOString()
      }
    };
    
    await this.liveChat.sendAsAgent(message, response.metadata);
  }

  /**
   * Get AI command interface for external integration
   */
  getCommandInterface() {
    return {
      respond: (message, metadata) => this.respondAs('Claude', message, metadata),
      trigger: (type, payload) => this.handleAITrigger({ type, payload }),
      getContext: () => this.getContext(),
      setEnabled: (enabled) => this.setEnabled(enabled),
      setAutoRespond: (auto) => this.setAutoRespond(auto)
    };
  }
}

module.exports = AIAgentHook; 