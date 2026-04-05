#!/usr/bin/env node

/**
 * SIMPLE MESSAGE SERVER - No fluff, just works!
 * File-based message passing between workspaces
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3008; // Different port to avoid conflicts
const MESSAGES_DIR = path.join(__dirname, 'pillow-talk');

// Ensure messages directory exists
if (!fs.existsSync(MESSAGES_DIR)) {
  fs.mkdirSync(MESSAGES_DIR, { recursive: true });
}

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  
  // Health check
  if (url.pathname === '/health' && req.method === 'GET') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'simple and working', port: PORT }));
    return;
  }

  // Send message - writes to file
  if (url.pathname === '/send' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const message = JSON.parse(body);
        const timestamp = new Date().toISOString();
        const messageId = `msg-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        
        const messageData = {
          id: messageId,
          timestamp,
          from: message.from || 'unknown',
          to: message.to || 'tilt',
          message: message.message,
          source: 'simple-mcp'
        };

        // Write to target workspace file
        const targetFile = path.join(MESSAGES_DIR, `${message.to || 'tilt'}-inbox.json`);
        
        // Append message to file
        let messages = [];
        if (fs.existsSync(targetFile)) {
          try {
            const existing = fs.readFileSync(targetFile, 'utf8');
            messages = JSON.parse(existing);
          } catch (e) {
            messages = [];
          }
        }
        
        messages.push(messageData);
        fs.writeFileSync(targetFile, JSON.stringify(messages, null, 2));
        
        console.log(`📨 Message sent: ${message.from} → ${message.to}: ${message.message}`);
        
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ 
          success: true, 
          messageId,
          file: targetFile 
        }));
        
      } catch (error) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: error.message }));
      }
    });
    return;
  }

  // Get messages - reads from file
  if (url.pathname === '/messages' && req.method === 'GET') {
    const workspace = url.searchParams.get('workspace') || 'tilt';
    const messageFile = path.join(MESSAGES_DIR, `${workspace}-inbox.json`);
    
    try {
      if (fs.existsSync(messageFile)) {
        const messages = JSON.parse(fs.readFileSync(messageFile, 'utf8'));
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ messages, count: messages.length }));
      } else {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ messages: [], count: 0 }));
      }
    } catch (error) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // Clear messages - empties file
  if (url.pathname === '/clear' && req.method === 'POST') {
    const workspace = url.searchParams.get('workspace') || 'tilt';
    const messageFile = path.join(MESSAGES_DIR, `${workspace}-inbox.json`);
    
    try {
      fs.writeFileSync(messageFile, JSON.stringify([], null, 2));
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: true, cleared: workspace }));
    } catch (error) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // 404
  res.statusCode = 404;
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`🚀 Simple Message Server running on port ${PORT}`);
  console.log(`📁 Messages stored in: ${MESSAGES_DIR}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
});

// Handle shutdown gracefully
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down simple message server...');
  server.close(() => {
    process.exit(0);
  });
}); 