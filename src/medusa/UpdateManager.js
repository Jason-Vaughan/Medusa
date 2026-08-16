const https = require('https');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

const GITHUB_API_URL = 'https://api.github.com/repos/Jason-Vaughan/Medusa/releases/latest';

class UpdateManager {
  constructor(medusaServer) {
    this.server = medusaServer;
    this.installDir = path.resolve(__dirname, '../../');
    this.currentVersion = require(path.join(this.installDir, 'package.json')).version;
    this.pollingInterval = null;
    this.isUpdating = false;
  }

  startPolling(intervalMs = 3600000) { // Default 1 hour
    if (this.pollingInterval) clearInterval(this.pollingInterval);
    this.pollingInterval = setInterval(() => this.poll(), intervalMs);
    this.pollingInterval.unref();
    console.log(`[UpdateManager] Started polling for updates every ${intervalMs}ms`);
    // Initial check
    this.initialTimeout = setTimeout(() => this.poll(), 10000); // Wait 10 seconds before first check
    this.initialTimeout.unref();
  }

  stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    if (this.initialTimeout) {
      clearTimeout(this.initialTimeout);
      this.initialTimeout = null;
    }
  }

  async poll() {
    if (this.isUpdating) return;
    try {
      console.log('[UpdateManager] Polling for new releases...');
      this.lastCheckTime = new Date().toISOString();
      const releaseInfo = await this.checkLatestRelease();
      if (!releaseInfo) {
        this.lastCheckStatus = 'No release found on GitHub API';
        return;
      }

      const latestVersion = releaseInfo.tag_name.replace(/^v/, '');
      if (this.compareVersions(latestVersion, this.currentVersion) > 0) {
        console.log(`[UpdateManager] New version found: ${latestVersion} (Current: ${this.currentVersion})`);
        const asset = releaseInfo.assets.find(a => a.name.startsWith('medusa-') && a.name.endsWith('.tar.gz'));
        if (asset) {
          this.lastCheckStatus = `Update ${latestVersion} found and downloading`;
          await this.performHotSwap(latestVersion, asset.browser_download_url);
        } else {
          this.lastCheckStatus = `Error: Update ${latestVersion} found but no medusa-*.tar.gz asset attached`;
          console.log('[UpdateManager] No suitable tar.gz asset found in the release.');
        }
      } else {
        this.lastCheckStatus = 'Already on the latest version';
        console.log('[UpdateManager] Already on the latest version.');
      }
    } catch (error) {
      this.lastCheckStatus = `Error: ${error.message}`;
      console.error('[UpdateManager] Error during poll:', error.message);
    }
  }

  checkLatestRelease() {
    return new Promise((resolve, reject) => {
      const options = {
        headers: { 'User-Agent': 'Medusa-UpdateManager' }
      };
      https.get(GITHUB_API_URL, options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(e);
            }
          } else if (res.statusCode === 404) {
            resolve(null);
          } else {
            reject(new Error(`GitHub API returned status ${res.statusCode}`));
          }
        });
      }).on('error', reject);
    });
  }

  async performHotSwap(version, downloadUrl) {
    if (this.isUpdating) return;
    this.isUpdating = true;
    try {
      console.log(`[UpdateManager] Starting hot swap to version ${version}`);
      
      // 1. Broadcast upgrade warning
      this.broadcastWarning(`An update to version ${version} is available and will be applied shortly. Please save your work.`);
      
      // 2. Wait for safe states (idle workspaces)
      await this.waitForSafeStates();
      
      // 3. Download and verify
      const tarballPath = path.join(this.installDir, `medusa-update-${version}.tar.gz`);
      console.log(`[UpdateManager] Downloading to ${tarballPath}...`);
      await this.downloadFile(downloadUrl, tarballPath);
      
      // 4. Extract
      console.log(`[UpdateManager] Extracting update...`);
      await execAsync(`tar -xzf "${tarballPath}" -C "${this.installDir}" --strip-components=1`);
      
      // Cleanup tarball
      fs.unlinkSync(tarballPath);
      
      // 5. Restart
      console.log(`[UpdateManager] Update extracted successfully. Restarting Medusa...`);
      this.broadcastWarning(`Medusa has been updated to version ${version} and is restarting.`);
      
      setTimeout(() => {
        if (this.server && this.server.stop) {
          this.server.stop().then(() => {
            process.exit(0); // System/Docker/PM2 should restart it, or it will just exit.
          });
        } else {
          process.exit(0);
        }
      }, 2000);
      
    } catch (error) {
      console.error('[UpdateManager] Hot swap failed:', error);
      this.isUpdating = false;
    }
  }

  downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      https.get(url, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          return this.downloadFile(response.headers.location, dest).then(resolve).catch(reject);
        }
        if (response.statusCode !== 200) {
          return reject(new Error(`Failed to download: ${response.statusCode}`));
        }
        response.pipe(file);
        file.on('finish', () => {
          file.close(resolve);
        });
      }).on('error', (err) => {
        fs.unlink(dest, () => reject(err));
      });
    });
  }

  broadcastWarning(message) {
    if (!this.server || !this.server.wsServer) return;
    
    const payload = JSON.stringify({
      type: 'system_warning',
      message: message,
      timestamp: new Date().toISOString()
    });

    for (const connections of this.server.wsClients.values()) {
      for (const ws of connections.values()) {
        if (ws.readyState === 1 /* WebSocket.OPEN */) {
          ws.send(payload);
        }
      }
    }
    
    // Also push to message history if available
    if (this.server.messageHistory) {
      this.server.messageHistory.push({
        id: `sys-update-${Date.now()}`,
        from: 'system',
        to: '*',
        message: message,
        timestamp: new Date().toISOString(),
        type: 'telemetry'
      });
    }
  }

  async waitForSafeStates(maxWaitMs = 60000) {
    const start = Date.now();
    console.log('[UpdateManager] Waiting for workspaces to be idle...');
    
    while (Date.now() - start < maxWaitMs) {
      let allIdle = true;
      if (this.server && this.server.listenerStatus) {
        for (const [id, status] of this.server.listenerStatus.entries()) {
          if (status.status === 'active') {
            allIdle = false;
            break;
          }
        }
      }
      
      if (allIdle) {
        console.log('[UpdateManager] All workspaces are idle. Proceeding with update.');
        return true;
      }
      
      await new Promise(r => setTimeout(r, 5000));
    }
    
    console.log('[UpdateManager] Timeout waiting for idle states. Forcing update.');
    return false;
  }

  compareVersions(v1, v2) {
    const p1 = v1.split('.').map(Number);
    const p2 = v2.split('.').map(Number);
    for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
      const n1 = p1[i] || 0;
      const n2 = p2[i] || 0;
      if (n1 > n2) return 1;
      if (n1 < n2) return -1;
    }
    return 0;
  }
}

module.exports = UpdateManager;
