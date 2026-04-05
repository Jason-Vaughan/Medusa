/**
 * DaemonClient - Client for communicating with Medusa Daemon
 *
 * Provides a simple interface to connect to the persistent daemon
 * and send/receive messages in real-time without file conflicts.
 *
 * Because sometimes you need to coordinate through a proper channel.
 */

const net = require('net');
const WebSocket = require('ws');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const chalk = require('chalk');

class DaemonClient {
  constructor(options = {}) {
    this.workspace = options.workspace || 'unknown';
    this.preferredMethod = options.method || 'tcp'; // tcp, websocket, pipe
    this.timeout = options.timeout || 5000;

    this.connection = null;
    this.isConnected = false;
    this.messageHandlers = new Map();
    this.responsePromises = new Map();
    this.messageId = 0;
  }

  /**
   * Connect to the Medusa daemon
   */
  async connect() {
    if (this.isConnected) {
      return true;
    }

    try {
      // Try different connection methods
      const methods = this.getConnectionMethods();

      for (const method of methods) {
        try {
          await this.tryConnection(method);
          console.log(chalk.green(`✅ Connected to Medusa daemon via ${method.type}`));
          return true;
        } catch (error) {
          console.log(chalk.gray(`⚠️  ${method.type} connection failed: ${error.message}`));
        }
      }

      throw new Error('Could not connect to Medusa daemon via any method');

    } catch (error) {
      console.log(chalk.red(`❌ Failed to connect to daemon: ${error.message}`));
      console.log(chalk.yellow('💡 Try running: medusa daemon start'));
      throw error;
    }
  }

  /**
   * Get available connection methods in order of preference
   */
  getConnectionMethods() {
    const methods = [];

    // TCP connection
    methods.push({
      type: 'tcp',
      host: 'localhost',
      port: 9999
    });

    // WebSocket connection
    methods.push({
      type: 'websocket',
      url: 'ws://localhost:10000'
    });

    // Named Pipe connection
    const pipePath = this.getPipePath();
    methods.push({
      type: 'pipe',
      path: pipePath
    });

    return methods;
  }

  /**
   * Try a specific connection method
   */
  async tryConnection(method) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Connection timeout (${this.timeout}ms)`));
      }, this.timeout);

      if (method.type === 'tcp' || method.type === 'pipe') {
        this.connection = new net.Socket();

        const connectOptions = method.type === 'tcp'
          ? { host: method.host, port: method.port }
          : { path: method.path };

        this.connection.connect(connectOptions, () => {
          clearTimeout(timeoutId);
          this.setupSocketHandlers();
          this.isConnected = true;
          resolve();
        });

      } else if (method.type === 'websocket') {
        this.connection = new WebSocket(method.url);

        this.connection.on('open', () => {
          clearTimeout(timeoutId);
          this.setupWebSocketHandlers();
          this.isConnected = true;
          resolve();
        });
      }

      this.connection.on('error', (error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
    });
  }

  /**
   * Setup handlers for socket connections (TCP/Named Pipe)
   */
  setupSocketHandlers() {
    let buffer = '';

    this.connection.on('data', (data) => {
      buffer += data.toString();

      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line

      for (const line of lines) {
        if (line.trim()) {
          try {
            const message = JSON.parse(line);
            this.handleMessage(message);
          } catch (error) {
            console.log(chalk.yellow(`⚠️  Invalid message: ${error.message}`));
          }
        }
      }
    });

    this.connection.on('close', () => {
      this.isConnected = false;
      console.log(chalk.gray('👋 Disconnected from daemon'));
    });

    this.connection.on('error', (error) => {
      console.log(chalk.red(`❌ Connection error: ${error.message}`));
      this.isConnected = false;
    });
  }

  /**
   * Setup handlers for WebSocket connections
   */
  setupWebSocketHandlers() {
    this.connection.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleMessage(message);
      } catch (error) {
        console.log(chalk.yellow(`⚠️  Invalid message: ${error.message}`));
      }
    });

    this.connection.on('close', () => {
      this.isConnected = false;
      console.log(chalk.gray('👋 Disconnected from daemon'));
    });

    this.connection.on('error', (error) => {
      console.log(chalk.red(`❌ WebSocket error: ${error.message}`));
      this.isConnected = false;
    });
  }

  /**
   * Handle incoming messages from daemon
   */
  handleMessage(message) {
    // Handle responses to requests
    if (message.requestId && this.responsePromises.has(message.requestId)) {
      const { resolve } = this.responsePromises.get(message.requestId);
      this.responsePromises.delete(message.requestId);
      resolve(message);
      return;
    }

    // Handle broadcast messages
    const handler = this.messageHandlers.get(message.type);
    if (handler) {
      handler(message.data);
    } else {
      console.log(chalk.cyan(`📨 Received: ${message.type}`), message.data);
    }
  }

  /**
   * Send message to daemon
   */
  async sendMessage(type, data = {}, expectResponse = false) {
    if (!this.isConnected) {
      await this.connect();
    }

    const requestId = expectResponse ? ++this.messageId : null;
    const message = {
      type,
      data,
      requestId,
      timestamp: Date.now()
    };

    const messageStr = JSON.stringify(message);

    try {
      if (this.connection.readyState === WebSocket.OPEN) {
        // WebSocket
        this.connection.send(messageStr);
      } else if (this.connection.writable) {
        // TCP/Named Pipe
        this.connection.write(messageStr + '\n');
      } else {
        throw new Error('Connection not writable');
      }

      if (expectResponse) {
        return new Promise((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            this.responsePromises.delete(requestId);
            reject(new Error('Response timeout'));
          }, this.timeout);

          this.responsePromises.set(requestId, {
            resolve: (response) => {
              clearTimeout(timeoutId);
              resolve(response);
            }
          });
        });
      }

    } catch (error) {
      throw new Error(`Failed to send message: ${error.message}`);
    }
  }

  /**
   * Send a message to another workspace
   */
  async send(to, message, options = {}) {
    try {
      const response = await this.sendMessage('send_message', {
        to,
        message,
        priority: options.priority || false,
        tag: options.tag || null
      }, true);

      if (response.type === 'error') {
        throw new Error(response.data.message);
      }

      return response.data;

    } catch (error) {
      throw new Error(`Failed to send message: ${error.message}`);
    }
  }

  /**
   * Get messages from the queue
   */
  async getMessages(options = {}) {
    try {
      const response = await this.sendMessage('get_messages', options, true);

      if (response.type === 'error') {
        throw new Error(response.data.message);
      }

      return response.data.messages;

    } catch (error) {
      throw new Error(`Failed to get messages: ${error.message}`);
    }
  }

  /**
   * Get daemon status
   */
  async getStatus() {
    try {
      const response = await this.sendMessage('status', {}, true);

      if (response.type === 'error') {
        throw new Error(response.data.message);
      }

      return response.data;

    } catch (error) {
      throw new Error(`Failed to get status: ${error.message}`);
    }
  }

  /**
   * Ping the daemon
   */
  async ping() {
    try {
      const start = Date.now();
      const response = await this.sendMessage('ping', {}, true);
      const end = Date.now();

      if (response.type === 'pong') {
        return end - start;
      } else {
        throw new Error('Invalid ping response');
      }

    } catch (error) {
      throw new Error(`Ping failed: ${error.message}`);
    }
  }

  /**
   * Listen for new messages
   */
  onNewMessage(handler) {
    this.messageHandlers.set('new_message', handler);
  }

  /**
   * Listen for specific message types
   */
  on(messageType, handler) {
    this.messageHandlers.set(messageType, handler);
  }

  /**
   * Remove message handler
   */
  off(messageType) {
    this.messageHandlers.delete(messageType);
  }

  /**
   * Disconnect from daemon
   */
  async disconnect() {
    if (this.connection) {
      if (this.connection.readyState === WebSocket.OPEN) {
        this.connection.close();
      } else if (this.connection.writable) {
        this.connection.end();
      }
      this.connection = null;
    }
    this.isConnected = false;
  }

  /**
   * Get named pipe path
   */
  getPipePath() {
    const isWindows = process.platform === 'win32';
    if (isWindows) {
      return `\\\\.\\pipe\\medusa-pipe-${this.workspace}`;
    } else {
      return path.join(os.tmpdir(), `medusa-pipe-${this.workspace}.sock`);
    }
  }

  /**
   * Check if daemon is running
   */
  static async isDaemonRunning() {
    const pidFile = path.join(os.homedir(), '.medusa', 'daemon.pid');

    try {
      if (await fs.pathExists(pidFile)) {
        const pid = parseInt(await fs.readFile(pidFile, 'utf8'));

        // Check if process exists
        try {
          process.kill(pid, 0);
          return { running: true, pid };
        } catch (error) {
          if (error.code === 'ESRCH') {
            // Process doesn't exist
            await fs.remove(pidFile);
            return { running: false, pid: null };
          }
          throw error;
        }
      }

      return { running: false, pid: null };

    } catch (error) {
      return { running: false, pid: null, error: error.message };
    }
  }
}

module.exports = DaemonClient;