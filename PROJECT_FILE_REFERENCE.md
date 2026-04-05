# 📁 Medusa Project File Reference

## 🎯 **CORE EXECUTABLE FILES**

| File | Purpose | Usage |
|------|---------|--------|
| `/bin/medusa.js` | Main CLI entry point | Global command execution |
| `/bin/verify-version.js` | Version compatibility checker | Internal version validation |
| `/src/index.js` | Main application module | Core functionality export |
| `/ZombieDust.js` | Autonomous monitoring system | `node ZombieDust.js <workspace> zombify` |

## 🐍 **MEDUSA CHAT PROTOCOL**

| File | Purpose | Usage |
|------|---------|--------|
| `/src/medusa/medusa-server.js` | Core Medusa Protocol server | Main coordination server |
| `/src/medusa/medusa-mcp-server.js` | MCP integration server | Model Context Protocol bridge |
| `/src/medusa/dashboard.js` | Web dashboard backend | Dashboard API endpoints |
| `/src/medusa/dashboard.html` | Web dashboard UI | Browser-based monitoring |
| `/src/medusa/MedusaListener.js` | Message listener service | Real-time message detection |
| `/src/medusa/client/MedusaClient.js` | Client connection handler | Workspace communication |

## 🗣️ **MESSAGING SYSTEM**

| File | Purpose | Usage |
|------|---------|--------|
| `/pillow-talk-server.js` | Lightweight message server | Port 3008 messaging backend |
| `/pillow-talk/medusa-inbox.json` | Medusa message storage | Incoming message queue |
| `/pillow-talk/tilt-inbox.json` | TiLT message storage | Outgoing message queue |
| `/processed-message-utils.js` | Message processing utilities | Message handling functions |
| `/processed-messages.json` | Message processing log | Processed message tracking |

## ⚡ **CORE MODULES**

| File | Purpose | Usage |
|------|---------|--------|
| `/src/daemon/MedusaDaemon.js` | Background service manager | Daemon process control |
| `/src/daemon/DaemonClient.js` | Client connection handler | Client-server communication |
| `/src/config/ConfigManager.js` | Configuration management | Settings and preferences |
| `/src/workspace/WorkspaceDetector.js` | Workspace identification | Cursor workspace detection |
| `/src/utils/ProcessLock.js` | Process synchronization | Prevent multiple instances |
| `/src/utils/ErrorHandler.js` | Error management system | Standardized error handling |
| `/src/utils/HelpSystem.js` | CLI help generation | Dynamic help content |
| `/src/utils/MedusaNotifier.js` | System notifications | Cross-platform notifications |

## 🤖 **AI INTEGRATION & A2A NODE**

| File | Purpose | Usage |
|------|---------|--------|
| `/src/ai/AIAgentHook.js` | AI provider integration | Multi-provider AI coordination |
| `/ai-config.example.js` | AI configuration template | User AI setup example |
| `/src/a2a_node/main.py` | Python A2A Node entry point | Core A2A coordination service |
| `/src/a2a_node/app/api/` | A2A API endpoints | Gossip, tasks, and discovery |
| `/src/a2a_node/app/core/` | A2A core logic | Heuristics, decomposition, execution |
| `/src/a2a_node/app/models/` | A2A data models | SQLAlchemy ledger definitions |
| `/src/a2a_node/alembic.ini` | Database migration config | SQLAlchemy migration setup |

## 📋 **CONFIGURATION FILES**

| File | Purpose | Usage |
|------|---------|--------|
| `/package.json` | NPM package definition | Dependencies and metadata |
| `/medusa.config.js` | Medusa configuration | Application settings |
| `/.cursor/mcp.json` | Cursor MCP configuration | MCP server setup |
| `/.medusa-rule.mdc` | Cursor development rules | AI development guidance |

## 📚 **DOCUMENTATION**

### **Core Documentation**
| File | Purpose | Usage |
|------|---------|--------|
| `/README.md` | Main project documentation | User and developer guide |
| `/LICENSE` | Project license | Legal usage terms |
| `/RELEASE_NOTES.md` | Version change log | Release history |
| `/RELEASE_TRACKER.md` | Release tracking | Version status |

### **Development Guides**
| File | Purpose | Usage |
|------|---------|--------|
| `/CURSOR_MCP_GUIDE.md` | MCP setup instructions | Cursor integration guide |
| `/MEDUSA_SIMPLE_MCP_DEVELOPMENT_GUIDE.md` | MCP development guide | Developer reference |
| `/OPTIMIZED_AI_SYSTEM_GUIDE.md` | AI system documentation | AI integration guide |
| `/SIMPLE_MCP_AUTO_TRIGGER_TESTING_GUIDE.md` | Testing procedures | Automated testing guide |

### **Architecture Documentation**
| File | Purpose | Usage |
|------|---------|--------|
| `/MEDUSA_ARCHITECTURE.md` | System architecture | Technical overview |
| `/MEDUSA_PREP_PLAN.md` | Implementation planning | Development roadmap |
| `/PORT_REGISTRY.md` | Port allocation guide | Service port management |

### **Process Documentation**
| File | Purpose | Usage |
|------|---------|--------|
| `/MEDUSA_PROJECT_ROADMAP.md` | Project roadmap | Future development plans |
| `/MEDUSA_MCP_IMPLEMENTATION_PLAN.md` | MCP implementation | Technical implementation |
| `/MEDUSA_MCP_RESTART_INSTRUCTIONS.md` | MCP restart procedures | Operational instructions |
| `/MEDUSA_SNARKY_NAMING_CONVENTION.md` | Naming conventions | Code style guide |
| `/MEDUSA_MCP_SNARKY_STATUS.md` | Status reporting | System status guide |
| `/MCP_RESTART_WORKFLOW.md` | Restart workflow | Operational procedures |

## 🔧 **SCRIPTS & UTILITIES**

| File | Purpose | Usage |
|------|---------|--------|
| `/scripts/check-ports.sh` | Port availability checker | Pre-startup validation |
| `/scripts/mcp-restart.sh` | MCP restart automation | Service management |
| `/scripts/setup-cursor-mcp.sh` | Cursor MCP setup | Installation script |

## 🗄️ **REFERENCE FILES**

### **MCP Distribution**
| Directory | Purpose | Usage |
|-----------|---------|--------|
| `/Medusa Chat Protocol/` | MCP reference implementation | Framework patterns |
| `/Medusa Chat Protocol/mcp-server-distribution/` | Complete MCP server | Reference architecture |

### **Session Management**
| File | Purpose | Usage |
|------|---------|--------|
| `/SESSION_WRAP_ZOMBIEDUST_ENHANCED_MONITORING_FIX_AND_MASSIVE_REPOSITORY_CLEANUP.md` | Previous session documentation | Session handoff context |

## 🎨 **ASSETS**

| File | Purpose | Usage |
|------|---------|--------|
| `/src/medusa/medusa-logo.png` | Medusa logo (PNG) | Dashboard branding |
| `/src/medusa/medusa-logo.svg` | Medusa logo (SVG) | Scalable branding |
| `/medusa-dashboard-screenshot.png` | Dashboard screenshot | Documentation visual |

## 🏗️ **WORKSPACE CONFIGURATION**

| File | Purpose | Usage |
|------|---------|--------|
| `/Medusa.code-workspace` | VS Code workspace | Development environment |
| `/.gitignore` | Git ignore rules | Version control exclusions |

## 🗑️ **RECENTLY REMOVED FILES**

These files were cleaned up in recent technical debt cleanup:
- `.DS_Store` - macOS system file
- `simple-mcp-server-OLD.js.textClipping` - Obsolete text clipping
- `src/medusa/mcp-debug.log` - Old debug log
- `src/medusa/medusa-server.js.working-backup-20250626` - Outdated backup
- `ai-monitor-prompt.md` - Temporary AI prompt file
- `LOGO_REPLACEMENT_INSTRUCTIONS.md` - One-time setup instructions
- `AUTOMATED_DEV_CYCLE_PLAN.md` - Aspirational planning document

---

## 🎯 **FILE ORGANIZATION PRINCIPLES**

### **Directory Structure Logic**
- `/src/` - Core application code
- `/bin/` - Executable scripts
- `/scripts/` - Utility scripts
- `/pillow-talk/` - Message storage
- `/.cursor/` - Cursor IDE configuration
- `/Medusa Chat Protocol/` - Reference implementation

### **Naming Conventions**
- `MEDUSA_*` - Medusa-specific documentation
- `MEDUSA_*` - Medusa Protocol documentation
- `SESSION_WRAP_*` - Session handoff files
- `*_GUIDE.md` - User/developer guides
- `*_PLAN.md` - Planning and roadmap documents

### **File Lifecycle**
- **Active Development:** Core `/src/` files
- **Documentation:** Comprehensive `.md` files
- **Configuration:** Various config files
- **Temporary:** Session wraps (cleaned periodically)
- **Reference:** MCP distribution (inspiration only)

---

*🐍 "Every file has a purpose, every purpose has a file - except the ones we deleted because they were working about being obsolete!" 🗂️*

**Generated by Medusa File Reference System**  
*"Making file organization inappropriately organized since 2025"* 