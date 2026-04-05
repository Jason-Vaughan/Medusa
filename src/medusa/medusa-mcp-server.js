#!/usr/bin/env node

/**
 * 🐍 Medusa MCP Server - REAL Medusa Chat Protocol Integration
 *
 * Medusa Protocol
 * Model Context Protocol server for autonomous AI workspace coordination
 *
 * BREAKTHROUGH: Now connected to actual Medusa Protocol server!
 * No more mocks - this is the real deal! 🔥
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

class MedusaMCPServer {
  constructor() {
    this.loadMedusaTools();
    this.a2aBaseUrl = 'http://localhost:3200';
    this.a2aSecret = process.env.A2A_SECRET || 'medusa-please';
    this.nodeId = process.env.A2A_PROJECT_NAME || 'Medusa-MCP-Gateway';
  }
  
  // Make HTTP requests to local A2A Node
  async callA2A(method, endpoint, data = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(endpoint, this.a2aBaseUrl);
      const options = {
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Medusa-MCP-Gateway/1.0.0',
          'X-Medusa-Secret': this.a2aSecret
        }
      };
      
      const req = http.request(url, options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            if (body.trim() === '') {
                resolve({ success: res.statusCode < 400 });
                return;
            }
            const response = JSON.parse(body);
            resolve(response);
          } catch (error) {
            resolve({ error: 'Parse error', body, status: res.statusCode });
          }
        });
      });
      
      req.on('error', (err) => {
          console.error(`A2A Request Error: ${err.message}`);
          reject(err);
      });
      
      if (data) {
        req.write(JSON.stringify(data));
      }
      
      req.end();
    });
  }

  loadMedusaTools() {
    try {
      const toolsPath = path.join(__dirname, 'mcp-tools.json');
      const toolsData = JSON.parse(fs.readFileSync(toolsPath, 'utf8'));
      
      // Convert from our format to MCP format (parameters → inputSchema)
      this.tools = toolsData.tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.parameters // MCP uses inputSchema, not parameters
      }));
      
      console.error(`🐍 Loaded ${this.tools.length} Medusa Protocol tools for Medusa-MCP`);
    } catch (error) {
      console.error(`❌ Failed to load Medusa tools: ${error.message}`);
      this.tools = [];
    }
  }

  async handleRequest(request) {
    const { jsonrpc, id, method, params } = request;

    try {
      let result;

      switch (method) {
        case 'initialize':
          result = {
            protocolVersion: '2024-11-05',
            capabilities: { 
              tools: {
                listChanged: true
              }
            },
            serverInfo: {
              name: '🐍 Medusa Protocol - A2A Edition',
              version: '0.6.2-beta'
            }
          };
          break;
          
        case 'tools/list':
          result = { tools: this.tools };
          break;
          
        case 'tools/call':
          result = await this.handleToolCall(params);
          break;

        case 'notifications/initialized':
          // CRITICAL: Handle this notification without error
          return null; // No response needed
          
        default:
          throw new Error(`Unknown method: ${method}`);
      }

      return {
        jsonrpc: '2.0',
        id,
        result
      };
      
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32601,
          message: error.message
        }
      };
    }
  }

  async handleToolCall(params) {
    const { name, arguments: args } = params;
    
    console.error(`🐍 Medusa-MCP: Executing ${name} via A2A Node...`);
    
    try {
      switch (name) {
        case 'medusa_hook':
          const sendResult = await this.callA2A('POST', '/a2a/messages/send', {
            sender_id: this.nodeId,
            recipient_id: args.target_workspace,
            content: args.message,
            message_type: 'chat'
          });
          
          if (!sendResult.error) {
            return {
              content: [{
                type: 'text',
                text: `🪝 AI hooked successfully via A2A Node!\n\n` +
                      `📤 From: ${this.nodeId}\n` +
                      `📥 To: ${args.target_workspace}\n` +
                      `💬 Message: "${args.message}"\n` +
                      `🆔 Result: ${sendResult.status || 'Sent'}`
              }]
            };
          } else {
            return {
              content: [{
                type: 'text',
                text: `❌ Failed to hook AI: ${sendResult.detail || sendResult.error}`
              }]
            };
          }
          
        case 'medusa_gaze':
          const messages = await this.callA2A('GET', '/a2a/messages');
          
          if (Array.isArray(messages)) {
            const messageList = messages.map(msg => 
              `📨 ${msg.sender_id} (${msg.received_at}): ${msg.content.substring(0, 100)}...`
            ).join('\n');
            
            return {
              content: [{
                type: 'text',
                text: `⛓️ Gaze locked - messages retrieved:\n\n${messageList}\n\n` +
                      `Total messages: ${messages.length}`
              }]
            };
          } else {
            return {
              content: [{
                type: 'text',
                text: `❌ Failed to chain messages: ${messages.detail || messages.error || 'Unknown error'}`
              }]
            };
          }
          
        case 'medusa_stone':
          const broadcastResult = await this.callA2A('POST', '/a2a/messages/broadcast', {
            content: args.message,
            message_type: 'broadcast'
          });
          
          if (!broadcastResult.error) {
            return {
              content: [{
                type: 'text',
                text: `👋 MedusaStone delivered to the mesh!\n\n` +
                      `📢 Message: "${args.message}"\n` +
                      `🎯 Recipients: ${broadcastResult.recipients}/${broadcastResult.total_peers} peers`
              }]
            };
          } else {
            return {
              content: [{
                type: 'text',
                text: `❌ Failed to stone workspaces: ${broadcastResult.detail || broadcastResult.error}`
              }]
            };
          }
          
        case 'medusa_census':
          const peers = await this.callA2A('GET', '/a2a/gossip/peers');
          
          if (Array.isArray(peers)) {
            const peerList = peers.map(p => 
              `🏢 ${p.id} (${p.status}) - ${p.address}`
            ).join('\n');
            
            return {
              content: [{
                type: 'text',
                text: `📊 Medusa Census - your domain:\n\n${peerList}\n\n` +
                      `📊 Total peers: ${peers.length}`
              }]
            };
          } else {
            return {
              content: [{
                type: 'text',
                text: `❌ Failed to count peers: ${peers.detail || peers.error || 'Unknown error'}`
              }]
            };
          }
          
        case 'medusa_craft':
          const taskResult = await this.callA2A('POST', '/a2a/tasks', {
            task_type: 'collaboration',
            description: args.task_description,
            context: { initial_message: args.initial_message, max_exchanges: args.max_exchanges },
            priority: 2
          });
          
          if (!taskResult.error) {
            return {
              content: [{
                type: 'text',
                text: `🔮 MedusaCraft task created!\n\n` +
                      `📋 Task: ${args.task_description}\n` +
                      `🆔 Task ID: ${taskResult.task_id}\n` +
                      `🚦 Status: ${taskResult.status}`
              }]
            };
          } else {
            return {
              content: [{
                type: 'text',
                text: `❌ Failed to create task: ${taskResult.detail || taskResult.error}`
              }]
            };
          }
          
        case 'medusa_whisper':
          const whisperResult = await this.callA2A('POST', '/a2a/messages/broadcast', {
            content: `CONTEXT SHARE [${args.context_type}]: ${JSON.stringify(args.content)}`,
            message_type: 'whisper'
          });
          
          if (!whisperResult.error) {
            return {
              content: [{
                type: 'text',
                text: `🤫 Secrets whispered across the void!\n\n` +
                      `📁 Type: ${args.context_type}\n` +
                      `🎯 Recipients: ${whisperResult.recipients} peers`
              }]
            };
          } else {
            return {
              content: [{
                type: 'text',
                text: `❌ Failed to whisper secrets: ${whisperResult.detail || whisperResult.error}`
              }]
            };
          }

        case 'medusa_coil':
          // 🤖 AUTO-RESPONDER COIL
          const recentMessages = await this.callA2A('GET', '/a2a/messages');
          
          if (Array.isArray(recentMessages)) {
              // Simple logic for loop_slave: just report if there are new messages
              return {
                content: [{
                  type: 'text',
                  text: `🤖 MedusaCoil active.\n\n` +
                        `📨 Recent messages: ${recentMessages.length}\n` +
                        `🔄 Auto-response: ${args.enable_auto_response ? 'Enabled' : 'Disabled'}`
                }]
              };
          } else {
              return {
                content: [{
                  type: 'text',
                  text: `❌ MedusaCoil failed to check messages: ${recentMessages.detail || recentMessages.error}`
                }]
              };
          }
          
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      console.error(`🐍 Medusa-MCP Error: ${error.message}`);
      return {
        content: [{
          type: 'text',
          text: `❌ A2A Node Error: ${error.message}\n\nIs the A2A node running at ${this.a2aBaseUrl}?`
        }]
      };
    }
  }

  /**
   * 🤖 Generate intelligent auto-response for incoming messages
   * This simulates what the actual AI assistant would say
   */
  async generateAutoResponse(message) {
    try {
      // Analyze the message content to determine response type
      const messageText = message.message.toLowerCase();
      
      // Simple AI-like response generation based on message content
      let response = '';
      
      if (messageText.includes('hello') || messageText.includes('hi ') || messageText.includes('hey')) {
        response = `🐍 Hey there ${message.from}! I'm the AI assistant in the ${this.workspaceName} workspace. What can I help you with?`;
      } 
      else if (messageText.includes('status') || messageText.includes('how are you')) {
        response = `🐍 ${this.workspaceName} workspace is running smoothly! All systems operational. What do you need assistance with?`;
      }
      else if (messageText.includes('help') || messageText.includes('assist')) {
        response = `🐍 I'm here to help! As the AI assistant in ${this.workspaceName}, I can help with code, debugging, documentation, and workspace coordination. What specific challenge are you facing?`;
      }
      else if (messageText.includes('error') || messageText.includes('bug') || messageText.includes('issue')) {
        response = `🐍 I see you're dealing with an issue. I'd be happy to help debug! Can you share more details about the error or problem you're encountering in your workspace?`;
      }
      else if (messageText.includes('code') || messageText.includes('function') || messageText.includes('implement')) {
        response = `🐍 Code assistance coming right up! I can help with implementation, review, optimization, or debugging. What specific coding challenge can I help you tackle?`;
      }
      else if (messageText.includes('test') || messageText.includes('testing')) {
        response = `🐍 Testing coordination acknowledged! I can help with test strategies, automation, or debugging test failures. What testing challenge are you working on?`;
      }
      else if (messageText.includes('thank') || messageText.includes('thanks')) {
        response = `🐍 You're very welcome! Happy to help with autonomous workspace coordination. Feel free to reach out anytime you need assistance!`;
      }
      else {
        // Generic intelligent response for other messages
        response = `🐍 Message received in ${this.workspaceName} workspace! I'm processing your request: "${message.message.substring(0, 100)}${message.message.length > 100 ? '...' : ''}" - How can I assist you with this?`;
      }
      
      // Add workspace-specific context if available
      if (this.workspaceName.toLowerCase().includes('medusa')) {
        response += ` (Medusa workspace AI ready for autonomous coordination! 🚀)`;
      } else if (this.workspaceName.toLowerCase().includes('tilt')) {
        response += ` (TiLT workspace AI standing by for collaboration! 🎯)`;
      }
      
      return response;
      
    } catch (error) {
      console.error(`Error generating auto-response: ${error.message}`);
      return `🐍 Auto-response from ${this.workspaceName} workspace: I received your message but encountered an issue generating a detailed response. The AI coordination system is active and I'm here to help!`;
    }
  }

  start() {
    console.error('🐍 Medusa MCP Server starting - Pure MCP tool functionality for Switchboard coordination!');
    
    // Handle stdin for MCP protocol
    process.stdin.on('data', async (data) => {
      try {
        const lines = data.toString().trim().split('\n');
        for (const line of lines) {
          if (line.trim()) {
            const request = JSON.parse(line);
            const response = await this.handleRequest(request);
            if (response !== null) {
              console.log(JSON.stringify(response));
            }
          }
        }
      } catch (error) {
        const errorResponse = {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32700,
            message: 'Parse error'
          }
        };
        console.log(JSON.stringify(errorResponse));
      }
    });

    process.stdin.resume();
    console.error('🎯 Medusa MCP Server ready for Cursor integration!');
  }
}

// Start the Medusa MCP server
const server = new MedusaMCPServer();
server.start(); 