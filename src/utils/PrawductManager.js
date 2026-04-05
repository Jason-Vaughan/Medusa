/**
 * PrawductManager - Automated Prawduct Governance for Medusa
 *
 * Handles chunked workflow, state management, and session wraps.
 * Because even autonomous swarms need structured governance.
 */

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const yaml = require('js-yaml');

class PrawductManager {
  constructor() {
    this.rootPath = path.join(__dirname, '..', '..');
    this.prawductPath = path.join(this.rootPath, '.prawduct');
    this.artifactsPath = path.join(this.prawductPath, 'artifacts');
    this.hooksPath = path.join(this.prawductPath, 'hooks');
    this.stateFile = path.join(this.prawductPath, 'project-state.yaml');
    this.backlogFile = path.join(this.artifactsPath, 'backlog.md');
  }

  /**
   * Run a product hook if it exists
   */
  async runProductHook(hookName) {
    const hookPath = path.join(this.hooksPath, `${hookName}.sh`);
    if (fs.existsSync(hookPath)) {
      console.log(chalk.cyan(`🪝  Running Prawduct hook: ${hookName}...`));
      const { execSync } = require('child_process');
      try {
        execSync(`bash "${hookPath}"`, { stdio: 'inherit', cwd: this.rootPath });
        console.log(chalk.green(`✅ Hook ${hookName} completed.`));
        return true;
      } catch (error) {
        console.error(chalk.red(`❌ Hook ${hookName} failed: ${error.message}`));
        return false;
      }
    }
    return null; // Hook doesn't exist
  }

  /**
   * Start a Prawduct development session
   */
  async startSession() {
    const state = await this.getProjectState();
    if (!state) {
      throw new Error('Could not find project state.');
    }

    console.log(chalk.cyan('🚀 Starting Prawduct Session...'));
    
    // Run start hook
    await this.runProductHook('start');
    
    // Update state
    state.last_chunk_status = "In Progress";
    fs.writeFileSync(this.stateFile, yaml.dump(state));
    
    console.log(chalk.green('✅ Prawduct session started and state updated.'));
  }

  /**
   * Stop a Prawduct development session
   */
  async stopSession() {
    const state = await this.getProjectState();
    if (!state) {
      throw new Error('Could not find project state.');
    }

    console.log(chalk.yellow('🛑 Stopping Prawduct Session...'));
    
    // Run stop hook
    await this.runProductHook('stop');
    
    // Update state
    state.last_chunk_status = "Paused";
    fs.writeFileSync(this.stateFile, yaml.dump(state));
    
    console.log(chalk.green('✅ Prawduct session stopped and state updated.'));
  }

  /**
   * Add a new learning to the project knowledge base
   */
  async addLearning(title, content, tags = []) {
    try {
      const a2aSecret = process.env.A2A_SECRET || 'medusa-please';
      const response = await fetch('http://localhost:3200/a2a/learnings/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Medusa-Secret': a2aSecret
        },
        body: JSON.stringify({ title, content, tags })
      });

      if (!response.ok) {
        throw new Error(`A2A Node responded with ${response.status}`);
      }

      const learning = await response.json();
      console.log(chalk.green(`✅ Learning added: ${learning.title} (${learning.id})`));
      return learning;
    } catch (error) {
      console.error(chalk.red(`❌ Failed to add learning: ${error.message}`));
      // Fallback: save directly to file if A2A is down
      const id = require('uuid').v4();
      const learning = {
        id,
        title,
        content,
        tags,
        timestamp: new Date().toISOString()
      };
      
      const learningsDir = path.join(this.prawductPath, 'learnings');
      if (!fs.existsSync(learningsDir)) {
        fs.mkdirSync(learningsDir, { recursive: true });
      }
      
      fs.writeFileSync(path.join(learningsDir, `${id}.json`), JSON.stringify(learning, null, 4));
      console.log(chalk.yellow(`⚠️  A2A Node unreachable. Saved learning locally to ${id}.json`));
      return learning;
    }
  }
/**
 * Get all learnings from the project knowledge base
 */
async getLearnings() {
  try {
    const a2aSecret = process.env.A2A_SECRET || 'medusa-please';
    const response = await fetch('http://localhost:3200/a2a/learnings/', {
      headers: {
        'X-Medusa-Secret': a2aSecret
      }
    });

    if (!response.ok) {
      throw new Error(`A2A Node responded with ${response.status}`);
    }

    const learnings = await response.json();
    return Array.isArray(learnings) ? learnings : [];
  } catch (error) {
    console.error(chalk.red(`❌ Failed to get learnings from A2A Node: ${error.message}`));
    
    // Fallback: read directly from files
    const learningsDir = path.join(this.prawductPath, 'learnings');
    if (!fs.existsSync(learningsDir)) {
      return [];
    }
    
    const learnings = [];
    const files = fs.readdirSync(learningsDir);
    for (const file of files) {
      if (file.endsWith('.json')) {
        const content = fs.readFileSync(path.join(learningsDir, file), 'utf8');
        learnings.push(JSON.parse(content));
      }
    }
    
    return learnings.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }
}

  /**
   * Perform janitor cleanup for the project
   */
  async performJanitorCleanup(options = {}) {
    console.log(chalk.cyan('🧹 Starting Janitor Cleanup...'));
    
    // Run janitor hook
    await this.runProductHook('janitor');
    
    let cleanedCount = 0;
    
    // 1. Clear stale locks
    try {
      const ProcessLock = require('./ProcessLock');
      const staleCount = await ProcessLock.cleanupStaleLocks();
      if (staleCount > 0) {
        console.log(chalk.green(`   ✅ Cleaned up ${staleCount} stale locks.`));
        cleanedCount += staleCount;
      }
    } catch (error) {
      console.warn(chalk.yellow(`   ⚠️ Failed to clean up locks: ${error.message}`));
    }
    
    // 2. Clear temporary files
    const tempFiles = [
      '.medusa-lock', 
      'medusa-listener.log', 
      'listener.log', 
      'medusa-pipe', 
      'medusa-locks'
    ];
    
    for (const file of tempFiles) {
      const filePath = path.join(this.rootPath, file);
      if (fs.existsSync(filePath)) {
        try {
          if (fs.lstatSync(filePath).isDirectory()) {
            const { execSync } = require('child_process');
            execSync(`rm -rf "${filePath}"`);
          } else {
            fs.unlinkSync(filePath);
          }
          console.log(chalk.green(`   ✅ Nuked ${file}`));
          cleanedCount++;
        } catch (error) {
          console.warn(chalk.yellow(`   ⚠️ Failed to nuke ${file}: ${error.message}`));
        }
      }
    }
    
    // 3. Clear A2A databases if requested
    if (options.nuclear) {
      console.log(chalk.red('   ☢️  NUCLEAR CLEANUP: Clearing A2A databases...'));
      const dbPath = path.join(this.rootPath, 'src', 'a2a_node', 'ledger_3200.db');
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
        console.log(chalk.green('   ✅ Nuked A2A ledger database.'));
        cleanedCount++;
      }
    }
    
    console.log(chalk.magenta(`\n✨ Janitor Cleanup Complete! ${cleanedCount} item(s) slapped.`));
    return cleanedCount;
  }

  /**
   * Get the current project state from project-state.yaml
   */
  async getProjectState() {
    try {
      if (!fs.existsSync(this.stateFile)) {
        return null;
      }
      const content = fs.readFileSync(this.stateFile, 'utf8');
      return yaml.load(content);
    } catch (error) {
      console.error(chalk.red(`❌ Error reading project state: ${error.message}`));
      return null;
    }
  }

  /**
   * Get pending items from the backlog
   */
  async getBacklogItems() {
    try {
      if (!fs.existsSync(this.backlogFile)) {
        return [];
      }
      const content = fs.readFileSync(this.backlogFile, 'utf8');
      const lines = content.split('\n');
      const pendingItems = [];
      let inPendingSection = false;

      for (const line of lines) {
        if (line.includes('## 📥 Pending Items')) {
          inPendingSection = true;
          continue;
        }
        if (line.startsWith('## ') && inPendingSection) {
          inPendingSection = false;
          break;
        }

        if (inPendingSection && line.startsWith('|') && !line.includes('Item | Origin')) {
          const parts = line.split('|').map(p => p.trim());
          if (parts.length >= 6 && parts[1]) {
            pendingItems.push({
              item: parts[1],
              origin: parts[2],
              priority: parts[3],
              status: parts[4],
              description: parts[5]
            });
          }
        }
      }
      return pendingItems;
    } catch (error) {
      console.error(chalk.red(`❌ Error reading backlog: ${error.message}`));
      return [];
    }
  }

  /**
   * Get a summary of the current session work and learnings
   */
  async getSummary() {
    const state = await this.getProjectState();
    const learnings = await this.getLearnings();
    const backlog = await this.getBacklogItems();
    
    return {
      state,
      recentLearnings: learnings.slice(0, 5),
      pendingBacklog: backlog.filter(item => !item.status.includes('Done')).slice(0, 5)
    };
  }

  /**
   * Automate the session wrap protocol
   */
  async performSessionWrap(options = {}) {
    const state = await this.getProjectState();
    if (!state) {
      throw new Error('Could not find project state. Are you in a Prawduct-managed project?');
    }

    const nextChunk = state.last_completed_chunk + 1;
    const date = new Date().toISOString().split('T')[0];
    const filename = `SESSION_WRAP_CHUNK_${nextChunk}_${options.name || 'UPDATE'}.md`;
    const filePath = path.join(this.artifactsPath, filename);

    console.log(chalk.cyan(`📝 Generating Session Wrap for Chunk ${nextChunk}...`));

    const content = `# 🏁 Session Wrap: Chunk ${nextChunk} - ${options.title || 'Implementation Update'}

**Date:** ${date}
**Status:** ✅ Complete

## 🎯 **Mission Status: MISSION ACCOMPLISHED!**
${options.missionSummary || 'Successfully implemented core features for this chunk.'}

---

## ✅ **Completed Work (Chunk ${nextChunk}):**

${options.completedWork || '- Implementation of new features.'}

---

## 🛠️ **Technical Highlights**
${options.technicalHighlights || '- Standard architectural patterns followed.'}

---

## 💡 **Independent Critic Pass (Self-Criticism)**
${options.criticPass || '- No major risks identified during this sprint.'}

---

## 🏗️ **Current State:**
- **Version:** ${require('../../package.json').version}
- **Status:** Chunk ${nextChunk} integrated.

---

## 🔮 **Next Steps:**
${options.nextSteps || '- Continue with next architectural chunk.'}

---

*"Governance isn't just a process; it's the structure that allows the swarm to thrive."* 🐝🪝⛓️🔥 🚀 
`;

    fs.writeFileSync(filePath, content);
    
    // Update state
    state.last_completed_chunk = nextChunk;
    state.last_chunk_status = "Complete";
    state.work_in_progress.chunk = nextChunk + 1;
    state.work_in_progress.status = "Planning";
    
    fs.writeFileSync(this.stateFile, yaml.dump(state));

    console.log(chalk.green(`✅ Session wrap artifact created: ${filename}`));
    console.log(chalk.yellow(`✅ Project state updated to Chunk ${nextChunk}`));

    return filePath;
  }
}

module.exports = PrawductManager;
