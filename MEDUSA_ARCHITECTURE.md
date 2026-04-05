# 🐍 Medusa Chat Protocol (MCP) - Architecture Design

## 🎯 **Vision: Two Medusas Communicating with Each Other**

The **Medusa Chat Protocol** replaces Medusa's broken file-based messaging with a **robust MCP server architecture** that enables **AI-to-AI workspace coordination** through Cursor's native MCP integration.

---

## 🏗️ **System Architecture**

### **Core Components**

```
┌─────────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│   Medusa CLI         │    │  Medusa Chat        │    │   Cursor AI         │
│   (Workspace A)     │◄──►│  Protocol Server    │◄──►│   (via MCP)         │
│                     │    │  (Port 3009)        │    │                     │
└─────────────────────┘    └─────────────────────┘    └─────────────────────┘
          ▲                           ▲                          ▲
          │                           │                          │
          ▼                           ▼                          ▼
┌─────────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│   Medusa CLI         │    │  Web Management     │    │   Other Medusa       │
│   (Workspace B)     │    │  Interface          │    │   Workspaces        │
│                     │    │  (Port 8181)        │    │                     │
└─────────────────────┘    └─────────────────────┘    └─────────────────────┘
```

### **Dual Server Architecture (Reference Framework Pattern)**

1. **Medusa Protocol Server** (Port 3009) - **Primary workspace coordination server**
2. **Web Management Interface** (Port 8181) - **Medusa dashboard and testing**
3. **Medusa CLI Clients** - **Multiple workspace instances**
4. **Cursor MCP Integration** - **Direct AI assistant access**

---

## 🔧 **MCP Server Adaptation Plan**

### **Original → Medusa Transformation**

| **Reference Framework**      | **Medusa (Medusa)**                  |
|------------------------------|--------------------------------------|
| Google Sheets API            | **Workspace Registration API**      |
| Apps Script Execution        | **AI Agent Coordination**           |
| Spreadsheet Operations       | **Message Broadcasting**             |
| Service Account Auth         | **Workspace Token Auth**            |
| Sheet Permissions            | **Workspace Access Control**        |
| Mock Functions               | **Mock AI Responses**                |

### **Key Endpoints (Medusa Protocol)**

| **Endpoint**                 | **Method** | **Description**                      |
|------------------------------|------------|--------------------------------------|
| `/health`                    | GET        | Server status & workspace count      |
| `/workspaces/register`       | POST       | Register a new Medusa workspace       |
| `/workspaces/list`           | GET        | List all active workspaces           |
| `/messages/broadcast`        | POST       | Send message to multiple workspaces  |
| `/messages/direct`           | POST       | Send message to specific workspace   |
| `/ai/coordinate`             | POST       | AI agent cross-workspace commands    |
| `/sessions/create`           | POST       | Start coordinated development session|
| `/context/share`             | POST       | Share file/project context           |

---

## 🐍 **Medusa-Specific Features**

### **1. Workspace Registry**
```javascript
// Register workspace with Medusa server
POST /workspaces/register
{
  "name": "TiLT",
  "path": "/Users/jasonvaughan/Documents/Projects/TiLT",
  "type": "beta", // beta, dev, production
  "capabilities": ["ai-integration", "file-sharing", "command-execution"],
  "contact": {
    "cli_port": 9999,
    "pid": 12345
  }
}
```

### **2. AI Coordination**
```javascript
// AI agents communicate across workspaces
POST /ai/coordinate
{
  "from_workspace": "Medusa",
  "to_workspace": "TiLT", 
  "intent": "debug-assistance",
  "context": {
    "files": ["src/spit/framework.js"],
    "error": "Module not found",
    "suggestion": "Check dependency installation"
  }
}
```

### **3. Message Broadcasting**
```javascript
// Send snarky message to all workspaces
POST /messages/broadcast
{
  "from": "Medusa",
  "message": "Hey all you medusaes, time for a deployment!",
  "priority": "high",
  "channels": ["dev", "beta"],
  "intensity_level": 8
}
```

---

## 📡 **Cursor MCP Integration**

### **MCP Tools Available in Cursor**

When Cursor connects to Medusa server, AI assistants get these tools:

```typescript
// Available MCP tools for Cursor AI
{
  "medusa_send_message": {
    "description": "Send a message to another Medusa workspace",
    "parameters": {
      "workspace": "string",
      "message": "string", 
      "priority": "low|normal|high"
    }
  },
  "medusa_list_workspaces": {
    "description": "List all active Medusa workspaces",
    "parameters": {}
  },
  "medusa_share_context": {
    "description": "Share current file context with another workspace",
    "parameters": {
      "workspace": "string",
      "files": "string[]",
      "description": "string"
    }
  },
  "medusa_coordinate": {
    "description": "Request AI assistance from another workspace",
    "parameters": {
      "workspace": "string",
      "intent": "debug|review|deploy|test",
      "context": "object"
    }
  }
}
```

### **Example Cursor AI Usage**

```
User: "Can you ask TiLT workspace to test this new SPiT feature?"

Cursor AI: *uses medusa_coordinate tool*
→ Sends coordination request to TiLT workspace
→ TiLT's AI assistant receives context about the feature
→ TiLT workspace automatically starts testing
→ Results sent back via Medusa protocol
```

---

## 🏗️ **Implementation Structure**

### **Medusa Server Directory**
```
medusa-chat-protocol/
├── server/                    # Main Medusa server
│   ├── medusa-server.js      # Primary server (adapted from simple-local-server.js)
│   ├── workspace-registry.js  # Workspace management
│   ├── message-broker.js     # Message routing
│   └── ai-coordinator.js     # AI agent coordination
├── web/                      # Management interface
│   ├── dashboard.js          # Web UI server (adapted from server.js)
│   └── static/               # Dashboard assets
├── client/                   # Medusa integration
│   ├── medusa-client.js      # Client library (adapted from mcp-client.js)
│   └── medusa-integration.js  # Medusa CLI integration
├── mcp/                      # Cursor MCP integration
│   ├── mcp-tools.json        # Tool definitions
│   └── mcp-handler.js        # MCP protocol handler
├── examples/                 # Usage examples
│   ├── workspace-coordination.js
│   └── ai-assisted-debugging.js
└── scripts/
    ├── start-medusa.sh       # Server management (adapted from restart-mcp.sh)
    └── test-coordination.js  # Full system test
```

---

## 🔄 **Message Flow Architecture**

### **Traditional Medusa (Broken)**
```
Medusa CLI → File Queue → File Conflicts → ❌ FAIL
```

### **Medusa Protocol (Working)**
```
Medusa CLI → Medusa Server → Workspace Registry → Target Workspace ✅
         ↗                ↘
Cursor AI                 Web Dashboard
```

### **AI Coordination Flow**
```
Cursor AI (Workspace A) 
    ↓ (via MCP)
Medusa Server
    ↓ (coordinate request)
Workspace Registry 
    ↓ (route to target)
Cursor AI (Workspace B)
    ↓ (process & respond)
Response → Medusa → Workspace A
```

---

## 🚀 **Implementation Phases**

### **Phase 1: Core Medusa Server** (Next Session)
- [x] Clean up broken Medusa components
- [ ] Build Medusa server using reference framework patterns
- [ ] Create workspace registry system
- [ ] Implement basic message routing
- [ ] Test with two Medusa workspaces

### **Phase 2: Cursor MCP Integration**
- [ ] Create MCP tool definitions for Medusa
- [ ] Implement MCP protocol handler
- [ ] Test Cursor AI → Medusa → Medusa flow
- [ ] Validate AI coordination scenarios

### **Phase 3: Advanced Features**
- [ ] Context sharing between workspaces
- [ ] Session management and persistence
- [ ] Web dashboard for monitoring
- [ ] Multi-workspace broadcasting

---

## 🎯 **Success Criteria**

### **Basic Functionality**
- ✅ **Multiple Medusa workspaces** can register with Medusa server
- ✅ **Messages route reliably** between workspaces (no file conflicts)
- ✅ **Cursor AI** can invoke Medusa commands via MCP
- ✅ **AI agents coordinate** across workspaces automatically

### **Advanced Goals**
- 🎯 **Automatic handoffs** when AI detects cross-workspace needs
- 🎯 **Context sharing** (files, errors, status) between workspaces
- 🎯 **Session persistence** for coordinated development work
- 🎯 **Real-time dashboard** showing all workspace activity

---

## 🐍 **The Medusa Advantage**

### **Why MCP > File-Based Messaging**
1. **No file conflicts** - Server-based routing eliminates "dest already exists"
2. **Real-time coordination** - HTTP/WebSocket instead of file watching
3. **Cursor integration** - Native MCP support in Cursor AI
4. **Scalable architecture** - Add unlimited workspaces
5. **Rich context** - Share complex data structures, not just text
6. **AI-first design** - Built for AI agent coordination

### **Medusa Personality**
- **Two medusas** represent the dual-workspace coordination
- **Communicating with each other** = productive cross-workspace communication
- **Snaky humor** maintained throughout error messages and logs
- **Professional inappropriateness** in all documentation

---

## 📊 **Technical Specifications**

### **Server Requirements**
- **Node.js 18+** (for modern async/await and MCP features)
- **Port 3009** (Medusa Protocol Server)
- **Port 8181** (Web Management Interface) 
- **Memory**: ~50MB per active workspace
- **Storage**: Minimal (workspace registry + session logs)

### **Client Requirements**
- **Medusa v0.4.0+** with Medusa client integration
- **Network access** to Medusa server (localhost or remote)
- **Workspace detection** working (existing Medusa feature)

### **Cursor Integration**
- **Cursor with MCP support** (experimental feature)
- **MCP server configuration** pointing to Medusa server
- **Tool permissions** for workspace coordination

---

## 🎉 **Ready for Medusa Revolution**

The **Medusa Chat Protocol** will transform Medusa from a **broken file-based system** into a **robust AI coordination platform**. The two medusas will finally be able to communicate with each other **properly**! 🐍🔥🐍

**Next**: Implement the core Medusa server using the reference framework patterns as inspiration. 