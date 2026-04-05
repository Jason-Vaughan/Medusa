/**
 * Example: Batch Operations and Error Handling
 *
 * This example demonstrates:
 * 1. Batch reading and writing operations
 * 2. Error handling and retry logic
 * 3. Rate limiting best practices
 * 4. Progress tracking
 */

const MCPClient = require('../scripts/mcp-client.js');

// Helper function to add delay between operations
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Perform batch write operations with rate limiting
 */
async function batchWriteExample(spreadsheetId) {
  console.log('=== Batch Write Operations ===');

  // Prepare data for multiple sheets/ranges
  const batchData = [
    {
      range: 'Sheet1!A1:C3',
      values: [
        ['Product', 'Category', 'Price'],
        ['Laptop', 'Electronics', 999.99],
        ['Phone', 'Electronics', 699.99]
      ]
    },
    {
      range: 'Sheet1!E1:G3',
      values: [
        ['Customer', 'Location', 'Orders'],
        ['John Doe', 'New York', 5],
        ['Jane Smith', 'Los Angeles', 3]
      ]
    },
    {
      range: 'Sheet1!A5:C7',
      values: [
        ['Supplier', 'Contact', 'Rating'],
        ['TechCorp', 'tech@corp.com', 4.5],
        ['GadgetInc', 'sales@gadget.com', 4.2]
      ]
    }
  ];

  const writePromises = batchData.map(async (batch, index) => {
    try {
      // Add delay to respect rate limits
      await delay(index * 200); // 200ms between operations

      console.log(`Writing batch ${index + 1}: ${batch.range}`);
      const result = await MCPClient.Sheets.write(
        spreadsheetId,
        batch.range,
        batch.values
      );

      console.log(`✓ Batch ${index + 1} completed: ${result.updated} cells updated`);
      return { success: true, batch: index + 1, result };

    } catch (error) {
      console.error(`❌ Batch ${index + 1} failed:`, error.message);
      return { success: false, batch: index + 1, error: error.message };
    }
  });

  const results = await Promise.all(writePromises);

  // Summary
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  console.log(`\n📊 Batch Write Summary:`);
  console.log(`  ✅ Successful: ${successful}`);
  console.log(`  ❌ Failed: ${failed}`);

  return results;
}

/**
 * Perform batch read operations
 */
async function batchReadExample(spreadsheetId) {
  console.log('\n=== Batch Read Operations ===');

  const readRanges = [
    'Sheet1!A1:C3',
    'Sheet1!E1:G3',
    'Sheet1!A5:C7'
  ];

  const readPromises = readRanges.map(async (range, index) => {
    try {
      await delay(index * 100); // Shorter delay for reads

      console.log(`Reading range ${index + 1}: ${range}`);
      const data = await MCPClient.Sheets.read(spreadsheetId, range);

      console.log(`✓ Range ${index + 1} read: ${data.length} rows`);
      return { success: true, range, data };

    } catch (error) {
      console.error(`❌ Range ${index + 1} failed:`, error.message);
      return { success: false, range, error: error.message };
    }
  });

  const results = await Promise.all(readPromises);

  // Display the data
  results.forEach((result, index) => {
    if (result.success) {
      console.log(`\n📋 Data from ${result.range}:`);
      result.data.forEach((row, rowIndex) => {
        console.log(`  ${rowIndex + 1}: [${row.join(', ')}]`);
      });
    }
  });

  return results;
}

/**
 * Error handling and retry logic example
 */
async function retryOperationExample(spreadsheetId) {
  console.log('\n=== Retry Logic Example ===');

  const maxRetries = 3;
  const baseDelay = 1000; // 1 second

  async function attemptOperation(attempt = 1) {
    try {
      console.log(`Attempt ${attempt}: Writing test data...`);

      // Intentionally use a range that might fail to demonstrate retry
      const result = await MCPClient.Sheets.write(
        spreadsheetId,
        'Sheet1!Z1:Z1',
        [['Test Value']]
      );

      console.log(`✅ Operation succeeded on attempt ${attempt}`);
      return result;

    } catch (error) {
      console.error(`❌ Attempt ${attempt} failed:`, error.message);

      if (attempt < maxRetries) {
        const delayTime = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff
        console.log(`⏳ Retrying in ${delayTime}ms...`);

        await delay(delayTime);
        return attemptOperation(attempt + 1);
      } else {
        console.error(`💥 Operation failed after ${maxRetries} attempts`);
        throw error;
      }
    }
  }

  try {
    await attemptOperation();
  } catch (finalError) {
    console.error('Final error:', finalError.message);
  }
}

/**
 * Progress tracking for large operations
 */
async function progressTrackingExample(spreadsheetId) {
  console.log('\n=== Progress Tracking Example ===');

  const totalOperations = 10;
  const operations = [];

  // Create a series of write operations
  for (let i = 0; i < totalOperations; i++) {
    operations.push({
      range: `Sheet1!${String.fromCharCode(65 + i)}10:${String.fromCharCode(65 + i)}10`,
      values: [[`Value ${i + 1}`]]
    });
  }

  console.log(`Starting ${totalOperations} operations...`);
  const startTime = Date.now();

  for (let i = 0; i < operations.length; i++) {
    const operation = operations[i];
    const progress = ((i + 1) / totalOperations * 100).toFixed(1);

    try {
      await MCPClient.Sheets.write(spreadsheetId, operation.range, operation.values);

      // Progress indicator
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[${progress}%] Operation ${i + 1}/${totalOperations} completed (${elapsed}s elapsed)`);

      // Rate limiting
      await delay(200);

    } catch (error) {
      console.error(`❌ Operation ${i + 1} failed:`, error.message);
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n🏁 All operations completed in ${totalTime} seconds`);
}

/**
 * Main example function
 */
async function batchOperationsExample() {
  try {
    console.log('=== Batch Operations & Error Handling Example ===');

    // Check server health
    const health = await MCPClient.checkHealth();
    console.log('✓ Server status:', health.status);

    // Create a test spreadsheet
    const newSheet = await MCPClient.Sheets.create('Batch Operations Example');
    const spreadsheetId = newSheet.spreadsheetId;
    console.log('✓ Created test spreadsheet:', spreadsheetId);

    // Run all examples
    await batchWriteExample(spreadsheetId);
    await batchReadExample(spreadsheetId);
    await retryOperationExample(spreadsheetId);
    await progressTrackingExample(spreadsheetId);

    console.log('\n🎉 All batch operations completed!');
    console.log(`📊 Spreadsheet: https://docs.google.com/spreadsheets/d/${spreadsheetId}`);

    return { success: true, spreadsheetId };

  } catch (error) {
    console.error('❌ Batch operations example failed:', error.message);
    return { success: false, error: error.message };
  }
}

// Run the example if this script is executed directly
if (require.main === module) {
  batchOperationsExample().then(result => {
    if (result.success) {
      console.log('\n✅ Example completed successfully!');
      process.exit(0);
    } else {
      console.log('\n💥 Example failed:', result.error);
      process.exit(1);
    }
  });
}

module.exports = batchOperationsExample;
