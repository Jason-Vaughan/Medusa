/**
 * 🔒 ProcessLock - Ensures only one instance of each script runs
 * 
 * Prevents multiple instances of Medusa servers, MCP servers, and CLI clients
 * from running simultaneously and causing conflicts.
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');

class ProcessLock {
  constructor(lockName, options = {}) {
    this.lockName = lockName;
    this.lockDir = options.lockDir || path.join(os.tmpdir(), 'medusa-locks');
    this.lockFile = path.join(this.lockDir, `${lockName}.lock`);
    this.checkInterval = options.checkInterval || 5000; // 5 seconds
    this.maxAge = options.maxAge || 30000; // 30 seconds
    this.isLocked = false;
    this.lockData = null;
    this.heartbeatInterval = null;
  }

  /**
   * Acquire a process lock
   */
  async acquire() {
    try {
      // Ensure lock directory exists
      await fs.mkdir(this.lockDir, { recursive: true });

      // Check if lock already exists
      const existingLock = await this.checkExistingLock();
      if (existingLock) {
        throw new Error(`Another instance of ${this.lockName} is already running (PID: ${existingLock.pid})`);
      }

      // Create new lock
      this.lockData = {
        pid: process.pid,
        startTime: Date.now(),
        lastHeartbeat: Date.now(),
        hostname: os.hostname(),
        version: process.env.npm_package_version || 'unknown'
      };

      await fs.writeFile(this.lockFile, JSON.stringify(this.lockData, null, 2));
      this.isLocked = true;

      // Start heartbeat to keep lock alive
      this.startHeartbeat();

      console.log(`🔒 Process lock acquired: ${this.lockName} (PID: ${process.pid})`);
      return true;

    } catch (error) {
      console.error(`❌ Failed to acquire process lock: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check if there's an existing valid lock
   */
  async checkExistingLock() {
    try {
      const lockContent = await fs.readFile(this.lockFile, 'utf8');
      const lockData = JSON.parse(lockContent);

      // Check if lock is stale
      const age = Date.now() - lockData.lastHeartbeat;
      if (age > this.maxAge) {
        console.log(`🧹 Cleaning up stale lock (age: ${Math.round(age/1000)}s)`);
        await this.release();
        return null;
      }

      // Check if process is still running
      if (!this.isProcessRunning(lockData.pid)) {
        console.log(`🧹 Cleaning up orphaned lock (PID ${lockData.pid} not running)`);
        await this.release();
        return null;
      }

      return lockData;

    } catch (error) {
      if (error.code === 'ENOENT') {
        return null; // No lock file exists
      }
      throw error;
    }
  }

  /**
   * Check if a process is still running
   */
  isProcessRunning(pid) {
    try {
      // Signal 0 checks if process exists without actually sending a signal
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Start heartbeat to keep lock alive
   */
  startHeartbeat() {
    this.heartbeatInterval = setInterval(async () => {
      if (this.isLocked && this.lockData) {
        try {
          this.lockData.lastHeartbeat = Date.now();
          await fs.writeFile(this.lockFile, JSON.stringify(this.lockData, null, 2));
        } catch (error) {
          console.error(`⚠️ Failed to update lock heartbeat: ${error.message}`);
        }
      }
    }, this.checkInterval);
  }

  /**
   * Stop heartbeat
   */
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Release the process lock
   */
  async release() {
    try {
      this.stopHeartbeat();
      
      if (this.isLocked) {
        await fs.unlink(this.lockFile);
        console.log(`🔓 Process lock released: ${this.lockName}`);
      }
      
      this.isLocked = false;
      this.lockData = null;

    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error(`⚠️ Failed to release lock: ${error.message}`);
      }
    }
  }

  /**
   * Get information about all active locks
   */
  static async getAllLocks(lockDir = null) {
    const dir = lockDir || path.join(os.tmpdir(), 'medusa-locks');
    const locks = [];

    try {
      const files = await fs.readdir(dir);
      
      for (const file of files) {
        if (file.endsWith('.lock')) {
          try {
            const lockFile = path.join(dir, file);
            const content = await fs.readFile(lockFile, 'utf8');
            const lockData = JSON.parse(content);
            
            locks.push({
              name: file.replace('.lock', ''),
              ...lockData,
              age: Date.now() - lockData.startTime,
              lastHeartbeatAge: Date.now() - lockData.lastHeartbeat,
              isStale: (Date.now() - lockData.lastHeartbeat) > 30000,
              isRunning: ProcessLock.prototype.isProcessRunning(lockData.pid)
            });
          } catch (error) {
            // Skip invalid lock files
          }
        }
      }
    } catch (error) {
      // Directory doesn't exist or can't be read
    }

    return locks;
  }

  /**
   * Clean up all stale locks
   */
  static async cleanupStaleLocks(lockDir = null) {
    const dir = lockDir || path.join(os.tmpdir(), 'medusa-locks');
    let cleaned = 0;

    try {
      const locks = await ProcessLock.getAllLocks(lockDir);
      
      for (const lock of locks) {
        if (lock.isStale || !lock.isRunning) {
          try {
            const lockFile = path.join(dir, `${lock.name}.lock`);
            await fs.unlink(lockFile);
            cleaned++;
            console.log(`🧹 Cleaned up stale lock: ${lock.name} (PID: ${lock.pid})`);
          } catch (error) {
            // Lock might have been cleaned up by another process
          }
        }
      }

      if (cleaned > 0) {
        console.log(`✅ Cleaned up ${cleaned} stale lock(s)`);
      }

    } catch (error) {
      console.error(`⚠️ Failed to cleanup stale locks: ${error.message}`);
    }

    return cleaned;
  }
}

module.exports = ProcessLock; 