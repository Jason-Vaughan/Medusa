# MCP Server API Reference
**Version:** 9.0.0  
**Date:** June 26, 2025

## Table of Contents

- [Authentication](#authentication)
- [Base URLs](#base-urls)
- [Health & Status](#health--status)
- [Google Sheets API](#google-sheets-api)
- [Apps Script API](#apps-script-api)
- [Client Library](#client-library)
- [Error Handling](#error-handling)
- [Examples](#examples)

## Authentication

The MCP server uses Google Service Account authentication. Place your service account JSON key file as `mcp-server/service-account.json`.

### Required Google API Scopes

```
https://www.googleapis.com/auth/spreadsheets
https://www.googleapis.com/auth/drive
https://www.googleapis.com/auth/script.projects
https://www.googleapis.com/auth/script.processes
https://www.googleapis.com/auth/script.external_request
```

## Base URLs

- **Local Development:** `http://localhost:3000`
- **Production MCP:** `http://localhost:3009`
- **Web Interface:** `http://localhost:8181`

## Health & Status

### GET /health

Check server health and configuration status.

**Response:**
```json
{
  "status": "ok",
  "service_account": true,
  "version": "9.0.0",
  "name": "OnDeck-V9 MCP Server"
}
```

## Google Sheets API

### POST /sheets/read

Read data from a Google Sheets spreadsheet.

**Request Body:**
```json
{
  "spreadsheetId": "1ABC123...",
  "range": "Sheet1!A1:C10"
}
```

**Response:**
```json
{
  "data": [
    ["Header 1", "Header 2", "Header 3"],
    ["Row 1 Col 1", "Row 1 Col 2", "Row 1 Col 3"],
    ["Row 2 Col 1", "Row 2 Col 2", "Row 2 Col 3"]
  ]
}
```

### POST /sheets/write

Write data to a Google Sheets spreadsheet.

**Request Body:**
```json
{
  "spreadsheetId": "1ABC123...",
  "range": "Sheet1!A1:C2",
  "values": [
    ["Header 1", "Header 2", "Header 3"],
    ["Value 1", "Value 2", "Value 3"]
  ]
}
```

**Response:**
```json
{
  "updated": 6
}
```

### POST /sheets/create

Create a new Google Sheets spreadsheet.

**Request Body:**
```json
{
  "title": "My New Spreadsheet"
}
```

**Response:**
```json
{
  "spreadsheetId": "1XYZ789...",
  "title": "My New Spreadsheet",
  "url": "https://docs.google.com/spreadsheets/d/1XYZ789..."
}
```

### POST /sheets/permissions

Share a spreadsheet with specific users or make it publicly accessible.

**Request Body:**
```json
{
  "spreadsheetId": "1ABC123...",
  "email": "user@example.com",
  "role": "writer",
  "type": "user"
}
```

**Parameters:**
- `role`: "owner", "writer", "reader"
- `type`: "user", "group", "domain", "anyone"

**Response:**
```json
{
  "success": true,
  "permissionId": "abc123"
}
```

## Apps Script API

### POST /script/run

Execute functions in Google Apps Script projects.

**Request Body:**
```json
{
  "scriptId": "1MgE39XhFyQlvCgVfRpl6bPBO2bmC27W2k5CcuQLb4viF2Uh8QeGnysn9",
  "function": "functionName",
  "parameters": ["param1", "param2"],
  "devMode": false
}
```

**Response:**
```json
{
  "result": "Function result data",
  "logs": ["Log message 1", "Log message 2"]
}
```

### POST /script/logs

Retrieve execution logs for Apps Script projects.

**Request Body:**
```json
{
  "scriptId": "1MgE39XhFyQlvCgVfRpl6bPBO2bmC27W2k5CcuQLb4viF2Uh8QeGnysn9",
  "startTime": "2025-06-26T00:00:00Z",
  "endTime": "2025-06-26T23:59:59Z",
  "userId": "me"
}
```

**Response:**
```json
{
  "processes": [
    {
      "processId": "abc123",
      "functionName": "myFunction",
      "processType": "EXECUTION",
      "startTime": "2025-06-26T12:00:00Z",
      "duration": "1.5s",
      "processStatus": "COMPLETED"
    }
  ]
}
```

## Client Library

The MCP Client library (`scripts/mcp-client.js`) provides convenient JavaScript functions for all API endpoints.

### Basic Usage

```javascript
const MCPClient = require('./scripts/mcp-client.js');

// Check server health
const health = await MCPClient.checkHealth();

// Read from spreadsheet
const data = await MCPClient.Sheets.read('spreadsheet-id', 'Sheet1!A1:C10');

// Write to spreadsheet
const result = await MCPClient.Sheets.write('spreadsheet-id', 'Sheet1!A1:C2', values);

// Create spreadsheet
const newSheet = await MCPClient.Sheets.create('New Sheet Title');

// Run Apps Script function
const scriptResult = await MCPClient.Script.run('script-id', 'functionName', ['param1']);
```

### Sheets Methods

#### MCPClient.Sheets.read(spreadsheetId, range)
- **spreadsheetId:** String - The ID of the spreadsheet
- **range:** String - A1 notation range (e.g., "Sheet1!A1:C10")
- **Returns:** Array of arrays containing the cell values

#### MCPClient.Sheets.write(spreadsheetId, range, values)
- **spreadsheetId:** String - The ID of the spreadsheet
- **range:** String - A1 notation range (e.g., "Sheet1!A1:C10")
- **values:** Array of arrays - The values to write
- **Returns:** Object with `updated` property (number of cells updated)

#### MCPClient.Sheets.create(title)
- **title:** String - Title for the new spreadsheet
- **Returns:** Object with `spreadsheetId` property

### Script Methods

#### MCPClient.Script.run(scriptId, functionName, parameters, devMode)
- **scriptId:** String - Apps Script project ID (optional, uses default)
- **functionName:** String - Name of the function to execute
- **parameters:** Array - Parameters to pass to the function (optional)
- **devMode:** Boolean - Whether to run in development mode (optional)
- **Returns:** Object containing the function result

#### MCPClient.Script.testFunction(scriptId)
- **scriptId:** String - Apps Script project ID (optional)
- **Returns:** Result of the test function

#### MCPClient.Script.getFormattedData(scriptId, spreadsheetId, range)
- **scriptId:** String - Apps Script project ID (optional)
- **spreadsheetId:** String - Target spreadsheet ID
- **range:** String - A1 notation range
- **Returns:** Formatted data object

## Error Handling

### Standard Error Response

```json
{
  "error": "Error message describing what went wrong",
  "code": "ERROR_CODE",
  "details": {
    "additional": "context information"
  }
}
```

### Common Error Codes

- `AUTHENTICATION_FAILED` - Service account authentication issue
- `PERMISSION_DENIED` - Insufficient permissions for the operation
- `NOT_FOUND` - Spreadsheet or script not found
- `INVALID_RANGE` - Malformed A1 notation range
- `QUOTA_EXCEEDED` - Google API quota limits reached
- `NETWORK_ERROR` - Connection or network issue

### Error Handling in Client Library

```javascript
try {
  const data = await MCPClient.Sheets.read('invalid-id', 'Sheet1!A1:C10');
} catch (error) {
  console.error('Error reading spreadsheet:', error.message);
  // Handle specific error types
  if (error.message.includes('PERMISSION_DENIED')) {
    // Handle permission errors
  }
}
```

## Examples

### Complete Workflow Example

```javascript
const MCPClient = require('./scripts/mcp-client.js');

async function completeWorkflow() {
  try {
    // 1. Check server health
    console.log('Checking server health...');
    const health = await MCPClient.checkHealth();
    console.log('Server status:', health.status);

    // 2. Create a new spreadsheet
    console.log('Creating new spreadsheet...');
    const newSheet = await MCPClient.Sheets.create('Workflow Example Sheet');
    const spreadsheetId = newSheet.spreadsheetId;
    console.log('Created spreadsheet:', spreadsheetId);

    // 3. Write headers and data
    console.log('Writing data...');
    const headers = [['Name', 'Email', 'Department']];
    const data = [
      ['John Doe', 'john@example.com', 'Engineering'],
      ['Jane Smith', 'jane@example.com', 'Marketing'],
      ['Bob Johnson', 'bob@example.com', 'Sales']
    ];
    
    await MCPClient.Sheets.write(spreadsheetId, 'Sheet1!A1:C1', headers);
    await MCPClient.Sheets.write(spreadsheetId, 'Sheet1!A2:C4', data);

    // 4. Read back the data
    console.log('Reading data back...');
    const readData = await MCPClient.Sheets.read(spreadsheetId, 'Sheet1!A1:C4');
    console.log('Retrieved data:', readData);

    // 5. Run Apps Script function (if available)
    try {
      const scriptResult = await MCPClient.Script.testFunction();
      console.log('Script result:', scriptResult);
    } catch (scriptError) {
      console.log('Apps Script not available:', scriptError.message);
    }

    console.log('Workflow completed successfully!');
    return { success: true, spreadsheetId };

  } catch (error) {
    console.error('Workflow failed:', error.message);
    return { success: false, error: error.message };
  }
}

// Run the workflow
completeWorkflow();
```

### Batch Operations Example

```javascript
async function batchOperations(spreadsheetId) {
  // Write to multiple ranges
  const promises = [
    MCPClient.Sheets.write(spreadsheetId, 'Sheet1!A1:A5', [['A1'], ['A2'], ['A3'], ['A4'], ['A5']]),
    MCPClient.Sheets.write(spreadsheetId, 'Sheet1!B1:B5', [['B1'], ['B2'], ['B3'], ['B4'], ['B5']]),
    MCPClient.Sheets.write(spreadsheetId, 'Sheet1!C1:C5', [['C1'], ['C2'], ['C3'], ['C4'], ['C5']])
  ];

  const results = await Promise.all(promises);
  console.log('Batch write completed:', results);

  // Read multiple ranges
  const readPromises = [
    MCPClient.Sheets.read(spreadsheetId, 'Sheet1!A1:A5'),
    MCPClient.Sheets.read(spreadsheetId, 'Sheet1!B1:B5'),
    MCPClient.Sheets.read(spreadsheetId, 'Sheet1!C1:C5')
  ];

  const readResults = await Promise.all(readPromises);
  console.log('Batch read completed:', readResults);
}
```

### Apps Script Integration Example

```javascript
async function appsScriptExample() {
  const scriptId = 'your-apps-script-project-id';
  
  try {
    // Test basic connectivity
    const testResult = await MCPClient.Script.testFunction(scriptId);
    console.log('Test function result:', testResult);

    // Run a custom function with parameters
    const customResult = await MCPClient.Script.run(
      scriptId,
      'processSpreadsheetData',
      ['1ABC123...', 'Sheet1!A1:C100']
    );
    console.log('Custom function result:', customResult);

    // Get execution logs
    const logs = await MCPClient.Script.getLogs(scriptId, {
      startTime: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // Last 24 hours
      endTime: new Date().toISOString()
    });
    console.log('Recent executions:', logs.processes.length);

  } catch (error) {
    console.error('Apps Script error:', error.message);
  }
}
```

## Rate Limits & Best Practices

### Google API Limits
- Sheets API: 100 requests per 100 seconds per user
- Apps Script API: 1000 requests per 100 seconds

### Best Practices
1. **Batch operations** when possible to reduce API calls
2. **Cache data** locally when appropriate
3. **Handle errors gracefully** with retry logic
4. **Use appropriate ranges** - avoid reading entire sheets when unnecessary
5. **Monitor quota usage** and implement backoff strategies

### Example Rate Limiting

```javascript
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function rateLimitedOperation(operations) {
  const results = [];
  for (let i = 0; i < operations.length; i++) {
    try {
      const result = await operations[i]();
      results.push(result);
      
      // Add delay between operations
      if (i < operations.length - 1) {
        await delay(100); // 100ms delay
      }
    } catch (error) {
      if (error.message.includes('QUOTA_EXCEEDED')) {
        console.log('Quota exceeded, waiting 60 seconds...');
        await delay(60000);
        i--; // Retry this operation
      } else {
        throw error;
      }
    }
  }
  return results;
}
```

---

**API Reference v9.0.0**  
**Created:** June 26, 2025  
**Source:** OnDeck V9 MCP Server 
