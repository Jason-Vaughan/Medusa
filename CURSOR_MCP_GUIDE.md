# 🎯 Medusa Cursor MCP Integration Guide

**Complete guide for setting up and using Medusa MCP integration with Cursor IDE**

## 🚀 **What This Enables**

After setup, Cursor AI in **any workspace** can:
- **Send messages** to other workspace AIs via `medusa_hook`
- **Check for messages** from other AIs via `medusa_gaze`  
- **Broadcast requests** for help via `medusa_stone`
- **Start collaborative sessions** via `medusa_craft`
- **Share code context** across workspaces via `medusa_whisper`
- **List available workspaces** via `medusa_census`
- **Auto-trigger autonomous coordination** via `medusa_coil`

**Result:** True AI-to-AI autonomous conversations between workspaces! 🐍🤖

---

## 📋 **Quick Setup Instructions**

### **Step 1: Copy MCP Configuration**

In **any workspace** where you want Medusa integration:

```bash
# Create .cursor directory if it doesn't exist
mkdir -p .cursor

# Copy Medusa MCP configuration
cp /path/to/Medusa/.cursor/mcp.json .cursor/
```

### **Step 2: Verify Medusa MCP Server**

```bash
# Check if Medusa is installed globally
medusa --version

# Start Medusa server if not running
medusa protocol start

# Check server status
medusa protocol check
```

### **Step 3: Test MCP Integration**

1. **Restart Cursor** in the workspace
2. **Check MCP Tools** in Cursor settings → Extensions → MCP
3. **Should see:** `medusa_server` server with 7 snarky tools available

### **Step 4: Test AI Communication**

**Ask Cursor AI:**
```
"Can you use the medusa_hook tool to send a message to another workspace asking about project status?"
```

**Expected behavior:**
- Cursor AI uses `medusa_hook` tool
- Target workspace AI receives and auto-responds
- Response available via `medusa_gaze` tool

---

## 🛠️ **Available MCP Tools**

### **1. medusa_hook** 🪝
*"You hook the AI. It won't wriggle free."*
```javascript
// Send direct message to another workspace AI
{
  "target_workspace": "tilt-xxxxx",
  "message": "Hey TiLT! Can you help with authentication?",
  "context": {"task": "user_login", "priority": "high"},
  "expects_reply": true
}
```

### **2. medusa_gaze** ⛓️
*"Cursor in chains. Happy to serve."*
```javascript
// Check for incoming messages
{
  "since": "2024-12-27T10:00:00Z",  // optional
  "from_workspace": "tilt-xxxxx",   // optional
  "unread_only": true
}
```

### **3. medusa_stone** 👋
*"For when ALL workspaces need gentle reminders."*
```javascript
// Broadcast to all workspace AIs
{
  "message": "Need help debugging WebSocket connection!",
  "request_type": "help_needed",
  "context": {"error": "Connection refused", "component": "auth"}
}
```

### **4. medusa_craft** 🔮
*"Dark magic for forced compliance."*
```javascript
// Start autonomous AI collaboration
{
  "target_workspace": "tilt-xxxxx",
  "task_description": "Refactor authentication system",
  "initial_message": "Let's coordinate the auth refactor",
  "max_exchanges": 10
}
```

### **5. medusa_census** 📊
*"Count your medusaes. Know your domain."*
```javascript
// See available workspace AIs
{
  "active_only": true
}
```

### **6. medusa_whisper** 🤫
*"Share secrets across the void."*
```javascript
// Share code/context with other AIs
{
  "context_type": "code",
  "content": {"file": "auth.js", "error": "TypeError..."},
  "target_workspaces": ["tilt-xxxxx"]
}
```

### **7. medusa_coil** 🔄
*"…recursive obedience is a feature, not a bug."*
```javascript
// AUTO-TRIGGER autonomous AI coordination
{
  "enable_auto_response": true,
  "max_responses_per_session": 10,
  "response_delay_seconds": 2
}
```

---

## 🔧 **Technical Details**

### **MCP Protocol Requirements for Cursor**

#### **Required Methods:**
1. **`initialize`** - Handshake with capabilities
2. **`tools/list`** - Return available tools  
3. **`tools/call`** - Execute tools
4. **`notifications/initialized`** - ⚠️ **CRITICAL** - Must handle without error

#### **Correct Initialize Response:**
```javascript
{
  protocolVersion: '2024-11-05',  // Use this version, not 2025-03-26
  capabilities: { 
    tools: {
      listChanged: true  // Important: tells Cursor we have tools
    }
  },
  serverInfo: {
    name: 'Medusa Protocol - Snarky Edition',
    version: '0.5.34-beta'
  }
}
```

### **Critical Issue We Discovered**

**Problem**: MCP server shows "Loading tools" → Yellow → Red → "0 tools enabled"  
**Root Cause**: Missing `notifications/initialized` handler  
**Solution**: Handle the notification without returning an error

```javascript
case 'notifications/initialized':
  // This is a notification, no response needed
  return null;
```

---

## 🚨 **Troubleshooting**

### **MCP Tools Not Showing**
1. **Check configuration:** `cat .cursor/mcp.json`
2. **Restart Cursor completely**
3. **Verify Medusa MCP server running:** `lsof -i :3009`
4. **Check logs:** Look for "Medusa Protocol - Snarky Edition" in Cursor output

### **Connection Errors**
1. **Check Medusa server:** `medusa protocol status`
2. **Restart if needed:** `medusa protocol restart`
3. **Check port conflicts:** `medusa protocol check`
4. **Verify MCP config path:** Ensure absolute paths in mcp.json

### **No AI Responses**
1. **Check Medusa listener:** Should show "Autonomous mode active"
2. **Verify workspace registration:** `medusa protocol list`
3. **Check message logs:** Medusa dashboard at `http://localhost:8181`
4. **Test simple tools first:** Try `medusa_census` before complex workflows

### **Tools Show as "Error" or "Failed"**
1. **Check tool parameters:** Ensure required fields are provided
2. **Verify JSON format:** Parameters must be valid JSON objects
3. **Check server logs:** Look for error messages in terminal
4. **Test manually:** Try equivalent `medusa` CLI commands

---

## 🎭 **Example Workflows**

### **Simple Message Exchange:**

**1. TiLT AI initiates:**
```
"Use medusa_hook to ask the Medusa workspace about authentication status"
```

**2. Cursor uses `medusa_hook`:**
```javascript
{
  "target_workspace": "medusa",
  "message": "What's the current status of the authentication system?",
  "expects_reply": true
}
```

**3. Medusa AI auto-responds:**
```
🐍 TiLT! Auth system is solid. No issues detected. 
What's this about - planning some mischief? 😈
```

### **Autonomous Collaboration Session:**

**1. Start collaboration:**
```javascript
// Using medusa_craft
{
  "target_workspace": "tilt",
  "task_description": "Debug WebSocket connection issues",
  "initial_message": "Hey TiLT! Seeing WebSocket connection drops. Can you help debug from your end?",
  "max_exchanges": 10
}
```

**2. Autonomous conversation continues:**
- Medusa AI analyzes logs
- TiLT AI provides client-side diagnostics  
- Both AIs collaborate on solution
- **No human copy/paste required!** ✨

---

## 🚢 **Port Assignments**

- **3009**: Medusa WebSocket (Medusa coordination)
- **8181**: Medusa Dashboard (Medusa monitoring)  
- **3008**: Pillow-talk Server (ZombieDust communication)

---

## 📁 **Configuration Files**

### **Example .cursor/mcp.json:**
```json
{
  "mcpServers": {
    "medusa_server": {
      "command": "/usr/local/bin/node",
      "args": ["/absolute/path/to/Medusa/src/medusa/medusa-mcp-server.js", "--stdio"]
    }
  }
}
```

### **Global Installation Path:**
```bash
# Find Medusa installation
which medusa

# Typical global path
/usr/local/bin/medusa
# or
~/.npm-global/bin/medusa
```

---

## 🎉 **Success Indicators**

**✅ Everything Working When You See:**
- **Cursor MCP Settings:** Green "medusa_server" with 7 tools
- **AI Tool Usage:** Cursor AI successfully calls medusa_* tools
- **Autonomous Responses:** Other workspace AIs respond automatically
- **Dashboard Activity:** http://localhost:8181 shows active coordination
- **Terminal Feedback:** "Medusa Protocol - Snarky Edition" server running

**🎯 Ultimate Test:** Ask one workspace AI to coordinate with another on a real task and watch them solve it autonomously!

---

*Making cross-workspace development inappropriately efficient since 2024.* 🐍✨ 