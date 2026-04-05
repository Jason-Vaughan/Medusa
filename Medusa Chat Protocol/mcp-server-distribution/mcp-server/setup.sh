#!/bin/bash
# OnDeck-V9 MCP Server Setup Script

YELLOW='\033[1;33m'
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Setting up OnDeck-V9 MCP Server...${NC}"

# Create Python virtual environment
echo -e "${YELLOW}Creating Python virtual environment...${NC}"
python3 -m venv venv
source venv/bin/activate

# Install required packages
echo -e "${YELLOW}Installing required Python packages...${NC}"
pip install -r requirements.txt

echo -e "${GREEN}Setup complete!${NC}"
echo 
echo -e "${YELLOW}NEXT STEPS:${NC}"
echo "1. Place your Google service account key file in this directory as 'service-account.json'"
echo "2. Activate the virtual environment: source venv/bin/activate"
echo "3. Start the MCP server: python mcp_server.py"
echo 
echo "To test the server, run: node test_client.js (from the mcp-server directory)" 