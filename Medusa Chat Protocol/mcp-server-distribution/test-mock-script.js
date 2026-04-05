/**
 * Test Mock Apps Script Functions
 * This script tests the mock Apps Script functions in our simple local server
 */

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

async function runTests() {
  try {
    console.log('Testing the SheetSync MCP Mock Server...');
    
    // Health check
    console.log('\nChecking server health...');
    const healthResponse = await makeRequest('GET', '/health');
    console.log(`Health status: ${healthResponse.data.status}`);
    console.log(`Server name: ${healthResponse.data.name}`);
    
    // Test mock testFunction
    console.log('\nTesting mock testFunction...');
    const testResponse = await makeRequest('POST', '/script/run', {
      function: 'testFunction',
      parameters: []
    });
    console.log('Response:', testResponse.data);
    
    // Test mock getFormattedData
    console.log('\nTesting mock getFormattedData...');
    const formattedDataResponse = await makeRequest('POST', '/script/run', {
      function: 'getFormattedData',
      parameters: ['mock-spreadsheet-id', 'A1:B2']
    });
    console.log('Response:', formattedDataResponse.data);
    
    // Test sheets creation
    console.log('\nTesting sheets creation...');
    const createResponse = await makeRequest('POST', '/sheets/create', {
      title: 'Test Sheet ' + new Date().toISOString()
    });
    
    if (createResponse.data.spreadsheetId) {
      const spreadsheetId = createResponse.data.spreadsheetId;
      console.log(`Created spreadsheet with ID: ${spreadsheetId}`);
      
      // Write to the sheet
      console.log('\nTesting sheet writing...');
      const writeResponse = await makeRequest('POST', '/sheets/write', {
        spreadsheetId,
        range: 'Sheet1!A1:B2',
        values: [['Header 1', 'Header 2'], ['Value 1', 'Value 2']]
      });
      console.log(`Updated ${writeResponse.data.updated} cells`);
      
      // Read from the sheet
      console.log('\nTesting sheet reading...');
      const readResponse = await makeRequest('POST', '/sheets/read', {
        spreadsheetId,
        range: 'Sheet1!A1:B2'
      });
      console.log('Sheet data:', readResponse.data);
    }
    
    console.log('\nAll tests completed successfully!');
  } catch (error) {
    console.error('Error running tests:', error);
  }
}

// Run the tests
runTests(); 