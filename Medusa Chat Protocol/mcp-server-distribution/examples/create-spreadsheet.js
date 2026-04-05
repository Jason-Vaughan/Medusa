/**
 * Example: Create and Populate a Spreadsheet
 *
 * This example demonstrates how to:
 * 1. Create a new Google Sheets spreadsheet
 * 2. Write headers and data
 * 3. Read back the data for verification
 */

const MCPClient = require('../scripts/mcp-client.js');

async function createSpreadsheetExample() {
  try {
    console.log('=== Create Spreadsheet Example ===');

    // 1. Check server health first
    console.log('Checking server health...');
    const health = await MCPClient.checkHealth();
    console.log('✓ Server status:', health.status);

    // 2. Create a new spreadsheet
    console.log('\nCreating new spreadsheet...');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const title = `Example Spreadsheet ${timestamp}`;

    const newSheet = await MCPClient.Sheets.create(title);
    const spreadsheetId = newSheet.spreadsheetId;
    console.log('✓ Created spreadsheet:', spreadsheetId);
    console.log('  View at: https://docs.google.com/spreadsheets/d/' + spreadsheetId);

    // 3. Prepare sample data
    const headers = [['Name', 'Department', 'Email', 'Start Date', 'Salary']];
    const employeeData = [
      ['Alice Johnson', 'Engineering', 'alice@company.com', '2023-01-15', 75000],
      ['Bob Smith', 'Marketing', 'bob@company.com', '2023-02-01', 65000],
      ['Carol Williams', 'Sales', 'carol@company.com', '2023-01-20', 70000],
      ['David Brown', 'HR', 'david@company.com', '2023-03-01', 60000],
      ['Eve Davis', 'Engineering', 'eve@company.com', '2023-02-15', 80000]
    ];

    // 4. Write headers
    console.log('\nWriting headers...');
    await MCPClient.Sheets.write(spreadsheetId, 'Sheet1!A1:E1', headers);
    console.log('✓ Headers written');

    // 5. Write employee data
    console.log('Writing employee data...');
    await MCPClient.Sheets.write(spreadsheetId, 'Sheet1!A2:E6', employeeData);
    console.log('✓ Employee data written');

    // 6. Add a summary row
    console.log('Adding summary calculations...');
    const summaryHeaders = [['', '', '', 'Average Salary:', '=AVERAGE(E2:E6)']];
    await MCPClient.Sheets.write(spreadsheetId, 'Sheet1!A8:E8', summaryHeaders);
    console.log('✓ Summary row added');

    // 7. Read back all data for verification
    console.log('\nReading back data for verification...');
    const allData = await MCPClient.Sheets.read(spreadsheetId, 'Sheet1!A1:E8');

    console.log('\n=== Spreadsheet Contents ===');
    allData.forEach((row, index) => {
      console.log(`Row ${index + 1}:`, row);
    });

    // 8. Read just the employee names
    console.log('\n=== Employee Names ===');
    const names = await MCPClient.Sheets.read(spreadsheetId, 'Sheet1!A2:A6');
    names.forEach((nameRow, index) => {
      console.log(`${index + 1}. ${nameRow[0]}`);
    });

    console.log('\n✅ Example completed successfully!');
    console.log(`📊 Spreadsheet ID: ${spreadsheetId}`);
    console.log(`🔗 View at: https://docs.google.com/spreadsheets/d/${spreadsheetId}`);

    return { success: true, spreadsheetId };

  } catch (error) {
    console.error('❌ Error in example:', error.message);
    return { success: false, error: error.message };
  }
}

// Run the example if this script is executed directly
if (require.main === module) {
  createSpreadsheetExample().then(result => {
    if (result.success) {
      console.log('\n🎉 Example completed successfully!');
      process.exit(0);
    } else {
      console.log('\n💥 Example failed:', result.error);
      process.exit(1);
    }
  });
}

module.exports = createSpreadsheetExample;
