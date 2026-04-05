# MCP Server Restart Workflow

## Problem
Cursor MCP servers sometimes get stuck in a "Client closed" or red state, typically requiring a full Cursor restart to fix.

## Solution: Extension Host Restart Method

### Steps:
1. **Toggle MCP server OFF** in Cursor Settings → MCP Tools
2. **Find and kill the extension host process**:
   ```bash
   ps aux | grep "extension-host" | grep -v grep
   kill <extension-host-pid>
   ```
3. **Toggle MCP server ON** in Cursor Settings
   - **Note**: May require 2 attempts
   - First attempt: Shows "Loading tools" then fails (red)
   - Second attempt: Should connect successfully (green)

### Alternative Methods Tested (Less Reliable):
- `npx clear-npx-cache` - Sometimes works but inconsistent
- MCP config file modification - Doesn't seem effective
- Process signals (USR1) - No effect

### Key Insight:
The MCP toggle state matters! Always turn OFF before attempting any fix, then turn back ON.

### Time Savings:
- Old method: Close/reopen Cursor (~30-60 seconds)
- New method: Extension host restart (~10-15 seconds)

### When to Use:
- MCP server shows red status
- "Client closed" errors
- MCP tools not responding
- After Medusa Medusa server restarts that break MCP connectivity

## Tested On:
- macOS Sonoma 24.3.0
- Cursor v1.1.6
- Medusa MCP Server integration 