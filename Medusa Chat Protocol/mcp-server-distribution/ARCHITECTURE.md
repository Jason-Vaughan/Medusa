# SheetSync MCP Architecture & API Documentation

## System Overview

SheetSync MCP is a Google Sheets extension with a local development environment based on a Model-Control-Pipeline (MCP) architecture. The system has been redesigned to avoid Apps Script deployment issues and enable easy local development.

## Key Components

### 1. Simple Local Server (Port 3000)

The `simple-local-server.js` is the JavaScript implementation that replaces the Python MCP server. It provides:

- Google Sheets API access through a service account
- Mock Apps Script functionality
- REST API endpoints for spreadsheet operations

```
http://localhost:3000
```

### 2. Web Interface (Port 8181)

The `server.js` provides a web UI for interacting with the system:

```
http://localhost:8181
```

## Server Management

The `restart-mcp.sh` script manages the server lifecycle:

```bash
# Start servers
./restart-mcp.sh

# Stop servers
./restart-mcp.sh stop
```

## API Reference

### Simple Local Server Endpoints

| Endpoint              | Method | Description                        | Parameters                               |
| --------------------- | ------ | ---------------------------------- | ---------------------------------------- |
| `/health`             | GET    | Check server status                | None                                     |
| `/sheets/read`        | POST   | Read data from Google Sheets       | `spreadsheetId`, `range`                 |
| `/sheets/write`       | POST   | Write data to Google Sheets        | `spreadsheetId`, `range`, `values`       |
| `/sheets/create`      | POST   | Create a new Google Sheet          | `title`                                  |
| `/sheets/permissions` | POST   | Share a Google Sheet               | `spreadsheetId`, `email`, `role`, `type` |
| `/script/run`         | POST   | Execute mock Apps Script functions | `function`, `parameters`                 |

### Mock Apps Script Functions

| Function           | Description                              | Parameters               |
| ------------------ | ---------------------------------------- | ------------------------ |
| `testFunction`     | Returns success result with version info | None                     |
| `getFormattedData` | Returns mock formatted spreadsheet data  | `spreadsheetId`, `range` |

## Working with the API

### Reading from a Spreadsheet

```javascript
const response = await makeRequest('POST', '/sheets/read', {
  spreadsheetId: 'YOUR_SPREADSHEET_ID',
  range: 'Sheet1!A1:C10',
});
```

### Writing to a Spreadsheet

```javascript
const response = await makeRequest('POST', '/sheets/write', {
  spreadsheetId: 'YOUR_SPREADSHEET_ID',
  range: 'Sheet1!A1:C4',
  values: [
    ['Header 1', 'Header 2', 'Header 3'],
    ['Value 1', 'Value 2', 'Value 3'],
  ],
});
```

### Creating a New Spreadsheet

```javascript
const response = await makeRequest('POST', '/sheets/create', {
  title: 'My New Spreadsheet',
});

const spreadsheetId = response.data.spreadsheetId;
```

### Sharing a Spreadsheet

```javascript
const response = await makeRequest('POST', '/sheets/permissions', {
  spreadsheetId: 'YOUR_SPREADSHEET_ID',
  email: 'user@example.com',
  role: 'writer', // Options: 'writer', 'reader', 'owner'
  type: 'user',
});
```

## Service Account Authentication

The system uses Google service account authentication stored in `mcp-server/service-account.json`. This allows API access without requiring user login.

## Project Structure

```
SheetSync MCP/
├── mcp-server/             # Python MCP server (alternative implementation)
│   ├── service-account.json  # Google service account key
│   └── venv/                 # Python virtual environment
├── src/                    # Apps Script source code
├── simple-local-server.js  # Local development server (primary)
├── server.js               # Web interface server
├── mcp-client.js           # Client library
├── test-mock-script.js     # Test script
├── restart-mcp.sh          # Server management script
```

## Common Operations

### Create and Write to a Spreadsheet

```javascript
// Create a new spreadsheet
const createResponse = await makeRequest('POST', '/sheets/create', {
  title: 'Test Sheet',
});

const spreadsheetId = createResponse.data.spreadsheetId;

// Write data to the spreadsheet
const writeResponse = await makeRequest('POST', '/sheets/write', {
  spreadsheetId,
  range: 'Sheet1!A1:B2',
  values: [
    ['Header 1', 'Header 2'],
    ['Value 1', 'Value 2'],
  ],
});
```

### Troubleshooting

1. **Connection Issues**

   - Ensure servers are running with `./restart-mcp.sh`
   - Check server health with `curl http://localhost:3000/health`

2. **Permission Issues**

   - Verify service account has necessary permissions
   - Check the service account JSON file exists

3. **Port Conflicts**
   - If port 3000 or 8181 is in use, you may need to kill existing processes
   - Use `ps aux | grep node` to find running Node.js processes

## Testing the System

Run the test script to verify functionality:

```bash
node test-mock-script.js
```

This will test all aspects of the system including:

- Server health check
- Mock Apps Script functions
- Spreadsheet creation and manipulation

## Helper Libraries

The file `mcp-client.js` provides utility functions for communicating with the MCP server. Import this file to easily make requests to the server endpoints.

## Future Enhancements

1. Add additional mock Apps Script functions as needed
2. Improve error handling and logging
3. Add more advanced spreadsheet formatting options

## Architecture Design

The system follows these architectural principles:

1. **Local First**: Everything runs locally without deployment
2. **Service-Based**: Clean separation between MCP server and Web UI
3. **Mock Capabilities**: Apps Script functions are mocked for local testing
4. **Real Sheets Integration**: Actual Google Sheets integration through service account

## Zone Mapper & Flexible Field Mapping

### Rationale

- Spreadsheets from different sources have varying column names, formats, and requirements.
- A dedicated Zone Mapper UI allows users to map spreadsheet columns to internal zone fields, define validation, and (in the future) set up transforms or rules.
- Decouples mapping logic from zone creation, making the system more maintainable and extensible.

### UI/UX

- After creating or editing a zone, users can open the Zone Mapper screen for that zone.
- The UI displays a preview of the remote sheet and a mapping table:
  - Left: Detected spreadsheet columns
  - Right: Dropdown/select for mapping to internal fields
  - Options to add custom fields, ignore columns, or set up computed fields
- Validation and preview features help users verify mappings before saving.

### Backend Model

- Mappings are stored as JSON in the Zone or a related FieldMapping table.
- Example schema:
  ```json
  {
    "Name": { "targetField": "displayName", "transform": "trim" },
    "Score": { "targetField": "score", "type": "number", "required": true }
  }
  ```
- This schema is designed to be extensible:
  - New keys (e.g., validation, default, formula) can be added as needed.
  - Supports versioning and migration for future changes.

### Extensibility

- The mapping config is pluggable and versioned.
- New features (validation, transforms, templates, conditional logic) can be added without breaking existing mappings.
- The architecture supports incremental delivery: start simple, add complexity as new spreadsheet formats or business rules are encountered.

### Summary

- The Zone Mapper and flexible mapping schema provide a robust foundation for handling diverse spreadsheet formats and evolving mapping logic in OnDeck V9.
