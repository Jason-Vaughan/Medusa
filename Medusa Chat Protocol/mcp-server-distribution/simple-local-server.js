/**
 * Simple Local Server for SheetSync MCP
 * Provides a local testing environment that doesn't require Apps Script integration
 */

const http = require('http');
const { google } = require('googleapis');
const fs = require('fs');
const url = require('url');

// Configuration
const PORT = 3000;
const SERVICE_ACCOUNT_FILE = './mcp-server/service-account.json';
const SHEETS_CACHE = {}; // Simple in-memory cache for spreadsheet data

// Get Google credentials
async function getCredentials() {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: SERVICE_ACCOUNT_FILE,
      scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive']
    });
    return await auth.getClient();
  } catch (error) {
    console.error('Error getting credentials:', error);
    return null;
  }
}

// Helper to read request body
function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const bodyParts = [];
    req.on('data', (chunk) => {
      bodyParts.push(chunk);
    });
    req.on('end', () => {
      try {
        const body = Buffer.concat(bodyParts).toString();
        const data = body ? JSON.parse(body) : {};
        resolve(data);
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

// Create HTTP server
const server = http.createServer(async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle OPTIONS requests for CORS
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  
  // Parse URL
  const parsedUrl = url.parse(req.url, true);
  const path = parsedUrl.pathname;
  
  // Health check endpoint
  if (path === '/health' && req.method === 'GET') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      status: 'ok',
      service_account: fs.existsSync(SERVICE_ACCOUNT_FILE),
      version: '9.0.0',
      name: 'SheetSync MCP Simple Local Server'
    }));
    return;
  }
  
  // Handle POST requests
  if (req.method === 'POST') {
    try {
      const data = await readRequestBody(req);
      
      // Google Sheets endpoints
      if (path === '/sheets/read') {
        const { spreadsheetId, range } = data;
        
        if (!spreadsheetId || !range) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Missing required parameters' }));
          return;
        }
        
        try {
          const auth = await getCredentials();
          if (!auth) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Failed to initialize credentials' }));
            return;
          }
          
          const sheets = google.sheets({ version: 'v4', auth });
          const result = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range
          });
          
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ data: result.data.values || [] }));
        } catch (error) {
          console.error('Error reading sheets:', error);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }
      
      if (path === '/sheets/write') {
        const { spreadsheetId, range, values } = data;
        
        if (!spreadsheetId || !range || !values) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Missing required parameters' }));
          return;
        }
        
        try {
          const auth = await getCredentials();
          if (!auth) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Failed to initialize credentials' }));
            return;
          }
          
          const sheets = google.sheets({ version: 'v4', auth });
          const result = await sheets.spreadsheets.values.update({
            spreadsheetId,
            range,
            valueInputOption: 'USER_ENTERED',
            resource: { values }
          });
          
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ updated: result.data.updatedCells }));
        } catch (error) {
          console.error('Error writing to sheets:', error);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }
      
      if (path === '/sheets/create') {
        const { title } = data;
        
        if (!title) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Missing title parameter' }));
          return;
        }
        
        try {
          const auth = await getCredentials();
          if (!auth) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Failed to initialize credentials' }));
            return;
          }
          
          const sheets = google.sheets({ version: 'v4', auth });
          const result = await sheets.spreadsheets.create({
            resource: {
              properties: { title }
            },
            fields: 'spreadsheetId'
          });
          
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ spreadsheetId: result.data.spreadsheetId }));
        } catch (error) {
          console.error('Error creating spreadsheet:', error);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }
      
      // New endpoint for managing spreadsheet permissions
      if (path === '/sheets/permissions') {
        const { spreadsheetId, email, role = 'writer', type = 'user' } = data;
        
        if (!spreadsheetId || !email) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Missing required parameters (spreadsheetId, email)' }));
          return;
        }
        
        try {
          const auth = await getCredentials();
          if (!auth) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Failed to initialize credentials' }));
            return;
          }
          
          const drive = google.drive({ version: 'v3', auth });
          const result = await drive.permissions.create({
            fileId: spreadsheetId,
            requestBody: {
              type,
              role,
              emailAddress: email
            }
          });
          
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ 
            success: true,
            permissionId: result.data.id,
            message: `Successfully shared with ${email}`
          }));
        } catch (error) {
          console.error('Error setting spreadsheet permissions:', error);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }
      
      // Mock Apps Script endpoints
      if (path === '/script/run') {
        const { function: functionName, parameters = [] } = data;
        
        console.log(`Mock executing function: ${functionName} with parameters:`, parameters);
        
        // Mock responses for common functions
        if (functionName === 'testFunction') {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            success: true,
            result: {
              status: "success",
              message: "SheetSync MCP function executed successfully (mocked)",
              timestamp: new Date().toISOString(),
              version: "9.0.3-local"
            }
          }));
          return;
        }
        
        if (functionName === 'getFormattedData') {
          const [spreadsheetId, range] = parameters;
          
          // Use cached data if available, otherwise return mock data
          const cacheKey = `${spreadsheetId}-${range}`;
          const cachedData = SHEETS_CACHE[cacheKey];
          
          if (cachedData) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              success: true,
              result: {
                status: "success",
                data: cachedData
              }
            }));
            return;
          }
          
          // Return mock data if no cache
          const mockData = {
            values: [["Header 1", "Header 2"], ["Value 1", "Value 2"]],
            backgrounds: [["#ffffff", "#ffffff"], ["#ffffff", "#ffffff"]],
            fontColors: [["#000000", "#000000"], ["#000000", "#000000"]],
            fontWeights: [["normal", "bold"], ["normal", "normal"]]
          };
          
          // Store in cache
          SHEETS_CACHE[cacheKey] = mockData;
          
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            success: true,
            result: {
              status: "success",
              data: mockData
            }
          }));
          return;
        }
        
        // Default response for unknown functions
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          error: 'Unknown function',
          details: { message: `Function '${functionName}' is not implemented in the mock server` }
        }));
        return;
      }

      // --- Real Apps Script Proxy Endpoints ---
      // POST /script/run: Proxy to Google Apps Script Execution API
      if (path === '/script/run' && data.scriptId) {
        const { scriptId, function: functionName, parameters = [], devMode = false } = data;
        if (!scriptId || !functionName) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Missing required parameters (scriptId, function)' }));
          return;
        }
        try {
          const auth = new google.auth.GoogleAuth({
            keyFile: SERVICE_ACCOUNT_FILE,
            scopes: [
              'https://www.googleapis.com/auth/script.projects',
              'https://www.googleapis.com/auth/script.external_request',
              'https://www.googleapis.com/auth/script.deployments',
              'https://www.googleapis.com/auth/script.processes',
              'https://www.googleapis.com/auth/spreadsheets',
              'https://www.googleapis.com/auth/drive'
            ]
          });
          const client = await auth.getClient();
          const script = google.script({ version: 'v1', auth: client });
          const request = {
            function: functionName,
            parameters,
            devMode
          };
          const response = await script.scripts.run({ scriptId, requestBody: request });
          if (response.data.error) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: response.data.error }));
            return;
          }
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: true, result: response.data.response ? response.data.response.result : null }));
        } catch (error) {
          console.error('Error running Apps Script function:', error);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }

      // POST /script/logs: Fetch Apps Script execution logs
      if (path === '/script/logs' && data.scriptId) {
        const { scriptId, startTime, endTime, userId = 'me' } = data;
        try {
          const auth = new google.auth.GoogleAuth({
            keyFile: SERVICE_ACCOUNT_FILE,
            scopes: [
              'https://www.googleapis.com/auth/script.processes',
              'https://www.googleapis.com/auth/script.projects',
              'https://www.googleapis.com/auth/drive',
              'https://www.googleapis.com/auth/spreadsheets'
            ]
          });
          const client = await auth.getClient();
          const accessToken = await client.getAccessToken();
          const body = {
            scriptId,
            userId,
            pageSize: 20
          };
          if (startTime !== undefined && startTime !== null) body.startTime = startTime;
          if (endTime !== undefined && endTime !== null) body.endTime = endTime;

          // Use native https to POST to the Google API
          const https = require('https');
          const postData = JSON.stringify(body);
          const options = {
            hostname: 'script.googleapis.com',
            path: '/v1/processes:list',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${accessToken.token || accessToken}`,
              'Content-Length': Buffer.byteLength(postData)
            }
          };

          const apiReq = https.request(options, (apiRes) => {
            let responseData = '';
            apiRes.on('data', (chunk) => { responseData += chunk; });
            apiRes.on('end', () => {
              try {
                console.log('Raw Google API response:', responseData); // Debug output
                const parsed = JSON.parse(responseData);
                res.statusCode = apiRes.statusCode;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(parsed));
              } catch (err) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'Failed to parse Google API response', details: err.message, raw: responseData }));
              }
            });
          });
          apiReq.on('error', (err) => {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Google API request failed', details: err.message }));
          });
          apiReq.write(postData);
          apiReq.end();
          return;
        } catch (error) {
          console.error('Error fetching Apps Script logs:', error);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }
    } catch (error) {
      console.error('Error handling request:', error);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Internal server error' }));
      return;
    }
  }
  
  // Default response for unknown routes
  res.statusCode = 404;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: 'Not found' }));
});

// Start the server
server.listen(PORT, () => {
  console.log(`SheetSync MCP Simple Local Server running at http://localhost:${PORT}`);
  console.log('This server provides local testing without requiring Apps Script integration');
  console.log('\nEndpoints:');
  console.log('- GET  /health            - Health check');
  console.log('- POST /sheets/read       - Read from Google Sheets');
  console.log('- POST /sheets/write      - Write to Google Sheets');
  console.log('- POST /sheets/create     - Create a new Google Sheet');
  console.log('- POST /sheets/permissions - Share a Google Sheet with a user');
  console.log('- POST /script/run        - Mock Apps Script function execution');
}); 