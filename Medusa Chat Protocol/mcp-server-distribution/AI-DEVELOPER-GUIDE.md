# SheetSync MCP AI Developer Guide

## System Overview

SheetSync MCP is a Google Sheets extension with a local development environment that uses a Model-Control-Pipeline (MCP) architecture. It has been redesigned to avoid Apps Script deployment issues by providing a local server that interacts with Google Sheets via the Sheets API.

## Key Concepts

1. **Simple Local Server**: JavaScript-based server that provides Google Sheets access and mock Apps Script functions
2. **Web Interface**: UI for interacting with the system
3. **Service Account**: Used for authenticating with Google Sheets API without user intervention
4. **OAuth2**: Used for Apps Script API execution (service accounts not supported)

## Shared Test Data Spreadsheet (for Development)

For all development and testing, we use a shared Google Sheet containing our sample data set. This sheet is accessible to the MCP server via the service account and should be referenced in all relevant scripts and tests.

- **Spreadsheet ID:** `1CxZusOFNEm5XxJbj_sZ1l5FAT3p3UZ7UCb4370wHndc`
- **Access:** The sheet must be shared with the service account email found in `mcp-server/service-account.json`.
- **Usage:**
  - Use this sheet for all development, integration, and testing tasks.
  - Reference this ID in scripts, API calls, and documentation.
  - The sheet contains multiple tabs; specify the tab name (sheet name) and range as needed for your use case.

## Starting Point for Helping Users

When helping users with SheetSync MCP:

1. First check if the servers are running:

   ```bash
   curl http://localhost:3000/health
   ```

2. If servers aren't running, start them:

   ```bash
   ./restart-mcp.sh
   ```

3. If there are port conflicts, stop existing servers:
   ```bash
   ./restart-mcp.sh stop
   ```

## Integration Points

### Google Sheets API

- Uses service account authentication
- Configured in `mcp-server/service-account.json`
- Used for reading/writing spreadsheet data

### Apps Script API

- Uses OAuth2 authentication (see APPS-SCRIPT-README.md for details)
- Used for executing custom functions
- Requires API executable deployments

## Workspace Organization Best Practices

- **Archive Folder:** Before creating any new functions or test scripts, always check the `Archive/` folder for an existing or similar script. Reuse or adapt archived scripts when possible to avoid duplication.
- **Frequently Used Scripts:** The `scripts/` folder contains utilities that are used often, such as `getAppsScriptLogs.js` for Apps Script API integration.

## Common API Usage Patterns

### Health Check

```javascript
const response = await makeRequest('GET', '/health');
// Should return: {status: "ok", service_account: true, version: "9.0.0", name: "SheetSync MCP Simple Local Server"}
```

### Creating a Spreadsheet

```javascript
const response = await makeRequest('POST', '/sheets/create', {
  title: 'My Spreadsheet',
});
const spreadsheetId = response.data.spreadsheetId;
```

### Writing to a Spreadsheet

```javascript
const response = await makeRequest('POST', '/sheets/write', {
  spreadsheetId: 'SPREADSHEET_ID',
  range: 'Sheet1!A1:B2',
  values: [
    ['Header 1', 'Header 2'],
    ['Value 1', 'Value 2'],
  ],
});
```

### Reading from a Spreadsheet

```javascript
const response = await makeRequest('POST', '/sheets/read', {
  spreadsheetId: 'SPREADSHEET_ID',
  range: 'Sheet1!A1:B2',
});
const data = response.data.data; // Array of values
```

### Sharing a Spreadsheet

```javascript
const response = await makeRequest('POST', '/sheets/permissions', {
  spreadsheetId: 'SPREADSHEET_ID',
  email: 'user@example.com',
  role: 'writer', // Options: 'writer', 'reader', 'owner'
});
```

## The makeRequest Function

Users will need a utility function for making HTTP requests. Here's the standard implementation:

```javascript
function makeRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
      },
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
            data: parsedData,
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
```

## Troubleshooting Guide

### Server Won't Start

```bash
# Check if servers are already running
ps aux | grep node

# Kill existing Node.js processes if necessary
pkill -f 'node'

# Try starting again
./restart-mcp.sh
```

### Connection Errors

If you see ECONNREFUSED errors:

- Servers might not be running
- There might be a port conflict
- The service account might be misconfigured

### Permission Issues

If you see permission errors with Google Sheets:

- Verify the service account JSON exists in mcp-server/service-account.json
- Check if the service account has appropriate permissions
- The spreadsheet might not exist or be accessible to the service account

## Quick References

### Server Ports

- MCP Server: http://localhost:3000
- Web Interface: http://localhost:8181

### Key Files

- `simple-local-server.js`: The main server implementation
- `server.js`: Web UI server
- `restart-mcp.sh`: Server management script
- `mcp-server/service-account.json`: Google credentials

### Important Scripts

- `test-mock-script.js`: Tests basic functionality
- `create-spreadsheet.js`: Example of creating and writing to a spreadsheet

## End-User Basic Instructions

When instructing end users, advise:

1. Start servers: `./restart-mcp.sh`
2. Open web interface: http://localhost:8181
3. Run tests: `node test-mock-script.js`
4. Stop servers: `./restart-mcp.sh stop`

## Workspace Organization Best Practices

- **Archive Folder:** Before creating any new functions or test scripts, always check the `Archive/` folder for an existing or similar script. Reuse or adapt archived scripts when possible to avoid duplication.
- **Frequently Used Scripts:** The `scripts/` folder has been created to store scripts and utilities that are used often. For example, `mcp-client.js` (the core utility for interacting with the MCP server) has been moved here. Place all frequently used or shared scripts in this folder for easy access and organization.

## CLI TypeScript Support

The project includes a TypeScript-based CLI for task management and other utilities. Due to Node.js not natively supporting TypeScript imports, the CLI scripts are configured to use `ts-node` for runtime TypeScript compilation.

### Solution Implementation

**Problem:** JavaScript files importing TypeScript modules would fail with `ERR_MODULE_NOT_FOUND` errors.

**Solution:**

1. Use `ts-node` with ESM loader for TypeScript runtime compilation
2. Configure package.json scripts with the appropriate Node.js options
3. Update import paths to use `.ts` extensions

### Configuration Details

**Package.json Scripts Pattern:**

```json
"task": "NODE_OPTIONS=\"--loader ts-node/esm\" ts-node scripts/task.js"
```

**Import Statement in JavaScript files:**

```javascript
import { taskTracker } from './task-tracker.ts';
```

**TypeScript Configuration (tsconfig.json):**

```json
{
  "ts-node": {
    "esm": true,
    "experimentalSpecifiers": true
  },
  "compilerOptions": {
    "allowImportingTsExtensions": true
    // ... other options
  }
}
```

### Usage

All CLI commands are available through npm scripts:

```bash
npm run task:create    # Create a new task
npm run task:list      # List all tasks
npm run task:update    # Update task status
npm run task:import-roadmap  # Import tasks from roadmap
```

**Note:** The `--loader ts-node/esm` option shows a deprecation warning but remains functional. A future update may migrate to the newer `register()` method when ts-node fully supports it.

## Task List Reference (rule-every-chat)

- The canonical, up-to-date task list is always found in `task-list.md` in the project root.
- If the user refers to "the task list," "main task list," or similar, always reference `task-list.md` unless otherwise specified.
- If `next_session_priming.md` is not updated, always check `task-list.md` for the current set of tasks and priorities at the start of the session.
- This ensures that all sessions and AIs have a single source of truth for active, pending, and prioritized tasks.

## Task Management

### Task ID Format

All tasks in the OnDeck V9 project use a standardized ID format:

- Format: `TASK-YYYYMMDD-NNN`
- Where:
  - YYYYMMDD is the creation date
  - NNN is a sequential 3-digit number (001-999)
- Example: `TASK-20250524-001`

This format ensures:

- Chronological tracking of when tasks were created
- Unique identification across the project
- Easy sorting and filtering by date
- Up to 999 tasks per day

When creating or referencing tasks, always use this format. The old format (`TASK-{CATEGORY}-{PRIORITY}-{UUID}`) is deprecated and should not be used.
