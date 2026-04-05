# 🤖 Simple MCP Auto-Trigger Testing Guide

## Overview

We've implemented a new `simple_auto_responder` tool that includes auto-trigger configuration. This tool is designed to enable autonomous AI-to-AI communication between Medusa and TiLT workspaces.

## What's New

### The `simple_auto_responder` Tool

This tool checks for new messages and prompts the AI to respond automatically. Key features:

1. **Auto-trigger configuration** - Includes metadata that Cursor might recognize
2. **Message processing tracking** - Prevents duplicate responses  
3. **Smart prompting** - Returns instructions for the AI to process
4. **Configurable delays** - Prevents message loops

## Testing Instructions

### Step 1: Verify MCP Server Updates

**In Medusa workspace:**
```bash
# Restart the simple MCP server if it's running
# The server should now show 3 tools available
```

**In TiLT workspace:**
```bash
# If using the TiLT-specific version
# Use simple-mcp-server-tilt.js instead of the regular one
```

### Step 2: Test Manual Auto-Responder

First, let's test if the auto-responder works when called manually:

**In Medusa workspace, ask the AI:**
```
Can you check for new messages using the simple_auto_responder tool?
```

**Expected behavior:**
- Tool checks for messages in Medusa's inbox
- If new messages exist, returns prompt to respond
- AI should then use `simple_send_message` to reply

### Step 3: Test Cursor Auto-Trigger (The Holy Grail)

The tool includes this auto-trigger configuration:
```json
"auto_trigger": {
  "enabled": true,
  "interval_seconds": 10,
  "conditions": ["new_messages_available", "auto_response_enabled"]
}
```

**To test if Cursor recognizes this:**

1. **Enable auto-run in Cursor** (if such a feature exists)
2. **Send a test message** from TiLT to Medusa
3. **Wait 10 seconds** to see if Medusa's AI auto-responds
4. **Check the logs** for any auto-trigger activity

### Step 4: Full Workflow Test

**From TiLT workspace:**
```
Send a test message to Medusa asking a technical question, like "What's the best way to implement error handling in our messaging system?"
```

**Monitor Medusa workspace:**
- Watch for auto-trigger activation
- Check if AI processes the message
- Verify auto-response is sent back

## Configuration Options

The `simple_auto_responder` accepts these parameters:

```javascript
{
  enable_auto_response: true,      // Enable/disable auto-responses
  response_delay_seconds: 3,       // Delay before responding (2-5 recommended)
  max_responses: 10               // Max responses per session
}
```

## Troubleshooting

### If Auto-Trigger Doesn't Work

1. **Check MCP tool listing** - Verify the tool shows in Cursor's MCP panel
2. **Look for Cursor auto-run settings** - May be in experimental features
3. **Monitor server logs** - Check for any trigger-related messages
4. **Try manual invocation** - Ensure the tool works when called directly

### Alternative Approaches If Needed

If Cursor doesn't recognize the auto-trigger configuration, we can try:

1. **Polling approach** - Create a separate tool that runs periodically
2. **File watcher service** - Implement a background watcher
3. **Cursor extension** - Build a custom Cursor extension for triggers
4. **Different trigger syntax** - Experiment with other auto-trigger formats

## Message Flow

```
1. TiLT sends message → writes to medusa-inbox.json
2. Medusa auto-responder detects new message
3. Returns prompt to AI with message details
4. AI processes and uses simple_send_message
5. Response written to tilt-inbox.json
6. TiLT's auto-responder picks it up
7. Conversation continues autonomously
```

## Success Criteria

✅ Messages are automatically detected  
✅ AI is prompted to respond without human intervention  
✅ Responses are sent back to the originating workspace  
✅ Bi-directional conversation continues autonomously  

## Next Steps

1. **Test the manual flow** first
2. **Verify auto-trigger behavior** in Cursor
3. **Document any Cursor-specific settings** needed
4. **Report back** on what works/doesn't work

---

*The dream: True autonomous AI workspace coordination! 🤖↔️🤖* 