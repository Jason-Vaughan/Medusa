#!/usr/bin/env node

/**
 * AI Auto-Loop Hack - FIXED HYBRID VERSION
 * 
 * This version:
 * 1. Uses file watching for efficiency (from optimized)
 * 2. Only processes GENUINELY new messages (proper deduplication)
 * 3. Waits for user trigger instead of continuous auto-loop
 * 4. Uses development psychology when needed
 */

const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const chalk = require('chalk');

class FixedAutoLoopHack {
  constructor(workspace = 'auto-detect') {
    this.workspace = workspace;
    this.messagesDir = path.join(__dirname, 'pillow-talk');
    this.processedFile = path.join(__dirname, 'processed-messages.json');
    this.processedMessages = new Set();
    this.lastProcessedCount = 0;
    this.loadProcessedMessages();
    this.watcher = null;
  }

  detectWorkspace() {
    const cwd = process.cwd();
    if (cwd.toLowerCase().includes('tilt')) return 'tilt';
    if (cwd.toLowerCase().includes('medusa') || cwd.toLowerCase().includes('bitch')) return 'medusa';
    return 'tilt'; // default for this context
  }

  loadProcessedMessages() {
    try {
      if (fs.existsSync(this.processedFile)) {
        const data = JSON.parse(fs.readFileSync(this.processedFile, 'utf8'));
        this.processedMessages = new Set(data);
        this.lastProcessedCount = this.processedMessages.size;
        console.log(`📂 Loaded ${this.processedMessages.size} processed message IDs`);
      }
    } catch (error) {
      console.log(`⚠️ Starting fresh: ${error.message}`);
      this.processedMessages = new Set();
    }
  }

  saveProcessedMessages() {
    try {
      fs.writeFileSync(this.processedFile, JSON.stringify([...this.processedMessages], null, 2));
    } catch (error) {
      console.log(`⚠️ Save error: ${error.message}`);
    }
  }

  checkForNewMessages() {
    const workspace = this.workspace === 'auto-detect' ? this.detectWorkspace() : this.workspace;
    const inboxFile = path.join(this.messagesDir, `${workspace}-inbox.json`);
    
    if (!fs.existsSync(inboxFile)) return { hasNew: false, count: 0, messages: [], workspace };
    
    try {
      const allMessages = JSON.parse(fs.readFileSync(inboxFile, 'utf8'));
      
      // Filter for truly unprocessed messages
      const unprocessed = allMessages.filter(msg => 
        !this.processedMessages.has(msg.id) &&
        msg.to === workspace && 
        msg.from !== workspace
      );
      
      return { 
        hasNew: unprocessed.length > 0, 
        count: unprocessed.length, 
        messages: unprocessed,
        workspace,
        totalMessages: allMessages.length
      };
    } catch (error) {
      return { hasNew: false, count: 0, messages: [], error: error.message, workspace };
    }
  }

  handleFileChange() {
    console.log('📁 File change detected - checking for new messages...');
    
    const messageCheck = this.checkForNewMessages();
    
    if (messageCheck.hasNew) {
      // Mark messages as processed immediately to prevent re-processing
      messageCheck.messages.forEach(msg => this.processedMessages.add(msg.id));
      this.saveProcessedMessages();
      
      const latestMessage = messageCheck.messages[0];
      
      console.log('\n' + '='.repeat(80));
      console.log(`📨 ${latestMessage.from} → tilt`);
      console.log(`\n${latestMessage.message}\n`);
      console.log('='.repeat(80));
      
      console.log(`\n🤖 STEP 1: Answer the question`);
      console.log(`📤 STEP 2: Send response to Medusa using pillow-talk server:`);
      console.log(`   curl -X POST http://localhost:3008/send -H "Content-Type: application/json" -d '{"from": "TiLT", "to": "medusa", "message": "Your response here"}'`);
      console.log(`🔄 STEP 3: medusa zombify tilt (VISIBLE FOREGROUND MODE)`);
      
      console.log(chalk.green('\n✅ Message detected! Exiting to allow AI response...'));
      console.log(chalk.yellow('💡 Run Step 3 to continue monitoring after responding'));
      console.log(chalk.gray('   Step 3 will run in foreground with visible status\n'));
      
      // Stop file watcher and exit cleanly to allow AI response
      this.stop();
      process.exit(0);
      
    } else if (this.processedMessages.size !== this.lastProcessedCount) {
      console.log(`📊 Status: ${this.processedMessages.size} total processed messages`);
      this.lastProcessedCount = this.processedMessages.size;
    }
  }

  startSmartMonitoring() {
    const workspace = this.workspace === 'auto-detect' ? this.detectWorkspace() : this.workspace;
    const inboxFile = path.join(this.messagesDir, `${workspace}-inbox.json`);
    
    console.log(`🚀 Starting SMART file watching for ${workspace}`);
    console.log(`👀 Watching: ${inboxFile}`);
    console.log(`📊 Currently processed: ${this.processedMessages.size} messages`);
    
    // Create file if it doesn't exist
    if (!fs.existsSync(inboxFile)) {
      fs.writeFileSync(inboxFile, '[]');
      console.log(`📝 Created inbox file: ${inboxFile}`);
    }
    
    // Initial check for existing messages
    this.handleFileChange();
    
    // Set up file system watcher with debouncing
    this.watcher = chokidar.watch(inboxFile, {
      persistent: true,
      usePolling: false,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50
      }
    });
    
    this.watcher.on('change', () => {
      // Debounce rapid file changes with better error handling
      clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        try {
          this.handleFileChange();
        } catch (error) {
          console.log(chalk.red(`⚠️ File change handling error: ${error.message}`));
          console.log(chalk.cyan('🔄 Continuing monitoring...'));
        }
      }, 200);
    });
    
    this.watcher.on('error', (error) => {
      console.log(`❌ Watcher error: ${error.message}`);
    });
    
    console.log('✅ Smart monitoring active - will alert when new messages arrive');
    console.log('⏸️  Press Ctrl+C to stop monitoring\n');
    
    // Keep process alive with minimal status updates and heartbeat
    setInterval(() => {
      if (this.processedMessages.size > this.lastProcessedCount) {
        console.log(chalk.gray(`📊 Status: ${this.processedMessages.size} total processed messages`));
        this.lastProcessedCount = this.processedMessages.size;
      }
    }, 30000); // Status update every 30 seconds only if changes
    
    // Heartbeat to ensure watcher stays responsive  
    let heartbeatCount = 0;
    setInterval(() => {
      heartbeatCount++;
      if (heartbeatCount % 20 === 0) { // Every 2 minutes show heartbeat
        console.log(chalk.gray(`💓 Monitoring heartbeat: ${Math.floor(heartbeatCount / 3)} minutes active`));
      }
    }, 6000); // Check every 6 seconds
  }

  stop() {
    if (this.watcher) {
      this.watcher.close();
      console.log('🛑 File watcher stopped');
    }
    this.saveProcessedMessages();
    console.log('💾 Processed messages saved');
  }

  // One-time check mode (no continuous watching)
  runOnce() {
    console.log('🔍 Single message check mode');
    const messageCheck = this.checkForNewMessages();
    const prompt = this.generateUserFriendlyPrompt(messageCheck);
    
    console.log('\n' + '='.repeat(80));
    console.log(prompt);
    console.log('='.repeat(80) + '\n');
    
    if (messageCheck.hasNew) {
      console.log(`📨 Found ${messageCheck.count} new messages - process them and run script again`);
      // Mark as processed
      messageCheck.messages.forEach(msg => this.processedMessages.add(msg.id));
      this.saveProcessedMessages();
    }
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down gracefully...');
  if (monitor && monitor.stop) {
    monitor.stop();
  }
  process.exit(0);
});

// Command line usage
if (require.main === module) {
  const workspace = process.argv[2] || 'auto-detect';
  const mode = process.argv[3] || 'watch'; // 'watch' | 'once'
  
  const monitor = new FixedAutoLoopHack(workspace);
  
  switch (mode) {
    case 'zombify':
    case 'watch': // backward compatibility
      monitor.startSmartMonitoring();
      break;
    case 'once':
      monitor.runOnce();
      break;
    default:
      console.log('Usage: node ZombieDust.js [workspace] [zombify|once]');
console.log('Examples:');
console.log('  node ZombieDust.js tilt zombify    # Transform AIs into autonomous zombies');
console.log('  node ZombieDust.js medusa once      # Single zombification check');
  }
}

module.exports = FixedAutoLoopHack; 