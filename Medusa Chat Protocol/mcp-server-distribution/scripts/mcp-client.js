/**
 * SheetSync MCP MCP Client
 * Client-side interface to the MCP Server
 * @version 9.0.0
 */

const MCP_SERVER_URL = 'http://localhost:3009';

/**
 * Utility function to check health of MCP server
 * @returns {Promise<Object>} Health status
 */
async function checkHealth() {
  try {
    const response = await fetch(`${MCP_SERVER_URL}/health`);
    return await response.json();
  } catch (error) {
    console.error('Error checking MCP Server health:', error);
    throw error;
  }
}

/**
 * Sheets API Methods
 */
const Sheets = {
  /**
   * Reads data from a spreadsheet
   * @param {string} spreadsheetId - The ID of the spreadsheet
   * @param {string} range - The range to read
   * @returns {Promise<Array>} The data read from the spreadsheet
   */
  read: async (spreadsheetId, range) => {
    try {
      const response = await fetch(`${MCP_SERVER_URL}/sheets/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spreadsheetId, range }),
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error);
      return data.data;
    } catch (error) {
      console.error(`Error reading spreadsheet ${spreadsheetId}, range ${range}:`, error);
      throw error;
    }
  },

  /**
   * Writes data to a spreadsheet
   * @param {string} spreadsheetId - The ID of the spreadsheet
   * @param {string} range - The range to write to
   * @param {Array} values - The values to write
   * @returns {Promise<Object>} Response containing number of cells updated
   */
  write: async (spreadsheetId, range, values) => {
    try {
      const response = await fetch(`${MCP_SERVER_URL}/sheets/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spreadsheetId, range, values }),
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error);
      return data;
    } catch (error) {
      console.error(`Error writing to spreadsheet ${spreadsheetId}, range ${range}:`, error);
      throw error;
    }
  },

  /**
   * Creates a new spreadsheet
   * @param {string} title - The title of the new spreadsheet
   * @returns {Promise<Object>} Response containing the new spreadsheet ID
   */
  create: async (title) => {
    try {
      const response = await fetch(`${MCP_SERVER_URL}/sheets/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error);
      return data;
    } catch (error) {
      console.error(`Error creating spreadsheet with title ${title}:`, error);
      throw error;
    }
  },
};

/**
 * Apps Script API Methods
 */
const Script = {
  /**
   * Runs an Apps Script function
   * @param {string} [scriptId='1MgE39XhFyQlvCgVfRpl6bPBO2bmC27W2k5CcuQLb4viF2Uh8QeGnysn9'] - The ID of the Apps Script project
   * @param {string} functionName - The name of the function to run
   * @param {Array} [parameters=[]] - Parameters to pass to the function
   * @param {boolean} [devMode=false] - Whether to run in development mode
   * @returns {Promise<Object>} Response containing the function result
   */
  run: async (
    scriptId = '1MgE39XhFyQlvCgVfRpl6bPBO2bmC27W2k5CcuQLb4viF2Uh8QeGnysn9',
    functionName,
    parameters = [],
    devMode = false
  ) => {
    try {
      const response = await fetch(`${MCP_SERVER_URL}/script/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scriptId,
          function: functionName,
          parameters,
          devMode,
        }),
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error);
      return data;
    } catch (error) {
      console.error(`Error running script function ${functionName}:`, error);
      throw error;
    }
  },

  /**
   * Runs the test function in the Apps Script project
   * @param {string} [scriptId='1MgE39XhFyQlvCgVfRpl6bPBO2bmC27W2k5CcuQLb4viF2Uh8QeGnysn9'] - The ID of the Apps Script project
   * @returns {Promise<Object>} Response from the test function
   */
  testFunction: async (scriptId = '1MgE39XhFyQlvCgVfRpl6bPBO2bmC27W2k5CcuQLb4viF2Uh8QeGnysn9') => {
    return Script.run(scriptId, 'testFunction');
  },

  /**
   * Gets formatted data from a spreadsheet
   * @param {string} [scriptId='1MgE39XhFyQlvCgVfRpl6bPBO2bmC27W2k5CcuQLb4viF2Uh8QeGnysn9'] - The ID of the Apps Script project
   * @param {string} spreadsheetId - The ID of the spreadsheet
   * @param {string} range - The range to read
   * @returns {Promise<Object>} Formatted data from the spreadsheet
   */
  getFormattedData: async (
    scriptId = '1MgE39XhFyQlvCgVfRpl6bPBO2bmC27W2k5CcuQLb4viF2Uh8QeGnysn9',
    spreadsheetId,
    range
  ) => {
    return Script.run(scriptId, 'getFormattedData', [spreadsheetId, range]);
  },

  /**
   * Sets formatting for a range in a spreadsheet
   * @param {string} [scriptId='1MgE39XhFyQlvCgVfRpl6bPBO2bmC27W2k5CcuQLb4viF2Uh8QeGnysn9'] - The ID of the Apps Script project
   * @param {string} spreadsheetId - The ID of the spreadsheet
   * @param {string} range - The range to format
   * @param {Object} formatting - The formatting to apply
   * @returns {Promise<Object>} Result of the formatting operation
   */
  setFormatting: async (
    scriptId = '1MgE39XhFyQlvCgVfRpl6bPBO2bmC27W2k5CcuQLb4viF2Uh8QeGnysn9',
    spreadsheetId,
    range,
    formatting
  ) => {
    return Script.run(scriptId, 'setFormatting', [spreadsheetId, range, formatting]);
  },

  /**
   * Retrieves execution logs for an Apps Script project
   * @param {string} [scriptId='1MgE39XhFyQlvCgVfRpl6bPBO2bmC27W2k5CcuQLb4viF2Uh8QeGnysn9'] - The ID of the Apps Script project
   * @param {Object} [options={}] - Additional options
   * @param {string} [options.startTime] - ISO format start time
   * @param {string} [options.endTime] - ISO format end time
   * @param {string} [options.userId='me'] - User ID to filter logs by
   * @returns {Promise<Object>} Response containing process logs
   */
  getLogs: async (
    scriptId = '1MgE39XhFyQlvCgVfRpl6bPBO2bmC27W2k5CcuQLb4viF2Uh8QeGnysn9',
    options = {}
  ) => {
    try {
      const body = { scriptId, ...options };

      const response = await fetch(`${MCP_SERVER_URL}/script/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error);
      return data;
    } catch (error) {
      console.error(`Error retrieving script logs:`, error);
      throw error;
    }
  },
};

// Export the MCP client
module.exports = {
  checkHealth,
  Sheets,
  Script,
};
