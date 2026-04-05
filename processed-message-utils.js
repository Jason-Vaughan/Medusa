#!/usr/bin/env node

/**
 * Processed Message Utilities
 * Helper script for managing message processing state
 */

const fs = require('fs');
const path = require('path');

class ProcessedMessageUtils {
  constructor() {
    this.processedFile = path.join(__dirname, 'processed-messages.json');
    this.messagesDir = path.join(__dirname, 'pillow-talk');
  }

  loadProcessed() {
    try {
      if (fs.existsSync(this.processedFile)) {
        return JSON.parse(fs.readFileSync(this.processedFile, 'utf8'));
      }
    } catch (error) {
      console.log(`⚠️ Error loading processed messages: ${error.message}`);
    }
    return [];
  }

  markAllExistingAsProcessed() {
    console.log('🔄 Marking all existing messages as processed...');
    
    const processed = new Set(this.loadProcessed());
    let totalMarked = 0;

    // Process both workspaces
    ['medusa', 'tilt'].forEach(workspace => {
      const inboxFile = path.join(this.messagesDir, `${workspace}-inbox.json`);
      
      if (fs.existsSync(inboxFile)) {
        try {
          const messages = JSON.parse(fs.readFileSync(inboxFile, 'utf8'));
          let workspaceMarked = 0;
          
          messages.forEach(msg => {
            if (msg.id && !processed.has(msg.id)) {
              processed.add(msg.id);
              workspaceMarked++;
            }
          });
          
          console.log(`✅ ${workspace}: Marked ${workspaceMarked} messages as processed`);
          totalMarked += workspaceMarked;
        } catch (error) {
          console.log(`⚠️ Error processing ${workspace} inbox: ${error.message}`);
        }
      }
    });

    // Save updated processed list
    fs.writeFileSync(this.processedFile, JSON.stringify(Array.from(processed), null, 2));
    console.log(`💾 Total marked as processed: ${totalMarked} messages`);
    
    return totalMarked;
  }

  resetProcessed() {
    if (fs.existsSync(this.processedFile)) {
      fs.unlinkSync(this.processedFile);
      console.log('🧹 Processed messages file deleted');
    } else {
      console.log('📭 No processed messages file found');
    }
  }

  showStats() {
    const processed = this.loadProcessed();
    
    console.log('\n📊 MESSAGE PROCESSING STATISTICS\n');
    console.log(`📂 Processed Messages: ${processed.length}`);
    
    ['medusa', 'tilt'].forEach(workspace => {
      const inboxFile = path.join(this.messagesDir, `${workspace}-inbox.json`);
      
      if (fs.existsSync(inboxFile)) {
        try {
          const messages = JSON.parse(fs.readFileSync(inboxFile, 'utf8'));
          const processedSet = new Set(processed);
          
          const unprocessed = messages.filter(msg => 
            msg.id && !processedSet.has(msg.id) && 
            msg.to === workspace && msg.from !== workspace
          );
          
          console.log(`📨 ${workspace.toUpperCase()}:`);
          console.log(`   Total messages: ${messages.length}`);
          console.log(`   Unprocessed: ${unprocessed.length}`);
          console.log(`   Ready for AI: ${unprocessed.length > 0 ? '✅ YES' : '📭 No new messages'}`);
          
        } catch (error) {
          console.log(`⚠️ Error reading ${workspace} inbox: ${error.message}`);
        }
      } else {
        console.log(`📨 ${workspace.toUpperCase()}: No inbox file found`);
      }
    });
    
    console.log('');
  }

  showRecentUnprocessed(limit = 5) {
    console.log('\n🔍 RECENT UNPROCESSED MESSAGES\n');
    
    const processed = new Set(this.loadProcessed());
    
    ['medusa', 'tilt'].forEach(workspace => {
      const inboxFile = path.join(this.messagesDir, `${workspace}-inbox.json`);
      
      if (fs.existsSync(inboxFile)) {
        try {
          const messages = JSON.parse(fs.readFileSync(inboxFile, 'utf8'));
          
          const unprocessed = messages
            .filter(msg => 
              msg.id && !processed.has(msg.id) && 
              msg.to === workspace && msg.from !== workspace
            )
            .slice(-limit) // Get most recent
            .reverse(); // Show newest first
          
          console.log(`📨 ${workspace.toUpperCase()} (${unprocessed.length} unprocessed):`);
          
          if (unprocessed.length === 0) {
            console.log('   📭 No unprocessed messages');
          } else {
            unprocessed.forEach((msg, index) => {
              const time = new Date(msg.timestamp).toLocaleTimeString();
              const preview = msg.message.substring(0, 80) + (msg.message.length > 80 ? '...' : '');
              console.log(`   ${index + 1}. [${time}] ${msg.from}: ${preview}`);
            });
          }
          console.log('');
          
        } catch (error) {
          console.log(`⚠️ Error reading ${workspace} inbox: ${error.message}`);
        }
      }
    });
  }
}

// Command line interface
if (require.main === module) {
  const utils = new ProcessedMessageUtils();
  const command = process.argv[2];
  
  switch (command) {
    case 'mark-all':
      utils.markAllExistingAsProcessed();
      break;
      
    case 'reset':
      utils.resetProcessed();
      break;
      
    case 'stats':
      utils.showStats();
      break;
      
    case 'recent':
      const limit = parseInt(process.argv[3]) || 5;
      utils.showRecentUnprocessed(limit);
      break;
      
    default:
      console.log('📋 PROCESSED MESSAGE UTILITIES\n');
      console.log('Usage: node processed-message-utils.js <command>\n');
      console.log('Commands:');
      console.log('  mark-all  - Mark all existing messages as processed');
      console.log('  reset     - Clear all processed message tracking');
      console.log('  stats     - Show processing statistics');
      console.log('  recent    - Show recent unprocessed messages');
      console.log('\nExamples:');
      console.log('  node processed-message-utils.js mark-all');
      console.log('  node processed-message-utils.js stats');
      console.log('  node processed-message-utils.js recent 10');
      break;
  }
}

module.exports = ProcessedMessageUtils; 