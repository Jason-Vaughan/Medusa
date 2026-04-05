# MCP Server Examples

This directory contains practical examples demonstrating how to use the MCP Server for Google Sheets and Apps Script integration.

## Available Examples

### 1. Create Spreadsheet (`create-spreadsheet.js`)

**What it demonstrates:**
- Creating a new Google Sheets spreadsheet
- Writing headers and structured data
- Adding formulas and calculations
- Reading data back for verification

**Usage:**
```bash
node examples/create-spreadsheet.js
```

**Key Features:**
- Employee data management example
- Formula usage (average calculation)
- Data verification
- Error handling

### 2. Batch Operations (`batch-operations.js`)

**What it demonstrates:**
- Performing multiple operations efficiently
- Rate limiting and delay strategies
- Error handling with retry logic
- Progress tracking for large operations
- Exponential backoff for failed requests

**Usage:**
```bash
node examples/batch-operations.js
```

**Key Features:**
- Parallel write operations
- Batch read operations
- Automatic retry with exponential backoff
- Progress indicators
- Rate limiting best practices

## Prerequisites

Before running the examples, ensure:

1. **MCP Server is running:**
   ```bash
   ./restart-mcp.sh
   ```

2. **Service account is configured:**
   - Place your Google service account JSON key as `mcp-server/service-account.json`
   - See `SERVICE_ACCOUNT_SETUP.md` for detailed setup instructions

3. **Dependencies are installed:**
   ```bash
   npm install
   ```

## Running Examples

### Option 1: Run Individual Examples

```bash
# Create and populate a spreadsheet
node examples/create-spreadsheet.js

# Demonstrate batch operations
node examples/batch-operations.js
```

### Option 2: Run All Examples

```bash
# Run the main test script (includes basic functionality)
node test-mock-script.js

# Then run advanced examples
node examples/create-spreadsheet.js
node examples/batch-operations.js
```

## Understanding the Output

Each example provides detailed console output showing:

- ✅ Successful operations
- ❌ Failed operations with error details
- 📊 Summary statistics
- 🔗 Links to view created spreadsheets
- ⏳ Progress indicators for long operations

## Example Output

```
=== Create Spreadsheet Example ===
Checking server health...
✓ Server status: ok

Creating new spreadsheet...
✓ Created spreadsheet: 1ABC123XYZ789...
  View at: https://docs.google.com/spreadsheets/d/1ABC123XYZ789...

Writing headers...
✓ Headers written
Writing employee data...
✓ Employee data written
Adding summary calculations...
✓ Summary row added

=== Spreadsheet Contents ===
Row 1: [ 'Name', 'Department', 'Email', 'Start Date', 'Salary' ]
Row 2: [ 'Alice Johnson', 'Engineering', 'alice@company.com', '2023-01-15', 75000 ]
...

✅ Example completed successfully!
📊 Spreadsheet ID: 1ABC123XYZ789...
🔗 View at: https://docs.google.com/spreadsheets/d/1ABC123XYZ789...
```

## Error Handling

The examples demonstrate various error handling strategies:

### Basic Error Handling
```javascript
try {
  const result = await MCPClient.Sheets.write(spreadsheetId, range, values);
  console.log('✓ Success:', result);
} catch (error) {
  console.error('❌ Error:', error.message);
}
```

### Retry Logic with Exponential Backoff
```javascript
async function attemptOperation(attempt = 1) {
  try {
    return await MCPClient.Sheets.write(spreadsheetId, range, values);
  } catch (error) {
    if (attempt < maxRetries) {
      const delay = baseDelay * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
      return attemptOperation(attempt + 1);
    }
    throw error;
  }
}
```

## Best Practices Demonstrated

### 1. Rate Limiting
- Add delays between batch operations
- Use shorter delays for read operations
- Implement exponential backoff for retries

### 2. Progress Tracking
- Show progress percentages for long operations
- Display elapsed time
- Provide meaningful status updates

### 3. Error Recovery
- Graceful handling of API errors
- Automatic retry for transient failures
- Clear error messages and logging

### 4. Data Validation
- Read back written data for verification
- Check operation results
- Validate server health before starting

## Customizing Examples

### Modifying Data
Edit the example data structures in each script:

```javascript
// In create-spreadsheet.js
const employeeData = [
  ['Your Name', 'Your Department', 'your.email@company.com', '2023-01-15', 75000],
  // Add more employees...
];
```

### Adding New Operations
Follow the pattern used in existing examples:

```javascript
async function yourCustomOperation(spreadsheetId) {
  try {
    console.log('=== Your Custom Operation ===');
    
    // Your operations here
    const result = await MCPClient.Sheets.write(
      spreadsheetId, 
      'Sheet1!A1:B1', 
      [['Custom', 'Data']]
    );
    
    console.log('✓ Custom operation completed');
    return result;
    
  } catch (error) {
    console.error('❌ Custom operation failed:', error.message);
    throw error;
  }
}
```

## Troubleshooting

### Common Issues

1. **Server not running:**
   ```bash
   ./restart-mcp.sh
   curl http://localhost:3009/health
   ```

2. **Permission errors:**
   - Check service account setup
   - Verify API permissions in Google Cloud Console

3. **Rate limit errors:**
   - Increase delays between operations
   - Reduce batch sizes

4. **Authentication errors:**
   - Verify service account JSON file exists
   - Check file permissions

### Getting Help

- Check the main `README.md` for setup instructions
- Review `API-REFERENCE.md` for complete API documentation
- See `SERVICE_ACCOUNT_SETUP.md` for authentication setup
- Run `node test-mock-script.js` to verify basic functionality

---

**Examples for MCP Server v9.0.0**  
**Last Updated:** June 26, 2025 
