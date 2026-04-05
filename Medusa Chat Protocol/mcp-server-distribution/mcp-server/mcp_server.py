#!/usr/bin/env python3
"""
OnDeck-V9 MCP Server
Simple MCP (Model-Control-Pipeline) server for OnDeck-V9 project
Handles API requests for Google Sheets and Apps Script integration
"""

import json
import os
import sys
import http.server
import socketserver
import logging
from urllib.parse import urlparse, parse_qs

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('mcp-server.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger('ondeck_v9_mcp')

# Check if we have required libraries
try:
    from google.oauth2 import service_account
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
except ImportError:
    logger.error("Required Google libraries not installed.")
    logger.error("Please run: pip install -r requirements.txt")
    sys.exit(1)

# Configuration
PORT = 3009
SERVICE_ACCOUNT_FILE = 'service-account.json'
# Default deployment ID for the latest Apps Script deployment
DEFAULT_SCRIPT_ID = '1MgE39XhFyQlvCgVfRpl6bPBO2bmC27W2k5CcuQLb4viF2Uh8QeGnysn9'
DEFAULT_DEPLOYMENT_ID = 'AKfycbwDmUhDPELNRtAD8K0HJcIRflSQsqdtJjZHtnUfdJDlmQEYtN_lx6_T9l6z0L6J5ijTnQ'

SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/script.projects',
    'https://www.googleapis.com/auth/script.processes',
    'https://www.googleapis.com/auth/script.external_request'
]

def get_credentials():
    """Get credentials from service account file."""
    try:
        if not os.path.exists(SERVICE_ACCOUNT_FILE):
            logger.error(f"Service account file not found: {SERVICE_ACCOUNT_FILE}")
            return None

        return service_account.Credentials.from_service_account_file(
            SERVICE_ACCOUNT_FILE, scopes=SCOPES)
    except Exception as e:
        logger.error(f"Error loading credentials: {e}")
        return None

def get_services():
    """Get Google API services."""
    creds = get_credentials()
    if not creds:
        return None

    return {
        'sheets': build('sheets', 'v4', credentials=creds),
        'drive': build('drive', 'v3', credentials=creds),
        'script': build('script', 'v1', credentials=creds)
    }

class MCPHandler(http.server.SimpleHTTPRequestHandler):
    """Handler for OnDeck-V9 MCP requests."""

    def _set_headers(self, status_code=200, content_type='application/json'):
        """Set response headers."""
        self.send_response(status_code)
        self.send_header('Content-type', content_type)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def log_message(self, format, *args):
        """Override to use our logger instead of stderr."""
        logger.info("%s - %s" % (self.address_string(), format % args))

    def do_OPTIONS(self):
        """Handle OPTIONS requests for CORS."""
        self._set_headers(204)

    def do_GET(self):
        """Handle GET requests."""
        parsed_path = urlparse(self.path)
        path = parsed_path.path

        if path == '/health':
            self._set_headers()
            response = {
                'status': 'ok',
                'service_account': os.path.exists(SERVICE_ACCOUNT_FILE),
                'version': '9.0.0',
                'name': 'OnDeck-V9 MCP Server'
            }
            self.wfile.write(json.dumps(response).encode())
            return

        # Default response for unknown paths
        self._set_headers(404)
        response = {'error': 'Not found'}
        self.wfile.write(json.dumps(response).encode())

    def do_POST(self):
        """Handle POST requests."""
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length).decode('utf-8')

        try:
            data = json.loads(post_data)
        except json.JSONDecodeError:
            self._set_headers(400)
            self.wfile.write(json.dumps({'error': 'Invalid JSON'}).encode())
            return

        parsed_path = urlparse(self.path)
        path = parsed_path.path

        # Sheets API endpoints
        if path == '/sheets/read':
            self._handle_sheets_read(data)
        elif path == '/sheets/write':
            self._handle_sheets_write(data)
        elif path == '/sheets/create':
            self._handle_sheets_create(data)

        # Apps Script API endpoints
        elif path == '/script/run':
            self._handle_script_run(data)
        elif path == '/script/logs':
            self._handle_script_logs(data)

        else:
            self._set_headers(404)
            self.wfile.write(json.dumps({'error': 'Not found'}).encode())

    # Sheets API Handlers

    def _handle_sheets_read(self, data):
        """Handle reading from Google Sheets."""
        services = get_services()
        if not services:
            self._set_headers(500)
            self.wfile.write(json.dumps({'error': 'Failed to initialize services'}).encode())
            return

        spreadsheet_id = data.get('spreadsheetId')
        range_name = data.get('range')

        if not spreadsheet_id or not range_name:
            self._set_headers(400)
            self.wfile.write(json.dumps({'error': 'Missing required parameters'}).encode())
            return

        try:
            result = services['sheets'].spreadsheets().values().get(
                spreadsheetId=spreadsheet_id, range=range_name).execute()
            values = result.get('values', [])

            self._set_headers()
            self.wfile.write(json.dumps({'data': values}).encode())
        except Exception as e:
            logger.error(f"Error reading sheets: {e}")
            self._set_headers(500)
            self.wfile.write(json.dumps({'error': str(e)}).encode())

    def _handle_sheets_write(self, data):
        """Handle writing to Google Sheets."""
        services = get_services()
        if not services:
            self._set_headers(500)
            self.wfile.write(json.dumps({'error': 'Failed to initialize services'}).encode())
            return

        spreadsheet_id = data.get('spreadsheetId')
        range_name = data.get('range')
        values = data.get('values')

        if not spreadsheet_id or not range_name or not values:
            self._set_headers(400)
            self.wfile.write(json.dumps({'error': 'Missing required parameters'}).encode())
            return

        try:
            body = {'values': values}
            result = services['sheets'].spreadsheets().values().update(
                spreadsheetId=spreadsheet_id, range=range_name,
                valueInputOption='USER_ENTERED', body=body).execute()

            self._set_headers()
            self.wfile.write(json.dumps({'updated': result.get('updatedCells')}).encode())
        except Exception as e:
            logger.error(f"Error writing to sheets: {e}")
            self._set_headers(500)
            self.wfile.write(json.dumps({'error': str(e)}).encode())

    def _handle_sheets_create(self, data):
        """Handle creating a Google Sheet."""
        services = get_services()
        if not services:
            self._set_headers(500)
            self.wfile.write(json.dumps({'error': 'Failed to initialize services'}).encode())
            return

        title = data.get('title')

        if not title:
            self._set_headers(400)
            self.wfile.write(json.dumps({'error': 'Missing title parameter'}).encode())
            return

        try:
            spreadsheet = {
                'properties': {
                    'title': title
                }
            }
            spreadsheet = services['sheets'].spreadsheets().create(
                body=spreadsheet, fields='spreadsheetId').execute()

            self._set_headers()
            self.wfile.write(json.dumps({'spreadsheetId': spreadsheet.get('spreadsheetId')}).encode())
        except Exception as e:
            logger.error(f"Error creating spreadsheet: {e}")
            self._set_headers(500)
            self.wfile.write(json.dumps({'error': str(e)}).encode())

    # Apps Script API Handlers

    def _handle_script_run(self, data):
        """Handle running an Apps Script function."""
        services = get_services()
        if not services:
            self._set_headers(500)
            self.wfile.write(json.dumps({'error': 'Failed to initialize services'}).encode())
            return

        script_id = data.get('scriptId', DEFAULT_SCRIPT_ID)
        function_name = data.get('function')
        parameters = data.get('parameters', [])
        dev_mode = data.get('devMode', False)

        if not script_id or not function_name:
            self._set_headers(400)
            self.wfile.write(json.dumps({'error': 'Missing required parameters (scriptId, function)'}).encode())
            return

        try:
            # Prepare the request to execute the Apps Script function
            request = {
                'function': function_name,
                'parameters': parameters,
                'devMode': dev_mode
            }

            # Execute the Apps Script function - no deployment lookup, use script ID directly
            logger.info(f"Running script function: {function_name} with params: {parameters}")
            logger.info(f"Using script ID: {script_id}")

            response = services['script'].scripts().run(
                scriptId=script_id,
                body=request
            ).execute()

            # Process the response
            if 'error' in response:
                error = response['error']['details'][0]
                logger.error(f"Script execution error: {error}")
                self._set_headers(400)
                self.wfile.write(json.dumps({
                    'error': error.get('message', 'Unknown script error'),
                    'stack': error.get('scriptStackTraceElements', [])
                }).encode())
                return

            # Return the successful result
            result = None
            if 'response' in response and 'result' in response['response']:
                result = response['response']['result']

            self._set_headers()
            self.wfile.write(json.dumps({
                'success': True,
                'result': result
            }).encode())

        except HttpError as e:
            error_content = json.loads(e.content.decode())
            logger.error(f"HTTP error executing script: {error_content}")
            self._set_headers(e.resp.status)
            self.wfile.write(json.dumps({
                'error': 'Script execution error',
                'details': error_content
            }).encode())
        except Exception as e:
            logger.error(f"Error executing script: {e}")
            self._set_headers(500)
            self.wfile.write(json.dumps({'error': str(e)}).encode())

    def _handle_script_logs(self, data):
        """Handle retrieving Apps Script execution logs."""
        services = get_services()
        if not services:
            self._set_headers(500)
            self.wfile.write(json.dumps({'error': 'Failed to initialize services'}).encode())
            return

        script_id = data.get('scriptId', DEFAULT_SCRIPT_ID)
        start_time = data.get('startTime')
        end_time = data.get('endTime')
        user_id = data.get('userId', 'me')

        if not script_id:
            self._set_headers(400)
            self.wfile.write(json.dumps({'error': 'Missing scriptId parameter'}).encode())
            return

        try:
            request = {
                'scriptId': script_id,
                'pageSize': 50
            }

            if start_time:
                request['startTime'] = start_time
            if end_time:
                request['endTime'] = end_time
            if user_id:
                request['userId'] = user_id

            logger.info(f"Retrieving logs for script: {script_id}")
            response = services['script'].processes().list(**request).execute()

            processes = response.get('processes', [])
            result = []

            for process in processes:
                process_info = {
                    'processId': process.get('processId'),
                    'startTime': process.get('startTime'),
                    'duration': process.get('duration'),
                    'functionName': process.get('functionName'),
                    'status': process.get('processStatus')
                }
                result.append(process_info)

            self._set_headers()
            self.wfile.write(json.dumps({
                'processes': result,
                'nextPageToken': response.get('nextPageToken')
            }).encode())

        except HttpError as e:
            error_content = json.loads(e.content.decode())
            logger.error(f"HTTP error retrieving logs: {error_content}")
            self._set_headers(e.resp.status)
            self.wfile.write(json.dumps({
                'error': 'Error retrieving logs',
                'details': error_content
            }).encode())
        except Exception as e:
            logger.error(f"Error retrieving logs: {e}")
            self._set_headers(500)
            self.wfile.write(json.dumps({'error': str(e)}).encode())

def run_server():
    """Run the MCP server."""
    handler = MCPHandler

    if not os.path.exists(SERVICE_ACCOUNT_FILE):
        logger.warning(f"Service account file '{SERVICE_ACCOUNT_FILE}' not found")
        logger.warning("You'll need to create a service account in Google Cloud Console")
        logger.warning("and download the JSON key file to this directory as 'service-account.json'")
    else:
        logger.info(f"Found service account file: {SERVICE_ACCOUNT_FILE}")

    with socketserver.TCPServer(("", PORT), handler) as httpd:
        logger.info(f"OnDeck-V9 MCP Server running at http://localhost:{PORT}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            logger.info("Server shutting down...")
            httpd.shutdown()

if __name__ == "__main__":
    run_server()
