/**
 * SheetSync MCP Server Entry Point
 *
 * This script provides:
 * 1. A web interface for the SheetSync MCP system
 * 2. Automatic management of the Python MCP server
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const MCPClient = require('./mcp-client.js');

// Configuration
const PORT = process.env.PORT || 8181;
const MCP_SERVER_PORT = 3009;
const MCP_SERVER_PATH = path.join(__dirname, 'mcp-server', 'mcp_server.py');

let mcpServerProcess = null;

// Start the MCP server if not already running
async function startMCPServer() {
  console.log('Starting MCP server...');

  // Check if MCP server is already running
  try {
    const health = await MCPClient.checkHealth();
    console.log('MCP server is already running:', health);
    return true;
  } catch (error) {
    console.log('MCP server not detected, starting...');
  }

  try {
    // Determine the Python executable (python3 or python)
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

    // Check if venv exists and use it
    const venvPython = path.join(__dirname, 'mcp-server', 'venv', 'bin', 'python');
    const pythonPath = fs.existsSync(venvPython) ? venvPython : pythonCmd;

    // Start the MCP server process
    mcpServerProcess = spawn(pythonPath, [MCP_SERVER_PATH], {
      cwd: path.join(__dirname, 'mcp-server'),
      stdio: 'inherit',
    });

    // Handle process events
    mcpServerProcess.on('error', (err) => {
      console.error('Failed to start MCP server:', err);
    });

    mcpServerProcess.on('exit', (code, signal) => {
      console.log(`MCP server exited with code ${code} and signal ${signal}`);
      mcpServerProcess = null;
    });

    // Wait for server to start
    console.log('Waiting for MCP server to start...');
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Verify server is running
    try {
      const health = await MCPClient.checkHealth();
      console.log('MCP server started successfully:', health);
      return true;
    } catch (error) {
      console.error('MCP server failed to start:', error.message);
      return false;
    }
  } catch (error) {
    console.error('Error starting MCP server:', error);
    return false;
  }
}

// Create a simple HTTP server
const server = http.createServer((req, res) => {
  // Handle static files
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>SheetSync MCP</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
          h1 { color: #4285f4; }
          .card { border: 1px solid #ddd; border-radius: 4px; padding: 16px; margin-bottom: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          button { background-color: #4285f4; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; }
          pre { background-color: #f5f5f5; padding: 10px; border-radius: 4px; overflow: auto; }
        </style>
      </head>
      <body>
        <h1>SheetSync MCP</h1>

        <div class="card">
          <h2>Server Status</h2>
          <div id="status">Checking...</div>
          <button onclick="checkStatus()">Check Status</button>
        </div>

        <div class="card">
          <h2>Test MCP Server</h2>
          <button onclick="runTest()">Run Test</button>
          <pre id="test-result">Results will appear here...</pre>
        </div>

        <script>
          // Check server status
          async function checkStatus() {
            const statusDiv = document.getElementById('status');
            statusDiv.textContent = 'Checking...';

            try {
              const response = await fetch('/api/status');
              const data = await response.json();
              statusDiv.textContent = 'Status: ' + data.status;
            } catch (error) {
              statusDiv.textContent = 'Error: ' + error.message;
            }
          }

          // Run test
          async function runTest() {
            const resultDiv = document.getElementById('test-result');
            resultDiv.textContent = 'Running test...';

            try {
              const response = await fetch('/api/test');
              const data = await response.json();
              resultDiv.textContent = JSON.stringify(data, null, 2);
            } catch (error) {
              resultDiv.textContent = 'Error: ' + error.message;
            }
          }

          // Check status on load
          checkStatus();
        </script>
      </body>
      </html>
    `);
  }
  // API endpoints
  else if (req.url === '/api/status') {
    MCPClient.checkHealth()
      .then((health) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'ok',
            mcp: health,
            server: 'running',
          })
        );
      })
      .catch((error) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'error',
            message: error.message,
            server: 'running',
            mcp: 'not running',
          })
        );
      });
  } else if (req.url === '/api/test') {
    // First check if we can get health status
    MCPClient.checkHealth()
      .then(async (health) => {
        try {
          // Create a test spreadsheet
          const createResult = await MCPClient.Sheets.create(
            'SheetSync MCP Test ' + new Date().toISOString()
          );

          // Write to it
          const writeResult = await MCPClient.Sheets.write(
            createResult.spreadsheetId,
            'Sheet1!A1:B2',
            [
              ['SheetSync MCP Test', new Date().toISOString()],
              ['Status', 'Success'],
            ]
          );

          // Read from it
          const readResult = await MCPClient.Sheets.read(
            createResult.spreadsheetId,
            'Sheet1!A1:B2'
          );

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              status: 'success',
              health,
              createResult,
              writeResult,
              readResult,
            })
          );
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              status: 'error',
              message: error.message,
            })
          );
        }
      })
      .catch((error) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'error',
            message: 'MCP server is not running: ' + error.message,
          })
        );
      });
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

// Start the web server
server.listen(PORT, async () => {
  console.log(`SheetSync MCP server running at http://localhost:${PORT}`);

  // Start the MCP server if it's not already running
  const mcpStarted = await startMCPServer();
  if (mcpStarted) {
    console.log(`MCP server running at http://localhost:${MCP_SERVER_PORT}`);
  } else {
    console.error('Failed to start MCP server. Try starting it manually:');
    console.error(`  cd mcp-server && source venv/bin/activate && python mcp_server.py`);
  }

  console.log('\nTo check if everything is working:');
  console.log(`1. Open http://localhost:${PORT} in your browser`);
  console.log('2. Click "Check Status" to verify MCP server connection');
  console.log('3. Click "Run Test" to test Google Sheets integration');
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');

  if (mcpServerProcess) {
    console.log('Stopping MCP server...');
    mcpServerProcess.kill();
  }

  server.close(() => {
    console.log('Server stopped');
    process.exit(0);
  });
});
