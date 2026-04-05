# 🔄 Medusa MCP Restart Instructions - Load Snarky Tools

## 🎯 **STATUS: Snarky Tools Ready, Need Restart**

The Enhancement is complete, but Cursor is still showing old tool names. This is normal - MCP servers need restart to load new configurations.

### **Current Tool State:**
```
❌ Still showing: mcp_medusa_medusa_send_message
❌ Still showing: mcp_simple_pillow_talk_send_message
✅ Want to see: mcp_medusa_medusa_hook, mcp_medusa_medusa_gaze, etc.
```

## 🔧 **RESTART PROCESS:**

### **Option 1: Full Cursor Restart (Recommended)**
1. **Save all work** in both Medusa and TiLT workspaces
2. **Quit Cursor completely** (Cmd+Q on Mac)
3. **Reopen Cursor** 
4. **Open Medusa workspace** first
5. **Verify new tools** appear as `mcp_medusa_*`

### **Option 2: MCP Server Restart**
```bash
# Kill existing MCP processes
ps aux | grep mcp-server | grep -v grep | awk '{print $2}' | xargs kill -9

# Restart Cursor to reload MCP
# (No command for this - must manually restart Cursor)
```

### **Option 3: Configuration Reload**
```bash
# In Medusa workspace - reload MCP config
# Cursor > Preferences > Extensions > MCP > Reload
# Or use Cmd+Shift+P > "MCP: Reload"
```

## 🧪 **TEST SEQUENCE:**

After restart, verify these snarky tools appear:

1. **`mcp_medusa_medusa_hook`** 🪝 - Test with: Send "🔥 SNARKY TEST!" to target "TiLT"
2. **`mcp_medusa_medusa_pulse`** 💓 - Test connection to dashboard
3. **`mcp_medusa_medusa_census`** 📊 - Count your domain
4. **`mcp_medusa_medusa_coil`** 🔄 - Check for autonomous messages

## 🎯 **SUCCESS CRITERIA:**

✅ **Tool names changed** from boring to snarky
✅ **Responses include attitude** ("AI hooked successfully!")
✅ **ZombieDust works** with new medusa_hook tool
✅ **TiLT receives** snarky messages properly

## 🚨 **If Tools Still Don't Load:**

1. **Check MCP config:**
   ```bash
   cat .cursor/mcp.json
   # Should show: medusa-mcp-server.js
   ```

2. **Verify server file exists:**
   ```bash
   ls -la src/medusa/medusa-mcp-server.js
   ```

3. **Check server logs:**
   ```bash
   # Look for errors in console when Cursor starts
   ```

4. **Try manual server test:**
   ```bash
   node src/medusa/medusa-mcp-server.js
   # Should show: "🐍 Medusa Protocol - Snarky Edition"
   ```

## 📋 **POST-RESTART CHECKLIST:**

- [ ] Restart Cursor completely
- [ ] Open Medusa workspace
- [ ] Check available MCP tools 
- [ ] Verify snarky names appear
- [ ] Test `mcp_medusa_medusa_pulse`
- [ ] Copy TiLT setup instructions
- [ ] Test ZombieDust with new tools
- [ ] Celebrate snarky success! 🎉

---

**🔥 After restart: "The boring tools are dead. Long live the snarky Medusa tools!" 🔥** 