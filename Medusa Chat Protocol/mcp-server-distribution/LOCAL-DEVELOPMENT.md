# SheetSync MCP Local Development

This guide explains how to run the SheetSync MCP system locally without requiring Apps Script deployment.

## Overview

The system has been configured to run entirely locally with:

1. **Simple Local Server** (Port 3000) - Replaces the Python MCP server with JavaScript equivalent
2. **Web Interface** (Port 8181) - Provides a user interface

The local server provides these capabilities:

- Google Sheets integration (real connection to Sheets API)
- Mock Apps Script functions (simulated responses)

## Running the System

Use the provided script to start/stop all servers:

```bash
# Start all servers
./restart-mcp.sh

# Stop all servers
./restart-mcp.sh stop
```

Once started, you can access:

- MCP Server: http://localhost:3009
- Web Interface: http://localhost:8181

## Testing

Two test scripts are provided:

1. **Basic API Test**:

```bash
node test-mock-script.js
```

This tests all the local server endpoints, including mock Apps Script functions.

2. **Direct Google Sheets Test**:

```bash
# Test direct access to Google Sheets (no mocking)
node test-direct-apps-script.js
```

## Available Endpoints

The local server provides these API endpoints:

### Health Check

- `GET /health` - Check server status

### Google Sheets

- `POST /sheets/read` - Read data from Google Sheets
- `POST /sheets/write` - Write data to Google Sheets
- `POST /sheets/create` - Create a new Google Sheet

### Mock Apps Script

- `POST /script/run` - Execute mock Apps Script functions

## Mock Apps Script Functions

The following Apps Script functions are mocked for local development:

### testFunction

Returns a success result with version information.

Example request:

```json
{
  "function": "testFunction",
  "parameters": []
}
```

### getFormattedData

Returns mock spreadsheet data with formatting.

Example request:

```json
{
  "function": "getFormattedData",
  "parameters": ["spreadsheetId", "A1:B2"]
}
```

## Notes

- No real Apps Script deployment is needed for local development
- All Apps Script functions are mocked locally
- Real Google Sheets integration still works with the service account

## Services

The following services will be running:

- MCP Server: http://localhost:3009
- Web Server: http://localhost:8181
- Frontend: http://localhost:5173
