#!/bin/bash

# 🐍 Medusa-MCP Cursor Setup Script
# Automatically configures Cursor MCP integration for Medusa

set -e

echo "🐍 Medusa-MCP Cursor Setup"
echo "=========================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Find Node.js path
NODE_PATH=$(which node)
if [ -z "$NODE_PATH" ]; then
    echo -e "${RED}❌ Node.js not found in PATH${NC}"
    echo "Please install Node.js first: https://nodejs.org/"
    exit 1
fi
echo -e "${GREEN}✅ Found Node.js at: ${NODE_PATH}${NC}"

# Find Medusa installation
MEDUSA_PATH=""
if [ -f "src/medusa/medusa-mcp-server.js" ]; then
    # Local development setup
    MEDUSA_PATH="$(pwd)/src/medusa/medusa-mcp-server.js"
    echo -e "${GREEN}✅ Found local Medusa development setup${NC}"
elif command -v medusa &> /dev/null; then
    # Global installation
    GLOBAL_PATH=$(npm list -g medusa-mcp 2>/dev/null | head -1 | sed 's/.*─ //' | cut -d'@' -f1)
    if [ -n "$GLOBAL_PATH" ]; then
        MEDUSA_PATH="${GLOBAL_PATH}/src/medusa/medusa-mcp-server.js"
        echo -e "${GREEN}✅ Found global Medusa installation${NC}"
    fi
fi

if [ -z "$MEDUSA_PATH" ]; then
    echo -e "${RED}❌ Medusa installation not found${NC}"
    echo "Please install Medusa first:"
    echo "  npm install -g medusa-mcp"
    echo "Or run this script from the Medusa project directory"
    exit 1
fi

# Verify the MCP server file exists
if [ ! -f "$MEDUSA_PATH" ]; then
    echo -e "${RED}❌ MCP server file not found at: ${MEDUSA_PATH}${NC}"
    exit 1
fi

# Make sure it's executable
chmod +x "$MEDUSA_PATH"
echo -e "${GREEN}✅ MCP server file is executable${NC}"

# Create MCP configuration
MCP_CONFIG='{
  "mcpServers": {
    "medusa_mcp": {
      "command": "'$NODE_PATH'",
      "args": ["'$MEDUSA_PATH'"]
    }
  }
}'

# Ask user for setup type
echo ""
echo "Choose setup type:"
echo "1) Project-level (.cursor/mcp.json) - Recommended"
echo "2) Global (~/.cursor/mcp.json)"
echo -n "Enter choice [1-2]: "
read -r SETUP_TYPE

case $SETUP_TYPE in
    1)
        # Project-level setup
        mkdir -p .cursor
        echo "$MCP_CONFIG" > .cursor/mcp.json
        echo -e "${GREEN}✅ Created project-level MCP configuration${NC}"
        echo -e "${BLUE}📁 Configuration saved to: $(pwd)/.cursor/mcp.json${NC}"
        ;;
    2)
        # Global setup
        mkdir -p ~/.cursor
        echo "$MCP_CONFIG" > ~/.cursor/mcp.json
        echo -e "${GREEN}✅ Created global MCP configuration${NC}"
        echo -e "${BLUE}📁 Configuration saved to: ~/.cursor/mcp.json${NC}"
        ;;
    *)
        echo -e "${RED}❌ Invalid choice${NC}"
        exit 1
        ;;
esac

# Test the configuration
echo ""
echo -e "${YELLOW}🧪 Testing MCP server...${NC}"
if echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | "$NODE_PATH" "$MEDUSA_PATH" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ MCP server test successful${NC}"
else
    echo -e "${RED}❌ MCP server test failed${NC}"
    echo "Check the configuration manually"
    exit 1
fi

# Instructions
echo ""
echo -e "${GREEN}🎉 Medusa-MCP setup complete!${NC}"
echo ""
echo "Next steps:"
echo "1. 🔄 Restart Cursor completely (Cmd+Q and reopen)"
echo "2. ⚙️  Go to Cursor Settings (Cmd+,)"
echo "3. 🔧 Navigate to 'MCP' in the left sidebar"
echo "4. 🐍 Find 'medusa_mcp' and toggle it ON"
echo "5. ✅ Verify it shows '6 tools enabled' in green"
echo ""
echo "Test with: 'Use medusa_census to see available AI workspaces'"
echo ""
echo -e "${BLUE}📖 For troubleshooting, see: CURSOR_MCP_GUIDE.md${NC}" 