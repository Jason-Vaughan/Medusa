/**
 * MedusaDaemon - Persistent background service for real-time inter-workspace communication
 *
 * Runs continuously in the background, handling:
 * - Real-time message watching and delivery
 * - WebSocket server for instant communication
 * - Named pipe listeners for local IPC
 * - Desktop notifications and alerts
 *
 * Because sometimes you need a daemon that never sleeps.
 */

const EventEmitter = require('events');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const net = require('net');
const WebSocket = require('ws');
const chalk = require('chalk');
const { MedusaError } = require('../utils/ErrorHandler');
const MedusaNotifier = require('../utils/MedusaNotifier');

class MedusaDaemon extends EventEmitter {
  constructor(options = {}) {
    super();

    this.port = options.port || 9999;
    this.pipeName = options.pipeName || 'medusa-pipe';
    this.workspace = options.workspace || 'unknown';
    this.pidFile = path.join(os.homedir(), '.medusa', 'daemon.pid');
    this.logFile = path.join(os.homedir(), '.medusa', 'daemon.log');

    // Services
    this.notifier = new MedusaNotifier();
    this.tcpServer = null;
    this.wsServer = null;
    this.pipeServer = null;

    // State
    this.isRunning = false;
    this.connections = new Set();
    this.startTime = null;

    // Bind methods
    this.handleMessage = this.handleMessage.bind(this);
    this.handleConnection = this.handleConnection.bind(this);
    this.shutdown = this.shutdown.bind(this);

    // Setup cleanup handlers
    process.on('SIGINT', this.shutdown);
    process.on('SIGTERM', this.shutdown);
  }

  /**
   * Start the Medusa daemon
   */
  async start() {
    if (this.isRunning) {
      this.log('⚠️  Daemon already running');
      return;
    }

    try {
      this.log('🚀 Starting Medusa Daemon...');
      this.startTime = new Date();

      // Create daemon directories
      await fs.ensureDir(path.dirname(this.pidFile));

      // Check if another daemon is running
      await this.checkExistingDaemon();

      // Write PID file
      await fs.writeFile(this.pidFile, process.pid.toString());

      // Start services
      await this.startTCPServer();
      await this.startWebSocketServer();
      await this.startNamedPipeServer();
      await this.startMessageWatching();

      this.isRunning = true;

      this.log(`✅ Medusa Daemon started successfully!`);
      this.log(`   TCP Server: localhost:${this.port}`);
      this.log(`   WebSocket: ws://localhost:${this.port + 1}`);
      this.log(`   Named Pipe: ${this.getPipePath()}`);
      this.log(`   Workspace: ${this.workspace}`);
      this.log(`   PID: ${process.pid}`);

      // Send startup notification
      await this.notifier.sendMessageNotification('Medusa Daemon', `Started for workspace: ${this.workspace}`, false);

      this.emit('started');

    } catch (error) {
      this.log(`❌ Failed to start daemon: ${error.message}`);
      throw error;
    }
  }

  /**
   * Stop the Medusa daemon
   */
  async shutdown() {
    if (!this.isRunning) {
      return;
    }

    this.log('🛑 Shutting down Medusa Daemon...');

    try {
      // Close all connections
      for (const connection of this.connections) {
        connection.destroy();
      }
      this.connections.clear();

      // Stop servers
      if (this.tcpServer) {
        this.tcpServer.close();
      }
      if (this.wsServer) {
        this.wsServer.close();
      }
      if (this.pipeServer) {
        this.pipeServer.close();
      }

      // Stop message watching
      await this.messageQueue.cleanup();

      // Remove PID file
      if (await fs.pathExists(this.pidFile)) {
        await fs.remove(this.pidFile);
      }

      this.isRunning = false;
      this.log('👋 Medusa Daemon stopped');

      this.emit('stopped');
      process.exit(0);

    } catch (error) {
      this.log(`⚠️  Error during shutdown: ${error.message}`);
      process.exit(1);
    }
  }

  /**
   * Start TCP server for inter-daemon communication
   */
  async startTCPServer() {
    return new Promise((resolve, reject) => {
      this.tcpServer = net.createServer(this.handleConnection);

      this.tcpServer.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
          this.log(`⚠️  Port ${this.port} in use, trying ${this.port + 10}`);
          this.port += 10;
          this.tcpServer.listen(this.port);
        } else {
          reject(error);
        }
      });

      this.tcpServer.on('listening', () => {
        this.log(`🌐 TCP Server listening on port ${this.port}`);
        resolve();
      });

      this.tcpServer.listen(this.port);
    });
  }

  /**
   * Start WebSocket server for web-based communication
   */
  async startWebSocketServer() {
    try {
      this.wsServer = new WebSocket.Server({
        port: this.port + 1,
        host: 'localhost'
      });

      this.wsServer.on('connection', (ws) => {
        this.log('🔗 WebSocket client connected');
        this.connections.add(ws);

        ws.on('message', async (data) => {
          try {
            const message = JSON.parse(data.toString());
            await this.handleMessage(message, ws);
          } catch (error) {
            this.log(`⚠️  WebSocket message error: ${error.message}`);
          }
        });

        ws.on('close', () => {
          this.connections.delete(ws);
          this.log('👋 WebSocket client disconnected');
        });

        ws.on('error', (error) => {
          this.log(`⚠️  WebSocket error: ${error.message}`);
          this.connections.delete(ws);
        });
      });

      this.log(`📡 WebSocket Server listening on port ${this.port + 1}`);

    } catch (error) {
      this.log(`⚠️  Failed to start WebSocket server: ${error.message}`);
    }
  }

  /**
   * Start named pipe server for local IPC
   */
  async startNamedPipeServer() {
    const pipePath = this.getPipePath();

    try {
      // Remove existing pipe if it exists
      if (await fs.pathExists(pipePath)) {
        await fs.remove(pipePath);
      }

      this.pipeServer = net.createServer(this.handleConnection);

      this.pipeServer.listen(pipePath, () => {
        this.log(`📮 Named Pipe Server listening at ${pipePath}`);
      });

      this.pipeServer.on('error', (error) => {
        this.log(`⚠️  Named Pipe error: ${error.message}`);
      });

    } catch (error) {
      this.log(`⚠️  Failed to start Named Pipe server: ${error.message}`);
    }
  }

  /**
   * Start watching for message queue changes
   */
  async startMessageWatching() {
    try {
      await this.messageQueue.startWatching();

      this.messageQueue.on('newMessage', async (message) => {
        // Enhanced message attribution with clear FROM → TO display
        const fromName = message.fromName || message.from.split('-')[0].toUpperCase();
        const toName = message.toName || message.to.split('-')[0].toUpperCase();
        const direction = message.type === 'broadcast' ? '📢 BROADCAST' : `${fromName} → ${toName}`;

        this.log(`📬 ${direction}: "${message.message}"`);

        // Broadcast to all connected clients
        await this.broadcastMessage('new_message', message);

        // Send desktop notification
        if (message.priority) {
          await this.notifier.sendPriorityNotification(message.from, message.message);
        } else {
          await this.notifier.sendMessageNotification(message.from, message.message, false);
        }

        // Auto-mark as read after notification
        setTimeout(async () => {
          await this.messageQueue.markAsRead([message.id]);
        }, 1000);
      });

      this.log('👁️  Started message queue watching');

    } catch (error) {
      this.log(`⚠️  Failed to start message watching: ${error.message}`);
    }
  }

  /**
   * Handle incoming connections (TCP/Named Pipe)
   */
  handleConnection(socket) {
    this.log('🔗 Client connected');
    this.connections.add(socket);

    let buffer = '';

    socket.on('data', (data) => {
      buffer += data.toString();

      // Process complete messages (newline-delimited)
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.trim()) {
          try {
            const message = JSON.parse(line);
            this.handleMessage(message, socket);
          } catch (error) {
            this.log(`⚠️  Invalid message: ${error.message}`);
          }
        }
      }
    });

    socket.on('close', () => {
      this.connections.delete(socket);
      this.log('👋 Client disconnected');
    });

    socket.on('error', (error) => {
      this.log(`⚠️  Connection error: ${error.message}`);
      this.connections.delete(socket);
    });

    // Send welcome message
    this.sendToClient(socket, 'welcome', {
      workspace: this.workspace,
      pid: process.pid,
      uptime: Date.now() - this.startTime.getTime()
    });
  }

  /**
   * Handle incoming messages
   */
  async handleMessage(message, sender) {
    try {
      switch (message.type) {
        case 'send_message':
          await this.handleSendMessage(message.data, sender);
          break;
        case 'get_messages':
          await this.handleGetMessages(message.data, sender);
          break;
        case 'ping':
          this.sendToClient(sender, 'pong', { timestamp: Date.now() });
          break;
        case 'status':
          await this.handleStatusRequest(sender);
          break;
        default:
          this.log(`❓ Unknown message type: ${message.type}`);
      }
    } catch (error) {
      this.log(`⚠️  Error handling message: ${error.message}`);
      this.sendToClient(sender, 'error', { message: error.message });
    }
  }

  /**
   * Handle send message request
   */
  async handleSendMessage(data, sender) {
    try {
      const message = await this.messageQueue.sendMessage({
        from: this.workspace,
        to: data.to,
        message: data.message,
        priority: data.priority || false,
        tag: data.tag || null
      });

      this.sendToClient(sender, 'message_sent', {
        id: message.id,
        timestamp: message.timestamp
      });

      this.log(`📤 Message sent to ${data.to}: "${data.message}"`);

    } catch (error) {
      this.sendToClient(sender, 'error', { message: error.message });
    }
  }

  /**
   * Handle get messages request
   */
  async handleGetMessages(data, sender) {
    try {
      const messages = await this.messageQueue.getMessages(data || {});
      this.sendToClient(sender, 'messages', { messages });
    } catch (error) {
      this.sendToClient(sender, 'error', { message: error.message });
    }
  }

  /**
   * Handle status request
   */
  async handleStatusRequest(sender) {
    const status = {
      workspace: this.workspace,
      pid: process.pid,
      uptime: Date.now() - this.startTime.getTime(),
      connections: this.connections.size,
      ports: {
        tcp: this.port,
        websocket: this.port + 1
      },
      pipePath: this.getPipePath()
    };

    this.sendToClient(sender, 'status', status);
  }

  /**
   * Send message to a specific client
   */
  sendToClient(client, type, data) {
    const message = JSON.stringify({ type, data, timestamp: Date.now() });

    try {
      if (client.readyState === WebSocket.OPEN) {
        // WebSocket client
        client.send(message);
      } else if (client.writable) {
        // TCP/Named Pipe client
        client.write(message + '\n');
      }
    } catch (error) {
      this.log(`⚠️  Failed to send to client: ${error.message}`);
    }
  }

  /**
   * Broadcast message to all connected clients
   */
  async broadcastMessage(type, data) {
    for (const client of this.connections) {
      this.sendToClient(client, type, data);
    }
  }

  /**
   * Check if another daemon is already running
   */
  async checkExistingDaemon() {
    if (await fs.pathExists(this.pidFile)) {
      try {
        const pid = parseInt(await fs.readFile(this.pidFile, 'utf8'));

        // Check if process is still running
        try {
          process.kill(pid, 0); // Signal 0 just checks if process exists
          throw new MedusaError(`Daemon already running with PID ${pid}`, 'DAEMON_ALREADY_RUNNING');
        } catch (error) {
          if (error.code === 'ESRCH') {
            // Process doesn't exist, remove stale PID file
            await fs.remove(this.pidFile);
            this.log('🧹 Removed stale PID file');
          } else {
            throw error;
          }
        }
      } catch (error) {
        if (error.code !== 'DAEMON_ALREADY_RUNNING') {
          // Invalid PID file, remove it
          await fs.remove(this.pidFile);
        } else {
          throw error;
        }
      }
    }
  }

  /**
   * Get named pipe path
   */
  getPipePath() {
    const isWindows = process.platform === 'win32';
    if (isWindows) {
      return `\\\\.\\pipe\\${this.pipeName}-${this.workspace}`;
    } else {
      return path.join(os.tmpdir(), `${this.pipeName}-${this.workspace}.sock`);
    }
  }

  /**
   * Log message with timestamp
   */
  log(message) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}`;

    console.log(chalk.gray(logEntry));

    // Also write to log file
    fs.appendFile(this.logFile, logEntry + '\n').catch(() => {
      // Ignore log file errors
    });
  }

  /**
   * Get daemon status
   */
  getStatus() {
    return {
      running: this.isRunning,
      workspace: this.workspace,
      pid: process.pid,
      startTime: this.startTime,
      uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
      connections: this.connections.size,
      ports: {
        tcp: this.port,
        websocket: this.port + 1
      },
      pipePath: this.getPipePath(),
      logFile: this.logFile
    };
  }
}

module.exports = MedusaDaemon;