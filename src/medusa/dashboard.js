// Medusa Dashboard JavaScript - Clean and working!
const PROTOCOL_URL = `http://${window.location.hostname}:3009`;

// Check protocol status
async function checkStatus() {
  const statusDiv = document.getElementById('status');
  try {
    const response = await fetch(PROTOCOL_URL + '/health');
    const data = await response.json();
    
    statusDiv.innerHTML = `
      <div class="stats">
        <div class="stat-item">
          <div class="stat-value">${data.workspaces}</div>
          <div class="stat-label">Workspaces</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${data.messages}</div>
          <div class="stat-label">Messages</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${Math.floor(data.uptime)}s</div>
          <div class="stat-label">Uptime</div>
        </div>
      </div>
      <p><span class="status active">HISSING</span> Protocol v${data.version}</p>
    `;
  } catch (error) {
    statusDiv.innerHTML = `<p><span class="status inactive">OFFLINE</span> ${error.message}</p>`;
  }
}

// Load workspaces
async function loadWorkspaces() {
  const list = document.getElementById('workspaces');
  try {
    const response = await fetch(PROTOCOL_URL + '/workspaces');
    const data = await response.json();
    
    if (data.workspaces.length === 0) {
      list.innerHTML = '<li>No workspaces registered yet</li>';
      return;
    }
    
    list.innerHTML = data.workspaces.map(ws => {
      // Determine overall status
      let statusClass = 'inactive';
      let statusText = 'offline';
      
      if (ws.connection.webSocket && ws.listener.active) {
        statusClass = 'active';
        statusText = 'online';
      } else if (ws.connection.webSocket && !ws.listener.active) {
        statusClass = 'warning';
        statusText = 'connected';
      }
      
             // Format heartbeat time with "time ago" display
       const heartbeatTime = formatTimeAgo(ws.listener.lastHeartbeat);
      
             // Autonomous conversation readiness indicator (AI Ready)
       const autonomousIcon = ws.autonomousConversationReady ? 
         '<span style="color: #00ff88; font-weight: bold; font-size: 1.1em;">●</span>' : 
         '<span style="color: #666; font-size: 1.1em;">○</span>';

           // Connection status indicators with proper colors
    const wsColor = ws.connection.webSocket ? '#4A90E2' : '#666'; // Blue for WebSocket
    const heartbeatColor = ws.listener.active ? '#8B0000' : '#666'; // Deep maroon for heartbeat
    const connectionColor = ws.connected ? '#00ff88' : '#ff4444'; // Green for connected
    const lastSeenColor = ws.listener.lastHeartbeat ? '#FFA500' : '#666'; // Orange for last seen
      
      return `
        <li class="workspace-item">
          <div>
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
              <strong>${ws.name}</strong>
              ${autonomousIcon}
              <span class="status ${statusClass}">${statusText}</span>
            </div>
            <div style="font-size: 0.85em; color: var(--text-muted); line-height: 1.3;">
              <div style="font-family: monospace; font-size: 0.8em; opacity: 0.7;">ID: ${ws.id.substring(0, 20)}...</div>
                             <div style="display: flex; gap: 12px; margin-top: 4px; font-size: 0.85em;">
                 <span><span style="color: ${wsColor}; font-size: 1.1em; font-weight: bold;">${ws.connection.webSocket ? '●' : '○'}</span> <span style="color: ${wsColor};">${ws.connection.webSocket ? `${ws.connection.connectionCount} conn` : 'no conn'}</span></span>
                 <span style="color: #333;">|</span>
                 <span><span style="color: ${heartbeatColor}; font-size: 1.1em; font-weight: bold;">${ws.listener.active ? '●' : '○'}</span> <span style="color: ${heartbeatColor};">${ws.listener.active ? 'active' : 'inactive'}</span></span>
                 <span style="color: #333;">|</span>
                 <span><span style="color: ${connectionColor}; font-size: 1.1em; font-weight: bold;">${ws.connected ? '●' : '○'}</span> <span style="color: ${connectionColor};">${ws.connected ? 'connected' : 'disconnected'}</span></span>
                 <span style="color: #333;">|</span>
                 <span><span style="color: ${lastSeenColor}; font-size: 1.1em; font-weight: bold;">${ws.listener.lastHeartbeat ? '●' : '○'}</span> <span style="color: ${lastSeenColor};">${heartbeatTime}</span></span>
               </div>
            </div>
          </div>
          <div style="text-align: right; font-size: 0.8em;">
            <div style="color: ${ws.listener.autonomousMode ? '#00ff88' : '#FFA500'}; font-weight: 600;">
              ${ws.listener.autonomousMode ? '🤖 Autonomous' : '👤 Manual'}
            </div>
            <div style="color: ${ws.autonomousConversationReady ? '#00ff88' : '#ff6b6b'}; margin-top: 2px; font-weight: 500;">
              ${ws.autonomousConversationReady ? '✅ AI Ready' : '⏳ Preparing'}
            </div>
          </div>
        </li>
      `;
    }).join('');
    
    // Update workspace count in status if telemetry is available
    if (data.telemetry) {
      const statusDiv = document.getElementById('status');
      
      // Find or create autonomous status elements with smooth updates
      let autonomousDiv = document.getElementById('autonomous-status');
      let readySpan = document.getElementById('ready-count');
      let totalSpan = document.getElementById('total-count');
      let rateSpan = document.getElementById('rate-percent');
      
      if (!autonomousDiv) {
        // Create the autonomous status div structure once (no more rebuilding!)
        autonomousDiv = document.createElement('div');
        autonomousDiv.id = 'autonomous-status';
        autonomousDiv.style.cssText = 'margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.1);';
        
        autonomousDiv.innerHTML = `
          <div style="font-size: 0.9em; color: var(--text-muted); margin-bottom: 5px;">
            ● Autonomous Conversation Status
          </div>
          <div style="display: flex; gap: 15px; font-size: 0.85em;">
            <span>Ready: <strong id="ready-count" style="color: var(--success);">0</strong></span>
            <span>Total: <strong id="total-count">0</strong></span>
            <span>Rate: <strong id="rate-percent" style="color: var(--warning);">0%</strong></span>
          </div>
        `;
        
        statusDiv.appendChild(autonomousDiv);
        
        // Get references to the spans we just created
        readySpan = document.getElementById('ready-count');
        totalSpan = document.getElementById('total-count');
        rateSpan = document.getElementById('rate-percent');
      }
      
      // Update ONLY when values actually change - zero visual flicker
      if (readySpan && readySpan.textContent !== String(data.telemetry.autonomousConversationReady)) {
        readySpan.style.transition = 'all 0.2s ease';
        readySpan.textContent = data.telemetry.autonomousConversationReady;
      }
      if (totalSpan && totalSpan.textContent !== String(data.telemetry.totalWorkspaces)) {
        totalSpan.style.transition = 'all 0.2s ease';
        totalSpan.textContent = data.telemetry.totalWorkspaces;
      }
      if (rateSpan) {
        const newRate = `${data.telemetry.readinessPercentage}%`;
        const newColor = data.telemetry.readinessPercentage > 50 ? 'var(--success)' : 'var(--warning)';
        if (rateSpan.textContent !== newRate || rateSpan.style.color !== newColor) {
          rateSpan.style.transition = 'all 0.2s ease';
          rateSpan.textContent = newRate;
          rateSpan.style.color = newColor;
        }
      }
    }
    
  } catch (error) {
    list.innerHTML = `<li>Error loading workspaces: ${error.message}</li>`;
  }
}

// Cache for telemetry data to prevent unnecessary updates
let telemetryCache = {};

// Generate live MCP warning based on activity timestamp
function generateMCPWarning(mcpServer, serviceStatus) {
  // MCP telemetry disabled - focus on core Medusa functionality
  return null;
}

// Load telemetry data
async function loadTelemetry() {
  const telemetryDiv = document.getElementById('telemetry');
  try {
    const response = await fetch(PROTOCOL_URL + '/telemetry');
    const data = await response.json();
    
    // Smart caching: check if non-MCP data changed
    const staticData = { ...data };
    delete staticData.mcpServer;
    const staticDataHash = JSON.stringify(staticData);
    
    // Generate live MCP warning
    const mcpWarning = generateMCPWarning(data.mcpServer, data.services?.mcpServer);
    const allWarnings = [...data.warnings];
    if (mcpWarning) {
      allWarnings.push(mcpWarning);
    }
    
    // If only MCP data changed, update just the warnings section
    if (telemetryCache.lastStaticHash === staticDataHash) {
      // Only update warnings section for live MCP timer
      const existingWarningsDiv = telemetryDiv.querySelector('.warnings-section');
      if (existingWarningsDiv) {
        if (allWarnings.length > 0) {
          existingWarningsDiv.innerHTML = `
            <strong>⚠ Warnings:</strong><br>
            ${allWarnings.map(w => w).join('<br>')}
          `;
          existingWarningsDiv.style.display = 'block';
        } else {
          existingWarningsDiv.style.display = 'none';
        }
        return; // Skip full rebuild
      }
    }
    
    // Full rebuild needed
    telemetryCache.lastStaticHash = staticDataHash;
    
    let warningsHtml = '';
    if (allWarnings.length > 0) {
      warningsHtml = `
        <div class="warnings-section" style="color: var(--warning); margin-bottom: 10px;">
          <strong>⚠ Warnings:</strong><br>
          ${allWarnings.map(w => w).join('<br>')}
        </div>
      `;
    }
    
    const duplicates = Object.entries(data.processes.duplicates)
      .filter(([name, count]) => count > 1)
      .map(([name, count]) => `${name}: ${count}`)
      .join(', ');
    
    telemetryDiv.innerHTML = `
      ${warningsHtml}
      <div class="stats">
        <div class="stat-item">
          <div class="stat-value">${data.processes.locks.length}</div>
          <div class="stat-label">Process Locks</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${data.connections.totalConnections}</div>
          <div class="stat-label">WebSocket Connections</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${data.a2a ? data.a2a.peers_count : 0}</div>
          <div class="stat-label">A2A Peers</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${Math.round(data.server.memory.rss / 1024 / 1024)}MB</div>
          <div class="stat-label">Memory Usage</div>
        </div>
      </div>
      <div style="margin-top: 15px;">
        <div style="display: flex; gap: 15px; margin-bottom: 10px; flex-wrap: wrap;">
          <span>Medusa: <span class="status ${data.services.medusaProtocol === 'running' ? 'active' : 'inactive'}">${data.services.medusaProtocol}</span> </span>
          <span>A2A Node: <span class="status ${data.services.a2aNode === 'bridge-active' ? 'active' : 'inactive'}">${data.services.a2aNode}</span> </span>
          <span>ZombieDust: <span class="status ${data.processes.zombieDust ? 'active' : 'warning'}">${data.processes.zombieDust ? 'ZOMBIFIED' : 'sleeping'}</span> </span>
        </div>
        ${duplicates ? `<div style="color: var(--danger); font-size: 0.9em; margin-bottom: 5px;">Multiple instances: ${duplicates}</div>` : ''}
        ${data.processes.conflicts.length > 0 ? `<div style="color: var(--warning); font-size: 0.9em;">Conflicts: ${data.processes.conflicts.length}</div>` : ''}
        
        <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
          <div style="color: var(--text-muted); font-size: 0.9em; text-align: center; padding: 20px;">
            🤖 <strong>A2A Ledger Active</strong><br>
            Autonomous coordination powered by Python A2A Node mesh.
          </div>
        </div>
      </div>

    `;
  } catch (error) {
    telemetryDiv.innerHTML = `<p style="color: var(--danger);">Error loading telemetry: ${error.message}</p>`;
  }
}

// Message management
let autoScroll = true;
let messageCount = 0;

function getWorkspaceClass(workspaceName) {
  if (!workspaceName) return 'other';
  const name = workspaceName.toLowerCase();
  if (name.includes('medusa')) return 'medusa';
  if (name.includes('tilt')) return 'tilt';
  return 'other';
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', { 
    hour12: false, 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit' 
  });
}

function addMessageToLog(message) {
  const messagesDiv = document.querySelector('#messages .message-log-content');
  const workspaceClass = message.type === 'broadcast' ? 'broadcast' : getWorkspaceClass(message.fromName || message.from);
  const messageType = message.type === 'broadcast' ? 'BROADCAST' : 'DIRECT';
  const target = message.type === 'broadcast' ? 'ALL' : (message.toName || message.to);
  
  const messageElement = document.createElement('div');
  messageElement.className = `message-item ${workspaceClass}`;
  
  const targetSpan = message.type !== 'broadcast' ? 
    `<span style="color: var(--text-muted);">→ ${target}</span>` : '';
  
  messageElement.innerHTML = `
    <div class="message-header">
      <span class="message-from ${workspaceClass}">${message.fromName || message.from}</span>
      <span style="display: flex; gap: 8px; align-items: center;">
        <span class="message-type">${messageType}</span>
        ${targetSpan}
        <span class="message-time">${formatTime(message.timestamp)}</span>
      </span>
    </div>
    <div class="message-content">${message.message}</div>
  `;
  
  messagesDiv.appendChild(messageElement);
  messageCount++;
  
  // Limit messages to last 100
  if (messageCount > 100) {
    messagesDiv.removeChild(messagesDiv.firstElementChild);
    messageCount--;
  }
  
  // Auto-scroll to bottom if enabled
  if (autoScroll) {
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }
}

async function loadMessages() {
  const messagesDiv = document.querySelector('#messages .message-log-content');
  try {
    // Get all recent messages from server
    const response = await fetch(PROTOCOL_URL + '/messages/recent');
    if (response.ok) {
      const data = await response.json();
      
      // Clear existing messages (except system message)
      const systemMessage = messagesDiv.querySelector('.message-item.other');
      messagesDiv.innerHTML = '';
      if (systemMessage) {
        messagesDiv.appendChild(systemMessage);
      }
      
      // Add all messages
      data.messages.forEach(addMessageToLog);
    }
  } catch (error) {
    console.error('Error loading messages:', error);
  }
}

function clearMessages() {
  const messagesDiv = document.querySelector('#messages .message-log-content');
  messagesDiv.innerHTML = `
    <div class="message-item other">
      <div class="message-header">
        <span class="message-from other">System</span>
        <span class="message-time">${formatTime(new Date())}</span>
      </div>
      <div class="message-content">Message log cleared</div>
    </div>
  `;
  messageCount = 1;
}

function toggleAutoScroll() {
  autoScroll = !autoScroll;
  const btn = document.getElementById('auto-scroll-btn');
  btn.textContent = `Auto-scroll: ${autoScroll ? 'ON' : 'OFF'}`;
  btn.style.background = autoScroll ? 'var(--primary)' : 'var(--text-muted)';
}

// Message sending functions
async function sendDirectMessage() {
  const from = document.getElementById('from-workspace').value;
  const to = document.getElementById('to-workspace').value;
  const message = document.getElementById('message-text').value;
  
  if (!from || !to || !message) {
    alert('Fill in all fields, mortal!');
    return;
  }
  
  try {
    const response = await fetch(PROTOCOL_URL + '/messages/direct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, message })
    });
    
    const data = await response.json();
    if (data.success) {
      alert(`Message sent! ${data.message}`);
      document.getElementById('message-text').value = '';
    } else {
      alert(`Error: ${data.message || data.error}`);
    }
  } catch (error) {
    alert(`Failed to send: ${error.message}`);
  }
}

async function sendBroadcast() {
  const from = document.getElementById('from-workspace').value;
  const message = document.getElementById('message-text').value;
  
  if (!from || !message) {
    alert('Need from and message for broadcast!');
    return;
  }
  
  try {
    const response = await fetch(PROTOCOL_URL + '/messages/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, message })
    });
    
    const data = await response.json();
    if (data.success) {
      alert(`Broadcast sent! ${data.message}`);
      document.getElementById('message-text').value = '';
    } else {
      alert(`Error: ${data.message || data.error}`);
    }
  } catch (error) {
    alert(`Failed to broadcast: ${error.message}`);
  }
}

// Workspace cleanup
async function cleanupWorkspaces() {
  if (!confirm('Remove duplicate workspace registrations? This will keep the most recent registration for each workspace name.')) {
    return;
  }
  
  try {
    const response = await fetch(PROTOCOL_URL + '/workspaces/cleanup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'remove-duplicates' })
    });
    
    const data = await response.json();
    if (data.success) {
      alert(data.message);
      loadWorkspaces(); // Refresh the workspace list
    } else {
      alert(`Error: ${data.message || data.error}`);
    }
  } catch (error) {
    alert(`Failed to cleanup: ${error.message}`);
  }
}



// Auto-refresh functionality
let autoRefreshInterval = null;
let isAutoRefreshEnabled = false;

function toggleAutoRefresh() {
  const button = document.getElementById('auto-refresh-btn');
  
  if (isAutoRefreshEnabled) {
    // Disable auto-refresh
    if (autoRefreshInterval) {
      clearInterval(autoRefreshInterval);
      autoRefreshInterval = null;
    }
    isAutoRefreshEnabled = false;
    button.textContent = 'Auto-refresh: OFF';
    button.style.background = 'var(--text-muted)';
  } else {
    // Enable auto-refresh
    autoRefreshInterval = setInterval(() => {
      loadWorkspaces();
      checkStatus();
    }, 5000); // Refresh every 5 seconds
    
    isAutoRefreshEnabled = true;
    button.textContent = 'Auto-refresh: ON';
    button.style.background = 'var(--success)';
  }
}

function formatTimeAgo(timestamp) {
  if (!timestamp) return 'never';
  
  const now = new Date();
  const time = new Date(timestamp);
  const diffMs = now - time;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  
  if (diffSec < 30) return 'now';
  if (diffSec < 60) return `${diffSec}s`;
  if (diffMin < 60) return `${diffMin}m`;
  if (diffHour < 24) return `${diffHour}h`;
  
  return time.toLocaleDateString();
}

// Auto-refresh with real-time message updates
let lastMessageCount = 0;

async function refreshMessages() {
  try {
    const response = await fetch(PROTOCOL_URL + '/messages/recent');
    if (response.ok) {
      const data = await response.json();
      
      // Only update if we have new messages
      if (data.count > lastMessageCount) {
        // Add only new messages to avoid duplicates
        const newMessages = data.messages.slice(lastMessageCount);
        newMessages.forEach(addMessageToLog);
        lastMessageCount = data.count;
      }
    }
  } catch (error) {
    console.error('Failed to refresh messages:', error);
  }
}

// Set up auto-refresh with smooth, less intrusive polling
setInterval(() => {
  checkStatus();
  loadWorkspaces();
  loadTelemetry();
  refreshMessages();
  loadAuctions();
}, 5000); // Refresh every 5 seconds - smooth updates without visual disruption

// Fast refresh for MCP live timer (every 1 second)
setInterval(() => {
  // Only refresh telemetry for live MCP timer updates
  loadTelemetry();
}, 1000); // Update MCP timer every second for live counting



// MCP Server Control Functions
async function restartMCPServer() {
  if (!confirm('Restart the Cursor MCP server? This will temporarily interrupt AI tool access.')) {
    return;
  }
  
  try {
    // Show loading state
    const button = document.querySelector('button[onclick="restartMCPServer()"]');
    button.disabled = true;
    button.textContent = '🔄 Restarting...';
    
    // Call our medusa restart command via subprocess
    const response = await fetch(PROTOCOL_URL + '/mcp/restart-cursor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    const data = await response.json();
    
    if (data.success) {
      alert(data.message || 'MCP server restart initiated successfully!');
      // Refresh telemetry to show updated status
      setTimeout(() => {
        loadTelemetry();
        button.disabled = false;
        button.textContent = '🔄 Restart MCP';
      }, 3000);
    } else {
      alert(`Error: ${data.message || data.error}`);
      button.disabled = false;
      button.textContent = '🔄 Restart MCP';
    }
  } catch (error) {
    alert(`Failed to restart MCP server: ${error.message}`);
    const button = document.querySelector('button[onclick="restartMCPServer()"]');
    button.disabled = false;
    button.textContent = '🔄 Restart MCP';
  }
}

async function killMCPServer() {
  if (!confirm('Kill the Cursor MCP server? This will disable AI tool access until restarted.')) {
    return;
  }
  
  try {
    const response = await fetch(PROTOCOL_URL + '/mcp/kill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    const data = await response.json();
    
    if (data.success) {
      alert(data.message || 'MCP server killed successfully');
      loadTelemetry(); // Refresh to show updated status
    } else {
      alert(`Error: ${data.message || data.error}`);
    }
  } catch (error) {
    alert(`Failed to kill MCP server: ${error.message}`);
  }
}

async function killOrphanedMCP() {
  if (!confirm('Kill orphaned MCP processes? Use this when you\'ve disabled MCP in Cursor but processes are still running.')) {
    return;
  }
  
  try {
    const response = await fetch(PROTOCOL_URL + '/mcp/kill-orphaned', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    const data = await response.json();
    
    if (data.success) {
      alert(`🧹 Cleanup complete!\n\n${data.message}\nKilled processes: ${data.killedCount || 0}`);
      loadTelemetry(); // Refresh to show updated status
    } else {
      alert(`Error: ${data.message || data.error}`);
    }
  } catch (error) {
    alert(`Failed to kill orphaned processes: ${error.message}`);
  }
}

async function healthCheckMCP() {
  try {
    const response = await fetch(PROTOCOL_URL + '/mcp/health', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    
    const data = await response.json();
    
    if (data.healthy) {
      alert(`✅ MCP Server is healthy!\n\nStatus: ${data.status}\nPID: ${data.pid}\nMemory: ${data.memory}MB\nUptime: ${data.uptime || 'Unknown'}`);
    } else {
      alert(`❌ MCP Server is unhealthy!\n\nIssue: ${data.error || 'Unknown'}\n\nRecommendation: Try restarting the MCP server.`);
    }
    
    loadTelemetry(); // Refresh telemetry
  } catch (error) {
    alert(`❌ Health check failed: ${error.message}\n\nThe MCP server may be completely offline.`);
  }
}

// Auction & Domain functions
async function loadAuctions() {
  const list = document.getElementById('auctions');
  try {
    const response = await fetch(PROTOCOL_URL + '/auctions');
    const data = await response.json();
    
    const activeTasks = data.tasks.filter(t => t.status === 'pending' || t.status === 'negotiating');
    
    if (activeTasks.length === 0) {
      list.innerHTML = '<p style="color: var(--text-muted);">No active auctions in the mesh.</p>';
      return;
    }
    
    list.innerHTML = activeTasks.map(task => {
      const bids = task.bid_metadata?.bids || [];
      return `
        <li class="workspace-item" style="flex-direction: column; align-items: stretch;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <strong style="color: var(--primary);">${task.task_type.toUpperCase()}</strong>
            <span class="status ${task.status === 'negotiating' ? 'warning' : 'active'}">${task.status}</span>
          </div>
          <div style="font-size: 0.9em; margin-bottom: 10px;">${task.description}</div>
          <div style="font-family: monospace; font-size: 0.8em; color: var(--text-muted); margin-bottom: 8px;">ID: ${task.id}</div>
          
          <div style="background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px;">
            <div style="font-size: 0.8em; font-weight: bold; margin-bottom: 5px; color: var(--text-muted);">CURRENT BIDS (${bids.length})</div>
            ${bids.length > 0 ? `
              <ul style="list-style: none; padding: 0; margin: 0; font-size: 0.85em;">
                ${bids.sort((a, b) => a.bid_value - b.bid_value).map(bid => `
                  <li style="display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <span>${bid.bidder_id.split('-')[0]}</span>
                    <span style="font-weight: bold; color: var(--success);">${bid.bid_value.toFixed(2)}</span>
                  </li>
                `).join('')}
              </ul>
            ` : '<div style="font-size: 0.8em; color: var(--text-muted);">No bids yet.</div>'}
          </div>
          
          <div style="margin-top: 10px; display: flex; gap: 8px;">
            <button onclick="document.getElementById('auction-task-id').value='${task.id}'" style="padding: 4px 8px; font-size: 0.8em; background: rgba(255,255,255,0.1);">Select ID</button>
            <button onclick="resolveAuction('${task.id}')" style="padding: 4px 8px; font-size: 0.8em; background: var(--success); color: var(--bg);">Resolve</button>
          </div>
        </li>
      `;
    }).join('');
  } catch (error) {
    list.innerHTML = `<p style="color: var(--danger);">Error: ${error.message}</p>`;
  }
}

async function placeBid() {
  const taskId = document.getElementById('auction-task-id').value;
  const value = parseFloat(document.getElementById('bid-value').value);
  const bidderId = 'DASHBOARD-MANUAL';
  
  if (!taskId || isNaN(value)) {
    alert('Task ID and numeric bid value required!');
    return;
  }
  
  try {
    const response = await fetch(PROTOCOL_URL + '/auctions/bid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_id: taskId,
        bidder_id: bidderId,
        bid_value: value,
        confidence: 1.0,
        metadata: { manual: true }
      })
    });
    
    const result = await response.json();
    alert(result.message || 'Bid placed!');
    loadAuctions();
  } catch (error) {
    alert(`Failed to place bid: ${error.message}`);
  }
}

async function resolveAuction(taskId) {
  if (!confirm(`Resolve auction for task ${taskId}?`)) return;

  try {
    const response = await fetch(PROTOCOL_URL + `/auctions/${taskId}/resolve`, {
      method: 'POST'
    });

    const result = await response.json();
    alert(result.status === 'auction_resolved' ? `Auction resolved! Winner: ${result.winner}` : `Failed: ${result.message || 'Unknown error'}`);
    loadAuctions();
  } catch (error) {
    alert(`Failed to resolve: ${error.message}`);
  }
}

async function loadTaskTree() {
  const container = document.getElementById('task-tree');
  try {
    const response = await fetch(PROTOCOL_URL + '/a2a/tasks/tree');
    const data = await response.json();

    if (!data.tree || data.tree.length === 0) {
      container.innerHTML = '<p style="color: var(--text-muted);">No tasks in the swarm ledger.</p>';
      return;
    }

    container.innerHTML = renderTaskTree(data.tree);
  } catch (error) {
    container.innerHTML = `<p style="color: var(--danger);">Error: ${error.message}</p>`;
  }
}

async function approveTask(taskId) {
  if (!confirm(`Authorize execution of task ${taskId.substring(0,8)}...?`)) return;
  
  try {
    const response = await fetch(PROTOCOL_URL + `/tasks/${taskId}/approve`, { method: 'POST' });
    const result = await response.json();
    if (result.status === 'approved') {
      alert('Task approved! Swarm is engaging.');
      loadTaskTree();
    } else {
      alert(`Approval failed: ${result.message}`);
    }
  } catch (error) {
    alert(`Error: ${error.message}`);
  }
}

async function rejectTask(taskId) {
  if (!confirm(`REJECT task ${taskId.substring(0,8)}...?`)) return;
  
  try {
    const response = await fetch(PROTOCOL_URL + `/tasks/${taskId}/reject`, { method: 'POST' });
    const result = await response.json();
    if (result.status === 'rejected') {
      alert('Task rejected. Disaster averted.');
      loadTaskTree();
    } else {
      alert(`Rejection failed: ${result.message}`);
    }
  } catch (error) {
    alert(`Error: ${error.message}`);
  }
}

function renderTaskTree(tasks, level = 0) {
  return tasks.map(task => {
    const indent = level * 20;
    const isPendingApproval = task.status === 'pending_approval';
    
    const statusMap = {
      'completed': { label: 'SUCCESS', color: 'var(--success)' },
      'failed': { label: 'FAILED', color: 'var(--danger)' },
      'running': { label: 'RUNNING', color: 'var(--warning)' },
      'pending_approval': { label: 'WAITING FOR YOU', color: '#ff00ff' },
      'rejected': { label: 'REJECTED', color: 'var(--text-muted)' },
      'pending': { label: 'PENDING', color: 'var(--primary)' },
      'waiting': { label: 'DECOMPOSING', color: '#4A90E2' }
    };

    const statusInfo = statusMap[task.status] || { label: task.status.toUpperCase(), color: 'var(--text)' };
    const nodeInfo = task.claimed_by || task.assigned_to || 'unassigned';
    
    let governanceNote = '';
    if (isPendingApproval && task.execution_metadata?.governance) {
      governanceNote = `<div style="color: #ff00ff; font-size: 0.8em; margin: 4px 0; font-style: italic;">⚠ ${task.execution_metadata.governance.reason}</div>`;
    }

    let retryNote = '';
    if (task.retry_count > 0) {
        retryNote = `<span style="color: var(--warning); font-size: 0.8em; margin-left: 8px;">(Retry ${task.retry_count}/${task.max_retries})</span>`;
    }

    let html = `
      <div style="margin-left: ${indent}px; border-left: 1px solid rgba(255,255,255,0.1); padding-left: 10px; margin-bottom: 12px; position: relative;">
        <div style="display: flex; gap: 8px; align-items: center;">
          <span style="color: ${statusInfo.color}; font-weight: bold; font-size: 0.75em; letter-spacing: 0.05em;">[${statusInfo.label}]</span>
          <strong style="color: var(--text);">${task.task_type}</strong>
          <span style="font-size: 0.8em; color: var(--text-muted);">@ ${nodeInfo.split('-')[0]}</span>
          ${retryNote}
        </div>
        <div style="font-size: 0.9em; margin: 4px 0; color: #ddd;">${task.description}</div>
        ${governanceNote}
        <div style="font-size: 0.7em; color: var(--text-muted);">ID: ${task.id.substring(0, 8)}...</div>
        
        ${isPendingApproval ? `
          <div style="margin-top: 8px; display: flex; gap: 8px;">
            <button onclick="approveTask('${task.id}')" style="padding: 2px 10px; font-size: 0.75em; background: #ff00ff; color: white; border: none; border-radius: 3px; cursor: pointer;">Approve</button>
            <button onclick="rejectTask('${task.id}')" style="padding: 2px 10px; font-size: 0.75em; background: rgba(255,255,255,0.1); color: white; border: none; border-radius: 3px; cursor: pointer;">Reject</button>
          </div>
        ` : ''}
      </div>
    `;

    if (task.children && task.children.length > 0) {
      html += renderTaskTree(task.children, level + 1);
    }

    return html;
  }).join('');
}

/**
 * Loads peer data from the protocol mesh and updates the dashboard.
 * Calculates global swarm metrics and individual peer performance analytics.
 * Visualizes shared strategies, skills, and success/latency metrics.
 */
async function loadPeers() {
  const container = document.getElementById('mesh-peers');
  const globalSuccessEl = document.getElementById('global-success-rate');
  const globalLatencyEl = document.getElementById('global-avg-latency');
  const activeStrategiesEl = document.getElementById('active-strategies');

  try {
    const response = await fetch(PROTOCOL_URL + '/mesh/peers');
    const data = await response.json();

    if (!data.peers || data.peers.length === 0) {
      container.innerHTML = '<p style="color: var(--text-muted);">No peers discovered yet.</p>';
      return;
    }

    let totalTasks = 0;
    let totalSuccess = 0;
    let totalLatency = 0.0;
    let peerCountWithPerf = 0;
    const strategies = new Set();

    container.innerHTML = data.peers.map(peer => {
      const perf = peer.performance || {};
      const stats = peer.strategies || {};
      const skills = stats.skills || (peer.metadata?.skills ? peer.metadata.skills.split(',') : ['generic']);
      
      // Calculate individual metrics
      const pTasks = perf.total_tasks || 0;
      const pSuccess = perf.success_count || 0;
      const pLatency = perf.total_latency || 0;
      
      const successRate = pTasks > 0 ? (pSuccess / pTasks * 100).toFixed(1) : '100';
      const avgLatency = pTasks > 0 ? (pLatency / pTasks).toFixed(2) : '0.00';
      
      // Aggregate for global summary
      if (pTasks > 0) {
        totalTasks += pTasks;
        totalSuccess += pSuccess;
        totalLatency += (pLatency / pTasks);
        peerCountWithPerf++;
      }
      if (stats.strategy) strategies.add(stats.strategy);

      // Performance color coding
      const rateColor = parseFloat(successRate) >= 95 ? 'var(--success)' : (parseFloat(successRate) >= 80 ? 'var(--warning)' : 'var(--danger)');
      const latencyColor = parseFloat(avgLatency) <= 1.0 ? 'var(--success)' : (parseFloat(avgLatency) <= 3.0 ? 'var(--warning)' : 'var(--danger)');

      return `
        <div class="card" style="margin: 0; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08);">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
            <div>
              <strong style="color: var(--primary); font-size: 1.1em;">${peer.id.split('-')[0]}</strong>
              <div style="font-size: 0.7em; color: var(--text-muted); font-family: monospace;">${peer.id}</div>
            </div>
            <span class="status active" style="margin: 0;">${peer.status}</span>
          </div>

          <div class="stats" style="margin-bottom: 15px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 10px;">
            <div class="stat-item" style="flex: 1;">
              <div class="stat-value" style="font-size: 1.2em; color: ${rateColor}">${successRate}%</div>
              <div class="stat-label" style="font-size: 0.7em;">Success Rate</div>
            </div>
            <div class="stat-item" style="flex: 1;">
              <div class="stat-value" style="font-size: 1.2em; color: ${latencyColor}">${avgLatency}s</div>
              <div class="stat-label" style="font-size: 0.7em;">Avg Latency</div>
            </div>
            <div class="stat-item" style="flex: 1;">
              <div class="stat-value" style="font-size: 1.2em;">${pTasks}</div>
              <div class="stat-label" style="font-size: 0.7em;">Tasks</div>
            </div>
          </div>

          <div style="font-size: 0.85em; margin-bottom: 8px;">
            <strong style="color: var(--text-muted);">Strategy:</strong> 
            <span style="color: var(--primary);">${stats.strategy || 'default'}</span>
          </div>

          <div style="display: flex; flex-wrap: wrap; gap: 5px;">
            ${skills.map(skill => `
              <span style="background: rgba(145, 70, 255, 0.15); color: var(--primary); padding: 2px 8px; border-radius: 12px; font-size: 0.75em; border: 1px solid rgba(145, 70, 255, 0.3);">
                ${skill.trim()}
              </span>
            `).join('')}
          </div>
          
          <div style="font-size: 0.75em; color: var(--text-muted); margin-top: 12px;">
            Last Seen: ${formatTimeAgo(peer.last_seen)}
          </div>
        </div>
      `;
    }).join('');

    // Update Global Summary
    const globalSuccessRate = totalTasks > 0 ? (totalSuccess / totalTasks * 100).toFixed(1) : '100';
    const globalAvgLatency = peerCountWithPerf > 0 ? (totalLatency / peerCountWithPerf).toFixed(2) : '0.00';
    
    globalSuccessEl.textContent = `${globalSuccessRate}%`;
    globalSuccessEl.style.color = parseFloat(globalSuccessRate) >= 95 ? 'var(--success)' : 'var(--warning)';
    
    globalLatencyEl.textContent = `${globalAvgLatency}s`;
    globalLatencyEl.style.color = parseFloat(globalAvgLatency) <= 1.0 ? 'var(--success)' : 'var(--warning)';
    
    activeStrategiesEl.textContent = Array.from(strategies).join(', ') || 'Standard Collective Intelligence';

  } catch (error) {
    container.innerHTML = `<p style="color: var(--danger);">Error: ${error.message}</p>`;
  }
}

let isAuctionPolling = false;
let auctionInterval = null;

function toggleAuctionPolling() {
  const btn = document.getElementById('auction-polling-btn');
  isAuctionPolling = !isAuctionPolling;

  if (isAuctionPolling) {
    btn.textContent = 'Auto-poll: ON';
    btn.style.background = 'var(--success)';
    auctionInterval = setInterval(loadAuctions, 3000);
  } else {
    btn.textContent = 'Auto-poll: OFF';
    btn.style.background = 'var(--text-muted)';
    if (auctionInterval) clearInterval(auctionInterval);
  }
}

// Initial load
document.addEventListener('DOMContentLoaded', () => {
  console.log('Medusa Dashboard JavaScript loaded and executing!');
  checkStatus();
  loadWorkspaces();
  loadTelemetry();
  loadMessages();
  loadAuctions();
  loadTaskTree();
  loadPeers();
});

// Set up auto-refresh
setInterval(() => {
  checkStatus();
  loadWorkspaces();
  loadTelemetry();
  refreshMessages();
  loadAuctions();
  loadTaskTree();
  loadPeers();
}, 5000);