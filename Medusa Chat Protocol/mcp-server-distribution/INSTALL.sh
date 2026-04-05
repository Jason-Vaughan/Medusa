#!/bin/bash

# MCP Server Distribution Installation Script
# Version: 9.0.0
# Date: June 26, 2025

set -e  # Exit on any error

YELLOW='\033[1;33m'
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  MCP Server Installation Script v9.0.0${NC}"
echo -e "${BLUE}========================================${NC}"
echo

# Check prerequisites
echo -e "${YELLOW}Checking prerequisites...${NC}"

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js not found. Please install Node.js 16+ first.${NC}"
    echo "   Download from: https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 16 ]; then
    echo -e "${RED}❌ Node.js version $NODE_VERSION is too old. Please install Node.js 16+${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Node.js $(node --version) found${NC}"

# Check Python
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}❌ Python 3 not found. Please install Python 3.8+ first.${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Python 3 found${NC}"

# Check npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm not found. Please install npm first.${NC}"
    exit 1
fi
echo -e "${GREEN}✓ npm $(npm --version) found${NC}"

echo

# Install Node.js dependencies
echo -e "${YELLOW}Installing Node.js dependencies...${NC}"
npm install googleapis@^148.0.0 concurrently@^9.1.2
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Node.js dependencies installed${NC}"
else
    echo -e "${RED}❌ Failed to install Node.js dependencies${NC}"
    exit 1
fi

echo

# Set up Python environment
echo -e "${YELLOW}Setting up Python environment...${NC}"
cd mcp-server

# Create virtual environment
echo "Creating Python virtual environment..."
python3 -m venv venv
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Virtual environment created${NC}"
else
    echo -e "${RED}❌ Failed to create virtual environment${NC}"
    exit 1
fi

# Activate virtual environment and install requirements
echo "Installing Python dependencies..."
source venv/bin/activate
pip install -r requirements.txt
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Python dependencies installed${NC}"
else
    echo -e "${RED}❌ Failed to install Python dependencies${NC}"
    exit 1
fi

cd ..

echo

# Make scripts executable
echo -e "${YELLOW}Setting up executable permissions...${NC}"
chmod +x restart-mcp.sh
chmod +x mcp-server/setup.sh
echo -e "${GREEN}✓ Scripts made executable${NC}"

echo

# Check for service account
echo -e "${YELLOW}Checking for service account configuration...${NC}"
if [ -f "mcp-server/service-account.json" ]; then
    echo -e "${GREEN}✓ Service account file found${NC}"
else
    echo -e "${YELLOW}⚠️  Service account file not found${NC}"
    echo "   You'll need to place your Google service account JSON key file as:"
    echo "   ${BLUE}mcp-server/service-account.json${NC}"
    echo "   See SERVICE_ACCOUNT_SETUP.md for detailed instructions."
fi

echo

# Installation complete
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Installation Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo
echo -e "${YELLOW}Next Steps:${NC}"
echo
echo "1. ${BLUE}Configure Google Service Account:${NC}"
echo "   - Place your service account JSON key as: mcp-server/service-account.json"
echo "   - See SERVICE_ACCOUNT_SETUP.md for detailed instructions"
echo
echo "2. ${BLUE}Start the MCP Server:${NC}"
echo "   ./restart-mcp.sh"
echo
echo "3. ${BLUE}Test the installation:${NC}"
echo "   node test-mock-script.js"
echo
echo "4. ${BLUE}Try the examples:${NC}"
echo "   node examples/create-spreadsheet.js"
echo "   node examples/batch-operations.js"
echo
echo "5. ${BLUE}Access the web interface:${NC}"
echo "   http://localhost:8181"
echo
echo -e "${YELLOW}Useful Commands:${NC}"
echo "  npm start          - Start MCP server"
echo "  npm stop           - Stop MCP server"
echo "  npm test           - Run tests"
echo "  npm run health     - Check server health"
echo
echo -e "${YELLOW}Documentation:${NC}"
echo "  README.md          - Complete setup guide"
echo "  API-REFERENCE.md   - API documentation"
echo "  examples/README.md - Example usage"
echo
echo -e "${GREEN}Happy coding! 🚀${NC}"
