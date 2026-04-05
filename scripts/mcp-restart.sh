#!/bin/bash

# Medusa MCP Connection Restart Script
# Automated fix for stuck MCP servers without closing Cursor

echo "🔄 Medusa MCP Connection Restart"
echo "   Automated fix for stuck MCP servers"
echo ""

# Step 1: Find extension host process
echo "🔍 Finding Cursor extension host process..."
EXTENSION_HOST_PID=$(ps aux | grep "extension-host" | grep -v grep | head -1 | awk '{print $2}')

if [ -z "$EXTENSION_HOST_PID" ]; then
    echo "❌ No extension host process found"
    echo "💡 Make sure Cursor is running and try again"
    exit 1
fi

echo "   ✅ Found extension host (PID: $EXTENSION_HOST_PID)"

# Step 2: Kill extension host process
echo "🔨 Restarting extension host..."
kill $EXTENSION_HOST_PID

if [ $? -eq 0 ]; then
    echo "   ✅ Extension host restarted"
else
    echo "   ❌ Failed to restart extension host"
    exit 1
fi

# Step 3: Instructions
echo ""
echo "🎯 MCP Restart Complete!"
echo "📋 Next steps:"
echo "   1. If Cursor shows 'Extension host terminated' dialog → Click 'Restart Extension Host'"
echo "   2. Go to Cursor Settings → MCP Tools"
echo "   3. Toggle your MCP server OFF then ON"
echo "   4. Should connect immediately (green with tools)"
echo ""
echo "🚀 Much faster than closing/reopening Cursor!"
echo "💡 Alternative: If no dialog appears, toggle OFF → ON manually" 