# SheetSync MCP Quick Start Guide

## Getting Started

SheetSync MCP is a Google Sheets extension with a local development environment. This guide will help you quickly get up and running.

## Setup

1. Make sure you have Node.js installed
2. Clone the repository
3. Start the servers:

```bash
./restart-mcp.sh
```

## Verifying Installation

After starting the servers, you can verify everything is working:

1. Open http://localhost:8181 in your browser
2. Click "Check Status" to verify the MCP server connection
3. Click "Run Test" to test Google Sheets integration

## Key Commands

| Command | Description |
|---------|-------------|
| `./restart-mcp.sh` | Start all servers |
| `./restart-mcp.sh stop` | Stop all servers |
| `node test-mock-script.js` | Run test script |

## Common Workflows

### Creating and Manipulating a Spreadsheet

```javascript
// Example script (save as create-spreadsheet.js)
const http = require('http');

// Helper function to make HTTP requests
function makeRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    
    const req = http.request(options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        try {
          const parsedData = JSON.parse(responseData);
          resolve({
            status: res.statusCode,
            data: parsedData
          });
        } catch (error) {
          reject(new Error(`Error parsing response: ${error.message}`));
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    if (data) {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
}

async function createSpreadsheet() {
  try {
    // Create a new spreadsheet
    const createResponse = await makeRequest('POST', '/sheets/create', {
      title: 'Test Sheet ' + new Date().toISOString()
    });
    
    const spreadsheetId = createResponse.data.spreadsheetId;
    console.log(`Created spreadsheet with ID: ${spreadsheetId}`);
    console.log(`URL: https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`);
    
    // Write to the sheet
    const writeResponse = await makeRequest('POST', '/sheets/write', {
      spreadsheetId,
      range: 'Sheet1!A1:B2',
      values: [['Header 1', 'Header 2'], ['Value 1', 'Value 2']]
    });
    
    console.log(`Updated ${writeResponse.data.updated} cells`);
  } catch (error) {
    console.error('Error:', error);
  }
}

// Run the function
createSpreadsheet();
```

Run with:
```bash
node create-spreadsheet.js
```

### Sharing a Spreadsheet

```javascript
// Share with a user (replace with actual spreadsheet ID)
const shareResponse = await makeRequest('POST', '/sheets/permissions', {
  spreadsheetId: 'YOUR_SPREADSHEET_ID',
  email: 'user@example.com',
  role: 'writer'
});
```

## API Endpoints Reference

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Check if server is running |
| `/sheets/read` | POST | Read from Google Sheets |
| `/sheets/write` | POST | Write to Google Sheets |
| `/sheets/create` | POST | Create a new spreadsheet |
| `/sheets/permissions` | POST | Share a spreadsheet |

## Architecture Overview

SheetSync MCP consists of:

1. **Simple Local Server** (Port 3000): Handles Google Sheets interactions
2. **Web UI** (Port 8181): Provides a user interface

For full architecture details, see [ONDECKV9-ARCHITECTURE.md](ONDECKV9-ARCHITECTURE.md). 