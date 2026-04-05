# MCP Server Distribution Package
**Version:** 9.0.0  
**Date:** June 26, 2025  
**Source:** OnDeck V9 Project

## Overview

This package contains a complete, portable MCP (Model-Control-Pipeline) server system for integrating Google Sheets and Apps Script functionality into any Node.js project. The system provides both local development capabilities and production-ready Google API integration.

## What's Included

### Core Components

- **`mcp-server/`** - Python-based MCP server with Google APIs integration
- **`simple-local-server.js`** - JavaScript-based local development server
- **`server.js`** - Web interface server for testing and management
- **`scripts/mcp-client.js`** - Client library for easy API integration
- **`restart-mcp.sh`** - Server management script

### Documentation

- **`README.md`** - This file (complete setup guide)
- **`API-REFERENCE.md`** - Complete API documentation
- **`ARCHITECTURE.md`** - System architecture overview
- **`QUICKSTART.md`** - Quick setup guide
- **`SERVICE_ACCOUNT_SETUP.md`** - Google service account configuration
- **`LOCAL-DEVELOPMENT.md`** - Local development guidelines

### Testing & Examples

- **`test-mock-script.js`** - Comprehensive test suite
- **`examples/`** - Example scripts and usage patterns

## Quick Setup

### Prerequisites

- Node.js 16+ 
- Python 3.8+
- Google Cloud Project with Sheets API enabled
- Service Account JSON key file

### Installation

1. **Extract this package to your project directory**

2. **Install Node.js dependencies**
   ```bash
   npm install googleapis@^148.0.0 concurrently@^9.1.2
   ```

3. **Setup Python environment**
   ```bash
   cd mcp-server
   python3 -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   pip install -r requirements.txt
   ```

4. **Configure Google Service Account**
   - Place your service account JSON key as `mcp-server/service-account.json`
   - See `SERVICE_ACCOUNT_SETUP.md` for detailed instructions

5. **Start the servers**
   ```bash
   ./restart-mcp.sh
   ```

6. **Verify installation**
   ```bash
   node test-mock-script.js
   ```

## Server Endpoints

Once running, the following endpoints are available:

- **MCP Server:** `http://localhost:3009`
- **Web Interface:** `http://localhost:8181`

### API Endpoints

#### Health & Status
- `GET /health` - Server health check

#### Google Sheets
- `POST /sheets/read` - Read spreadsheet data
- `POST /sheets/write` - Write spreadsheet data  
- `POST /sheets/create` - Create new spreadsheet
- `POST /sheets/permissions` - Share spreadsheet

#### Apps Script
- `POST /script/run` - Execute Apps Script functions
- `POST /script/logs` - Retrieve execution logs

## Basic Usage

### Reading from Google Sheets

```javascript
const MCPClient = require('./scripts/mcp-client.js');

// Read data from a spreadsheet
const data = await MCPClient.Sheets.read(
  'your-spreadsheet-id',
  'Sheet1!A1:C10'
);
console.log(data);
```

### Writing to Google Sheets

```javascript
// Write data to a spreadsheet
const result = await MCPClient.Sheets.write(
  'your-spreadsheet-id',
  'Sheet1!A1:C2',
  [
    ['Header 1', 'Header 2', 'Header 3'],
    ['Value 1', 'Value 2', 'Value 3']
  ]
);
console.log(`Updated ${result.updated} cells`);
```

### Creating Spreadsheets

```javascript
// Create a new spreadsheet
const result = await MCPClient.Sheets.create('My New Spreadsheet');
const spreadsheetId = result.spreadsheetId;
console.log(`Created spreadsheet: ${spreadsheetId}`);
```

### Running Apps Script Functions

```javascript
// Execute Apps Script functions
const result = await MCPClient.Script.run(
  'your-script-id',
  'functionName',
  ['param1', 'param2']
);
console.log(result);
```

## Project Integration

### Adding to Existing Project

1. Copy the MCP server files to your project
2. Add the required dependencies to your `package.json`
3. Update your startup scripts to include the MCP server
4. Import the client library where needed

### Example package.json Integration

```json
{
  "scripts": {
    "dev": "concurrently \"your-app\" \"./restart-mcp.sh\"",
    "mcp:start": "./restart-mcp.sh",
    "mcp:stop": "./restart-mcp.sh stop",
    "mcp:test": "node test-mock-script.js"
  },
  "dependencies": {
    "googleapis": "^148.0.0",
    "concurrently": "^9.1.2"
  }
}
```

## Configuration

### Environment Variables

The system supports the following environment variables:

- `MCP_PORT` - MCP server port (default: 3009)
- `WEB_PORT` - Web interface port (default: 8181)
- `GOOGLE_SERVICE_ACCOUNT_PATH` - Path to service account JSON
- `DEFAULT_SCRIPT_ID` - Default Apps Script project ID

### Service Account Setup

1. Create a Google Cloud Project
2. Enable Google Sheets API and Apps Script API
3. Create a Service Account with appropriate permissions
4. Download the JSON key file
5. Place it as `mcp-server/service-account.json`

See `SERVICE_ACCOUNT_SETUP.md` for detailed instructions.

## Architecture

### Local Development Mode

The system includes a pure JavaScript server (`simple-local-server.js`) that provides:

- Google Sheets API integration (real)
- Mock Apps Script functions (simulated)
- No deployment requirements
- Instant startup and testing

### Production Mode

The Python MCP server (`mcp-server/mcp_server.py`) provides:

- Full Google Sheets API integration
- Real Apps Script execution
- Advanced error handling
- Production logging

### Dual Server Architecture

Both servers can run simultaneously:

- JavaScript server: Port 3000 (local development)
- Python server: Port 3009 (production)
- Web interface: Port 8181 (management)

## Troubleshooting

### Common Issues

**Servers won't start:**
```bash
# Check if ports are in use
lsof -i :3009
lsof -i :8181

# Kill existing processes
./restart-mcp.sh stop
```

**Permission errors:**
- Verify service account JSON exists
- Check Google Cloud Project APIs are enabled
- Ensure service account has Sheets/Script permissions

**Connection refused:**
- Servers may not be running
- Check firewall settings
- Verify port configuration

### Getting Help

1. Check server logs: `mcp-server/mcp-server.log`
2. Run health check: `curl http://localhost:3009/health`
3. Run test suite: `node test-mock-script.js`
4. Check web interface: `http://localhost:8181`

## Support & Updates

This MCP server package is designed to be self-contained and portable. For updates or issues:

1. Check the logs and documentation
2. Verify Google API configuration
3. Test with the included test scripts
4. Reference the API documentation

## Version History

- **v9.0.0** (June 2025) - Complete portable distribution package
- **v8.x** - Local development enhancements
- **v7.x** - Apps Script integration
- **v6.x** - Initial MCP server implementation

---

**Package created from OnDeck V9 project**  
**Date:** June 26, 2025 
