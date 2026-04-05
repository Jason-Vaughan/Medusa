/**
 * SheetSync MCP Test Client
 * Simple test script for the MCP server
 * @version 9.0.0
 */

// Import the MCP client
const MCPClient = require('../mcp-client.js');

// Configuration
// This is the ID of your target spreadsheet
const SPREADSHEET_ID = '1ClI-OzPSZAReJs2WL5xB6y3eA4YGAHsM4bVICjGvlX0';

// This should be the ID of your Apps Script project
// You'll need to create a new Apps Script project and update this
const SCRIPT_ID = 'YOUR_SCRIPT_ID_HERE';

/**
 * Run tests for the MCP server
 */
async function runTests() {
  console.log('===== SheetSync MCP MCP Server Tests =====');

  // Test 1: Check server health
  console.log('\nTest 1: Health Check');
  try {
    const health = await MCPClient.checkHealth();
    console.log('Health check result:', health);
  } catch (error) {
    console.error('Health check failed:', error.message);
    console.error('Make sure the MCP server is running at http://localhost:3009');
    return;
  }

  // Test 2: Create a spreadsheet
  console.log('\nTest 2: Create Spreadsheet');
  let newSpreadsheetId;
  try {
    const result = await MCPClient.Sheets.create(
      'SheetSync MCP Test Sheet ' + new Date().toISOString()
    );
    newSpreadsheetId = result.spreadsheetId;
    console.log('Created new spreadsheet with ID:', newSpreadsheetId);
  } catch (error) {
    console.error('Failed to create spreadsheet:', error.message);
  }

  // Use either the new spreadsheet or the default one
  const testSpreadsheetId = newSpreadsheetId || SPREADSHEET_ID;

  // Test 3: Write to a spreadsheet
  console.log('\nTest 3: Write to Spreadsheet');
  try {
    const values = [
      ['SheetSync MCP Test', new Date().toISOString()],
      ['Row 1', 'Data A', 'Data B'],
      ['Row 2', 'Data C', 'Data D'],
    ];

    const result = await MCPClient.Sheets.write(testSpreadsheetId, 'Sheet1!A1:C3', values);

    console.log('Write result:', result);
  } catch (error) {
    console.error('Failed to write to spreadsheet:', error.message);
  }

  // Test 4: Read from a spreadsheet
  console.log('\nTest 4: Read from Spreadsheet');
  try {
    const data = await MCPClient.Sheets.read(testSpreadsheetId, 'Sheet1!A1:C3');

    console.log('Read data:', data);
  } catch (error) {
    console.error('Failed to read from spreadsheet:', error.message);
  }

  // Test 5: Run an Apps Script function
  if (SCRIPT_ID !== 'YOUR_SCRIPT_ID_HERE') {
    console.log('\nTest 5: Run Apps Script Function');
    try {
      const result = await MCPClient.Script.run(
        SCRIPT_ID,
        'testFunction',
        [],
        true // Use development mode
      );

      console.log('Script function result:', result);
    } catch (error) {
      console.error('Failed to run script function:', error.message);
    }

    // Test 6: Execute testModifySheet function
    console.log('\nTest 6: Modify Sheet with Apps Script');
    try {
      const result = await MCPClient.Script.run(
        SCRIPT_ID,
        'testModifySheet',
        [testSpreadsheetId],
        true
      );

      console.log('Modify sheet result:', result);
    } catch (error) {
      console.error('Failed to modify sheet with script:', error.message);
    }
  } else {
    console.log('\nSkipping Apps Script tests. Please update SCRIPT_ID to run these tests.');
  }

  console.log('\n===== All tests completed =====');
}

// Run tests when executed directly
if (require.main === module) {
  runTests().catch((error) => {
    console.error('Test error:', error);
  });
}
