#!/usr/bin/env node

/**
 * Medusa - Multi-Environment Development Unified Session Architecture
 *
 * A CLI tool for developers who are tired of copy/paste relay hell
 * between multiple Cursor workspaces.
 *
 * Built with love, snark, and an unhealthy obsession with inappropriate humor.
 */

const { Command } = require('commander');
const chalk = require('chalk');
const figlet = require('figlet');
const packageJson = require('../package.json');

// Import our helpful modules
const ConfigManager = require('./config/ConfigManager');
// MessageQueue removed - replaced by Medusa Chat Protocol
const WorkspaceDetector = require('./workspace/WorkspaceDetector');
const MedusaNotifier = require('./utils/MedusaNotifier');
const MedusaWizard = require('./wizard/MedusaWizard');
const { MedusaError, handleMedusaError } = require('./utils/ErrorHandler');
const CursorRCPClient = require('./utils/CursorRCPClient');
const MedusaDaemon = require('./daemon/MedusaDaemon');
const DaemonClient = require('./daemon/DaemonClient');
const HelpSystem = require('./utils/HelpSystem');

const program = new Command();

// Configure the CLI with maximum snark
program
  .name('medusa')
  .description('Multi-Environment Development Unified Session Architecture\n' +
               'A development-sidekick CLI tool for yelling at your other workspace so you don\'t have to.')
  .version(packageJson.version, '-v, --version', 'Show Medusa version (and your commitment to style)')
  .helpOption('-h, --help', 'Show this helpful help message');

// Add some personality to the help
program.configureHelp({
  sortSubcommands: true,
  subcommandTerm: (cmd) => cmd.name() + ' ' + cmd.usage(),
});

/**
 * Display the Medusa banner because we're extra like that
 */
function showBanner() {
  const configManager = new ConfigManager();
  const config = configManager.getEnhancedConfig();

  console.log(chalk.magenta(figlet.textSync('MEDUSA', {
    font: 'isometric3',
    horizontalLayout: 'default',
    verticalLayout: 'default'
  })));
  console.log(chalk.gray('Multi-Environment Development Unified Session Architecture'));
  
  // Show a random CLI quote if available
  if (config.cliQuotes && config.cliQuotes.length > 0) {
    const randomQuote = configManager.getRandomCliQuote();
    console.log(chalk.yellow(`${randomQuote}\n`));
  } else {
    console.log(chalk.yellow('Because copy/paste is for peasants\n'));
  }
}

/**
 * Setup command - Initialize the Connection
 */
program
  .command('setup')
  .alias('init')
  .description('Initialize your Connection configuration (required before coordinating)')
  .option('--dev <workspace>', 'Define the DEV workspace name')
  .option('--beta <workspace>', 'Define the BETA workspace name')
  .option('--force', 'Force reconfiguration (for when you need to change your status)')
  .option('--wizard', 'Use the interactive Medusa Wizard (recommended for first-time setup)')
  .action(async (options) => {
    try {
      if (options.wizard) {
        const wizard = new MedusaWizard();
        await wizard.startWizard();
        return;
      }

      showBanner();
      console.log(chalk.cyan('🔧 Setting up your Connection...\n'));

      const configManager = new ConfigManager();
      await configManager.initializeConnection(options);

      console.log(chalk.green('✅ Connection established successfully!'));
      console.log(chalk.yellow('You can now start coordinating properly. Try: medusa status'));
    } catch (error) {
      handleMedusaError(error);
    }
  });

/**
 * Wizard command - Interactive setup experience
 */
program
  .command('wizard')
  .description('Launch the interactive Medusa Wizard for guided setup')
  .action(async () => {
    try {
      const wizard = new MedusaWizard();
      await wizard.startWizard();
    } catch (error) {
      handleMedusaError(error);
    }
  });

/**
 * Status command - Check the current status
 */
program
  .command('status')
  .alias('wtf')
  .description('Show current Connection status and workspace status')
  .action(async () => {
    try {
      const configManager = new ConfigManager();
      const workspaceDetector = new WorkspaceDetector();

      console.log(chalk.cyan('📊 Current Status:\n'));

      const config = await configManager.getMedusaConfig();
      const workspaces = await workspaceDetector.getActiveWorkspaces();

      if (!config) {
        console.log(chalk.red('❌ No Connection configured!'));
        console.log(chalk.yellow('Run: medusa setup --dev <name> --beta <name>'));
        return;
      }

      console.log(chalk.green(`💕 Connection: ${config.dev} ↔ ${config.beta}`));
      console.log(chalk.blue(`🏠 Current workspace: ${workspaces.current || 'Unknown'}`));
      console.log(chalk.magenta(`🔍 Active workspaces: ${workspaces.active.join(', ') || 'None detected'}`));

      // Check message queue status
      const messageQueue = new MessageQueue();
      const unreadCount = await messageQueue.getUnreadCount();

      if (unreadCount > 0) {
        console.log(chalk.yellow(`📬 You have ${unreadCount} unread messages!`));
        console.log(chalk.gray('Run: medusa read'));
      } else {
        console.log(chalk.green('📭 No pending messages (surprisingly peaceful)'));
      }

    } catch (error) {
      handleMedusaError(error);
    }
  });

/**
 * Daemon start command
 */
program
  .command('daemon-start')
  .description('Start the Medusa daemon service')
  .option('--port <port>', 'TCP port for daemon', '9999')
  .option('--workspace <name>', 'Workspace name for this daemon')
  .action(async (options) => {
    try {
      const workspaceDetector = new WorkspaceDetector();
      const workspace = options.workspace || await workspaceDetector.getCurrentWorkspace();

      console.log(chalk.cyan(`🚀 Starting Medusa daemon for workspace: ${workspace}`));

      // Check if daemon is already running
      const status = await DaemonClient.isDaemonRunning();
      if (status.running) {
        console.log(chalk.yellow(`⚠️  Daemon already running with PID ${status.pid}`));
        console.log(chalk.blue('💡 Use "medusa daemon-stop" to stop it first'));
        return;
      }

      const daemon = new MedusaDaemon({
        port: parseInt(options.port),
        workspace: workspace
      });
      
      await daemon.start();
      
      // Keep the process running
      console.log(chalk.green('✅ Daemon started successfully!'));
      console.log(chalk.gray('Press Ctrl+C to stop the daemon'));
      
      // Handle graceful shutdown
      process.on('SIGINT', async () => {
        console.log(chalk.yellow('\n🛑 Shutting down daemon...'));
        await daemon.shutdown();
      });
      
    } catch (error) {
      handleMedusaError(error);
      process.exit(1);
    }
  });

/**
 * Daemon stop command
 */
program
  .command('daemon-stop')
  .description('Stop the Medusa daemon service')
  .action(async () => {
    try {
      console.log(chalk.cyan('🛑 Stopping Medusa daemon...'));

      const status = await DaemonClient.isDaemonRunning();
      if (!status.running) {
        console.log(chalk.yellow('⚠️  No daemon running'));
        return;
      }
      
      // Send SIGTERM to daemon process
      try {
        process.kill(status.pid, 'SIGTERM');
        console.log(chalk.green(`✅ Sent stop signal to daemon (PID ${status.pid})`));
        
        // Wait a bit and check if it stopped
        setTimeout(async () => {
          const newStatus = await DaemonClient.isDaemonRunning();
          if (!newStatus.running) {
            console.log(chalk.green('✅ Daemon stopped successfully'));
          } else {
            console.log(chalk.yellow('⚠️  Daemon still running, forcing stop...'));
            process.kill(status.pid, 'SIGKILL');
          }
        }, 2000);
        
      } catch (error) {
        console.log(chalk.red(`❌ Failed to stop daemon: ${error.message}`));
      }
      
    } catch (error) {
      handleMedusaError(error);
    }
  });

/**
 * Daemon status command
 */
program
  .command('daemon-status')
  .description('Show daemon status and information')
  .action(async () => {
    try {
      console.log(chalk.cyan('📊 Medusa Daemon Status:\n'));

      const status = await DaemonClient.isDaemonRunning();
      
      if (status.running) {
        console.log(chalk.green('✅ Daemon is running'));
        console.log(chalk.white(`   PID: ${status.pid}`));
        
        // Try to get detailed status from daemon
        try {
          const client = new DaemonClient();
          const detailedStatus = await client.getStatus();
          await client.disconnect();
          
          console.log(chalk.white(`   Workspace: ${detailedStatus.workspace}`));
          console.log(chalk.white(`   Uptime: ${Math.floor(detailedStatus.uptime / 1000)}s`));
          console.log(chalk.white(`   Connections: ${detailedStatus.connections}`));
          console.log(chalk.white(`   TCP Port: ${detailedStatus.ports.tcp}`));
          console.log(chalk.white(`   WebSocket Port: ${detailedStatus.ports.websocket}`));
          console.log(chalk.white(`   Named Pipe: ${detailedStatus.pipePath}`));
          console.log(chalk.white(`   Log File: ${detailedStatus.logFile}`));
          
        } catch (error) {
          console.log(chalk.yellow(`⚠️  Could not get detailed status: ${error.message}`));
        }
        
      } else {
        console.log(chalk.red('❌ Daemon is not running'));
        console.log(chalk.blue('💡 Start it with: medusa daemon-start'));
      }

    } catch (error) {
      handleMedusaError(error);
    }
  });

/**
 * Send command - Send a message (enhanced with daemon support)
 */
program
  .command('send')
  .description('Send a message to your other workspace')
  .requiredOption('--to <workspace>', 'Target workspace (dev/beta)')
  .requiredOption('--msg <message>', 'Your message')
  .option('--priority', 'Mark as high priority (for when shit hits the fan)')
  .option('--tag <tag>', 'Add a tag to categorize your coordinating')
  .action(async (options) => {
    try {
      const workspaceDetector = new WorkspaceDetector();
      const currentWorkspace = await workspaceDetector.getCurrentWorkspace();
      
      console.log(chalk.cyan(`📤 Sending message to ${options.to}...`));

      // Try daemon first
      try {
        const client = new DaemonClient({ workspace: currentWorkspace });
        const result = await client.send(options.to, options.msg, {
          priority: options.priority || false,
          tag: options.tag || null
        });
        await client.disconnect();
        
        console.log(chalk.green('✅ Message sent successfully via daemon!'));
        console.log(chalk.gray(`Message ID: ${result.id}`));
        return;
        
      } catch (daemonError) {
        console.log(chalk.yellow(`⚠️  Daemon not available: ${daemonError.message}`));
        console.log(chalk.blue('💡 Falling back to direct message queue...'));
        
        // Fallback to direct message queue (original implementation)
        const messageQueue = new MessageQueue();
        await messageQueue.sendMessage({
          from: currentWorkspace,
          to: options.to,
          message: options.msg,
          priority: options.priority || false,
          tag: options.tag || null,
          timestamp: new Date().toISOString()
        });
        
        console.log(chalk.green('✅ Message sent successfully!'));
        console.log(chalk.gray(`Message: "${options.msg}"`));

        // Send notification if priority
        if (options.priority) {
          const notifier = new MedusaNotifier();
          await notifier.sendPriorityNotification(options.to, options.msg);
        }
      }
      
    } catch (error) {
      handleMedusaError(error);
    }
  });

/**
 * Please command - Polite version of send (with extra snark)
 */
program
  .command('please')
  .description('Send a message with fake politeness (still snarky)')
  .requiredOption('--to <workspace>', 'Target workspace')
  .requiredOption('--msg <message>', 'Your "polite" message')
  .option('--priority', 'Mark as urgent (please)')
  .action(async (options) => {
    try {
      // Add some fake politeness to the message
      const politeMessage = `Please ${options.msg} (asked nicely, as requested)`;
      
      const messageQueue = new MessageQueue();
      const workspaceDetector = new WorkspaceDetector();
      const currentWorkspace = await workspaceDetector.getCurrentWorkspace();
      
      console.log(chalk.cyan(`📤 Sending "polite" message to ${options.to}...`));
      
      await messageQueue.sendMessage({
        from: currentWorkspace,
        to: options.to,
        message: politeMessage,
        priority: options.priority || false,
        tag: 'polite-request',
        timestamp: new Date().toISOString()
      });
      
      console.log(chalk.green('✅ "Polite" message sent (you\'re so considerate)'));
      console.log(chalk.gray(`Message: "${politeMessage}"`));
      
    } catch (error) {
      handleMedusaError(error);
    }
  });

/**
 * Read command - Read incoming messages
 */
program
  .command('read')
  .alias('inbox')
  .description('Read your incoming messages')
  .option('--all', 'Show all messages (not just unread)')
  .option('--from <workspace>', 'Filter messages from specific workspace')
  .option('--limit <number>', 'Limit number of messages shown', '10')
  .action(async (options) => {
    try {
      const messageQueue = new MessageQueue();
      const messages = await messageQueue.getMessages({
        unreadOnly: !options.all,
        from: options.from,
        limit: parseInt(options.limit)
      });
      
      if (messages.length === 0) {
        console.log(chalk.green('📭 No messages to read (enjoy the peace while it lasts)'));
        return;
      }
      
      console.log(chalk.cyan(`📬 Your Messages (${messages.length}):\n`));
      
      messages.forEach((msg, index) => {
        const timeAgo = new Date(msg.timestamp).toLocaleString();
        const priorityFlag = msg.priority ? chalk.red('🚨 URGENT') : '';
        const tagFlag = msg.tag ? chalk.blue(`[${msg.tag}]`) : '';
        
        console.log(chalk.yellow(`${index + 1}. From ${msg.from} @ ${timeAgo} ${priorityFlag} ${tagFlag}`));
        console.log(chalk.white(`   "${msg.message}"`));
        console.log('');
      });
      
      // Mark messages as read
      await messageQueue.markAsRead(messages.map(m => m.id));
      
    } catch (error) {
      handleMedusaError(error);
    }
  });

/**
 * Listen command - Start real-time message watching (Medusa Alert Mode)
 */
program
  .command('listen')
  .alias('watch')
  .description('Start listening for real-time messages (stay alert!)')
  .option('--timeout <seconds>', 'How long to wait for messages', '60')
  .action(async (options) => {
    try {
      const messageQueue = new MessageQueue();
      const notifier = new MedusaNotifier();
      const timeout = parseInt(options.timeout) * 1000;
      
      console.log(chalk.cyan('👁️  Starting Medusa Alert Mode - listening for incoming messages...'));
      console.log(chalk.gray(`⏰ Timeout: ${options.timeout} seconds`));
      console.log(chalk.yellow('Press Ctrl+C to stop listening\n'));
      
      // Start watching
      await messageQueue.startWatching();
      
      // Set up event handlers
      messageQueue.on('newMessage', async (message) => {
        console.log(chalk.green('\n📬 ====== NEW MESSAGE RECEIVED ======'));
        console.log(chalk.white(`From: ${message.from}`));
        console.log(chalk.white(`To: ${message.to}`));
        console.log(chalk.white(`Message: "${message.message}"`));
        console.log(chalk.gray(`Intensity: ${message.severity} | Priority: ${message.priority ? 'HIGH' : 'Normal'}`));
        console.log(chalk.gray(`Time: ${new Date(message.timestamp).toLocaleString()}`));
        
        if (message.tag) {
          console.log(chalk.blue(`Tag: ${message.tag}`));
        }
        
        console.log(chalk.green('==========================================\n'));
        
        // Send notification
        await notifier.sendMessageNotification(message.from, message.message, message.priority);
        
        // Auto-mark as read
        await messageQueue.markAsRead([message.id]);
      });
      
      // Wait for messages with timeout
      try {
        await messageQueue.waitForNewMessage(timeout);
      } catch (error) {
        console.log(chalk.yellow(`⏰ Listening timeout reached (${options.timeout}s)`));
      }
      
      await messageQueue.cleanup();
      console.log(chalk.gray('👋 Stopped listening for messages'));

    } catch (error) {
      handleMedusaError(error);
    }
  });

/**
 * Reply command - Reply to a specific message
 */
program
  .command('reply')
  .description('Reply to a specific message')
  .requiredOption('--to <messageId>', 'ID of the message to reply to')
  .requiredOption('--msg <message>', 'Your reply message')
  .option('--priority', 'Mark reply as high priority')
  .action(async (options) => {
    try {
      const messageQueue = new MessageQueue();
      const workspaceDetector = new WorkspaceDetector();
      const currentWorkspace = await workspaceDetector.getCurrentWorkspace();
      
      console.log(chalk.cyan(`💬 Sending reply to message ${options.to}...`));
      
      const reply = await messageQueue.sendReply(options.to, options.msg, {
        from: currentWorkspace,
        priority: options.priority || false
      });
      
      console.log(chalk.green('✅ Reply sent successfully!'));
      console.log(chalk.gray(`Reply ID: ${reply.id}`));
      
      // Send notification if priority
      if (options.priority) {
        const notifier = new MedusaNotifier();
        await notifier.sendPriorityNotification(reply.to, options.msg);
      }
      
    } catch (error) {
      handleMedusaError(error);
    }
  });

/**
 * Chat command - Start interactive chat mode
 */
program
  .command('chat')
  .description('Start interactive chat mode with another workspace')
  .requiredOption('--with <workspace>', 'Workspace to chat with')
  .action(async (options) => {
    try {
      const messageQueue = new MessageQueue();
      const workspaceDetector = new WorkspaceDetector();
      const currentWorkspace = await workspaceDetector.getCurrentWorkspace();
      const readline = require('readline');
      
      console.log(chalk.cyan(`💬 Starting Medusa Chat with ${options.with}`));
      console.log(chalk.gray('Type your messages and press Enter. Type "exit" to quit.\n'));
      
      // Start watching for incoming messages
      await messageQueue.startWatching();
      
      // Set up message handler
      messageQueue.on('newMessage', async (message) => {
        if (message.from === options.with) {
          console.log(chalk.green(`\n${message.from}: ${message.message}`));
          console.log(chalk.gray(`[${new Date(message.timestamp).toLocaleTimeString()}] intensity: ${message.severity}`));
          await messageQueue.markAsRead([message.id]);
          process.stdout.write(chalk.blue(`${currentWorkspace}: `));
        }
      });
      
      // Set up readline interface
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: chalk.blue(`${currentWorkspace}: `)
      });
      
      rl.prompt();
      
      rl.on('line', async (input) => {
        const message = input.trim();
        
        if (message.toLowerCase() === 'exit') {
          console.log(chalk.yellow('👋 Ending chat session...'));
          rl.close();
          await messageQueue.cleanup();
          return;
        }
        
        if (message) {
          try {
            await messageQueue.sendMessage({
              from: currentWorkspace,
              to: options.with,
              message: message,
              tag: 'chat'
            });
            console.log(chalk.gray(`✓ sent`));
          } catch (error) {
            console.log(chalk.red(`✗ Failed to send: ${error.message}`));
          }
        }
        
        rl.prompt();
      });
      
      rl.on('close', async () => {
        await messageQueue.cleanup();
        process.exit(0);
      });
      
    } catch (error) {
      handleMedusaError(error);
    }
  });

/**
 * Conversation command - Show conversation history between workspaces
 */
program
  .command('conversation')
  .alias('conv')
  .description('Show conversation history between workspaces')
  .option('--with <workspace>', 'Show conversation with specific workspace')
  .option('--days <days>', 'Number of days of history to show', '7')
  .option('--export', 'Export conversation to file')
  .action(async (options) => {
    try {
      const messageQueue = new MessageQueue();
      const workspaceDetector = new WorkspaceDetector();
      const currentWorkspace = await workspaceDetector.getCurrentWorkspace();
      
      console.log(chalk.cyan('📜 Loading conversation history...\n'));
      
      const messages = await messageQueue.getConversationHistory(parseInt(options.days));
      
      // Filter by workspace if specified
      let filteredMessages = messages;
      if (options.with) {
        filteredMessages = messages.filter(msg => 
          (msg.from === currentWorkspace && msg.to === options.with) ||
          (msg.from === options.with && msg.to === currentWorkspace)
        );
      }
      
      if (filteredMessages.length === 0) {
        console.log(chalk.yellow('📭 No conversation history found'));
        return;
      }
      
      // Display conversation
      console.log(chalk.cyan(`📖 Conversation History (${filteredMessages.length} messages)`));
      if (options.with) {
        console.log(chalk.gray(`Between: ${currentWorkspace} ↔ ${options.with}`));
      }
      console.log(chalk.gray(`Period: Last ${options.days} days\n`));
      
      filteredMessages.forEach((msg, index) => {
        const timestamp = new Date(msg.timestamp).toLocaleString();
        const isFromCurrent = msg.from === currentWorkspace;
        const prefix = isFromCurrent ? '→' : '←';
        const color = isFromCurrent ? chalk.blue : chalk.green;
        
        console.log(color(`${prefix} ${msg.from}: ${msg.message}`));
        console.log(chalk.gray(`   [${timestamp}] ${msg.severity} intensity ${msg.priority ? '🚨' : ''}`));
        
        if (msg.tag) {
          console.log(chalk.gray(`   #${msg.tag}`));
        }
        
        if (index < filteredMessages.length - 1) {
          console.log('');
        }
      });
      
      // Export option
      if (options.export) {
        const exportPath = await messageQueue.exportConversation(filteredMessages);
        console.log(chalk.green(`\n📄 Conversation exported to: ${exportPath}`));
      }
      
    } catch (error) {
      handleMedusaError(error);
    }
  });

/**
 * Drama command - Show full conversation history
 */
program
  .command('drama')
  .alias('history')
  .alias('log')
  .description('Show full conversation history (all the drama)')
  .option('--days <number>', 'Show messages from last N days', '7')
  .option('--export', 'Export drama to a file (for evidence)')
  .action(async (options) => {
    try {
      const messageQueue = new MessageQueue();
      const days = parseInt(options.days);
      const messages = await messageQueue.getConversationHistory(days);
      
      if (messages.length === 0) {
        console.log(chalk.green('📭 No drama to report (surprisingly boring)'));
        return;
      }
      
      console.log(chalk.magenta(`🎭 Conversation Drama (Last ${days} days):\n`));
      
      messages.forEach((msg, index) => {
        const date = new Date(msg.timestamp);
        const timeStr = date.toLocaleString();
        const priorityFlag = msg.priority ? chalk.red('🚨') : '';
        const tagFlag = msg.tag ? chalk.blue(`[${msg.tag}]`) : '';
        
        console.log(chalk.cyan(`${timeStr} - ${msg.from} → ${msg.to} ${priorityFlag} ${tagFlag}`));
        console.log(chalk.white(`  "${msg.message}"`));
        console.log('');
      });
      
      if (options.export) {
        const exportPath = await messageQueue.exportConversation(messages);
        console.log(chalk.green(`📄 Drama exported to: ${exportPath}`));
      }
      
    } catch (error) {
      handleMedusaError(error);
    }
  });

/**
 * Slap command - Send a priority notification
 */
program
  .command('slap')
  .description('Send an urgent broadcast notification (for emergencies)')
  .requiredOption('--to <workspace>', 'Target workspace to slap')
  .option('--msg <message>', 'Optional message with your slap', 'Wake up! 👋')
  .action(async (options) => {
    try {
      const messageQueue = new MessageQueue();
      const notifier = new MedusaNotifier();
      const workspaceDetector = new WorkspaceDetector();
      const currentWorkspace = await workspaceDetector.getCurrentWorkspace();
      
      console.log(chalk.red(`👋 Slapping ${options.to} with urgent notification...`));
      
      // Send the slap message
      await messageQueue.sendMessage({
        from: currentWorkspace,
        to: options.to,
        message: `🚨 STONE: ${options.msg}`,
        priority: true,
        tag: 'slap',
        timestamp: new Date().toISOString()
      });
      
      // Send system notification
      await notifier.sendStoneNotification(options.to, options.msg);

      console.log(chalk.green('✅ Stone broadcast delivered successfully!'));
      console.log(chalk.red('They should definitely notice that one 👋'));
      
    } catch (error) {
      handleMedusaError(error);
    }
  });

/**
 * Live command - Start interactive live chat session
 */
program
  .command('live')
  .alias('chat')
  .description('Start a live chat session with another workspace (real-time conversation)')
  .option('--with <workspace>', 'Target workspace for the live session')
  .option('--session <id>', 'Join an existing session ID')
  .option('--ai-mode', 'Enable AI agent integration mode')
  .action(async (options) => {
    try {
      const MedusaLiveChat = require('./live/MedusaLiveChat');
      const workspaceDetector = new WorkspaceDetector();
      const currentWorkspace = await workspaceDetector.getCurrentWorkspace();
      
      const liveChat = new MedusaLiveChat({
        workspace: currentWorkspace,
        targetWorkspace: options.with,
        sessionId: options.session,
        aiMode: options.aiMode
      });
      
      await liveChat.start();
      
    } catch (error) {
      handleMedusaError(error);
    }
  });

/**
 * Clean command - Clear message history
 */
program
  .command('clean')
  .description('Clean up your messages (fresh start)')
  .option('--all', 'Delete all messages (nuclear option)')
  .option('--days <number>', 'Delete messages older than N days', '30')
  .option('--force', 'Skip confirmation (dangerous)')
  .action(async (options) => {
    try {
      const messageQueue = new MessageQueue();
      
      if (!options.force) {
        const inquirer = require('inquirer');
        const answer = await inquirer.prompt([{
          type: 'confirm',
          name: 'confirm',
          message: options.all ? 
            'Are you sure you want to delete ALL messages? (This cannot be undone)' :
            `Delete messages older than ${options.days} days?`,
          default: false
        }]);
        
        if (!answer.confirm) {
          console.log(chalk.yellow('🤷 Cleanup cancelled (probably wise)'));
          return;
        }
      }
      
      const deletedCount = options.all ? 
        await messageQueue.deleteAllMessages() :
        await messageQueue.deleteOldMessages(parseInt(options.days));
      
      console.log(chalk.green(`🧹 Cleaned up ${deletedCount} messages`));
      console.log(chalk.gray('Fresh start achieved (until the next conflict)'));
      
    } catch (error) {
      handleMedusaError(error);
    }
  });

/**
 * Whoami command - Show current workspace identity
 */
program
  .command('whoami')
  .description('Show your current workspace identity')
  .action(async () => {
    try {
      const workspaceDetector = new WorkspaceDetector();
      const configManager = new ConfigManager();
      
      const currentWorkspace = await workspaceDetector.getCurrentWorkspace();
      const config = await configManager.getMedusaConfig();
      
      console.log(chalk.cyan('🤔 Current Medusa Identity:\n'));
      console.log(chalk.green(`Workspace: ${currentWorkspace || 'Unknown'}`));
      
      if (config) {
        const role = currentWorkspace === config.dev ? 'DEV' :
                    currentWorkspace === config.beta ? 'BETA' : 'Unknown';
        console.log(chalk.yellow(`Role: ${role}`));
        console.log(chalk.blue(`Connection: ${config.dev} ↔ ${config.beta}`));
      } else {
        console.log(chalk.red('Role: Unregistered (run setup first)'));
      }
      
    } catch (error) {
      handleMedusaError(error);
    }
  });

// Add some easter eggs and hidden commands
program
  .command('therapy')
  .description('Get emotional support from Medusa (with maximum attitude)')
  .action(async () => {
    try {
      const configManager = new ConfigManager();
      const config = configManager.getEnhancedConfig();
      
      const therapyResponses = [
        "It's not you, it's definitely your code.",
        "Have you tried turning your expectations off and on again?",
        "Remember: debugging is just crying in a structured way.",
        "Your code doesn't hate you. It's just disappointed.",
        "Error messages are just your computer's way of saying 'I told you so.'",
        "You're not a bad developer, you're just... learning. Constantly.",
        "At least your bugs are consistent. That's something, right?",
        "Your merge conflicts have merge conflicts. Impressive.",
        "It's okay to cry. Your code already is.",
        "You know what? Maybe it IS a feature, not a bug.",
        "Dr. Medusa: Have you tried turning it off and on again?",
        "The problem exists between keyboard and chair.",
        "Your workspace relationship issues are valid (and hilarious)."
      ];
      
      const randomResponse = therapyResponses[Math.floor(Math.random() * therapyResponses.length)];
      
      console.log(chalk.magenta('🛋️  Medusa Therapy Session\n'));
      console.log(chalk.yellow('Dr. Medusa says:'));
      console.log(chalk.white(`"${randomResponse}"\n`));
      console.log(chalk.gray('💡 Remember: Every expert was once a beginner who refused to give up.'));
      console.log(chalk.gray('(But also, maybe read the documentation next time.)\n'));
      
      // Add a random fact if available
      if (config.easterEggs?.randomFacts) {
        const randomFact = config.easterEggs.randomFacts[Math.floor(Math.random() * config.easterEggs.randomFacts.length)];
        console.log(chalk.magenta(`📚 Random Medusa Fact: ${randomFact}`));
      }
      
      console.log(chalk.gray('\n💳 Therapy complete. That\'ll be $200 (or a coffee).'));
      
    } catch (error) {
      console.log(chalk.red('Even therapy is broken. That\'s... actually pretty on-brand.'));
    }
  });

program
  .command('meme')
  .description('Display a random Medusa meme (for morale and inappropriate humor)')
  .action(() => {
    const configManager = new ConfigManager();
    const config = configManager.getEnhancedConfig();
    
    const memes = [
      '🎭 "It\'s not a bug, it\'s a feature" - Every DEV ever',
      '🔥 "This is fine" - BETA while everything burns',
      '🤷 "Works on my machine" - The eternal DEV response',
      '😤 "Why is this so complicated?" - BETA discovering reality',
      '🎯 "Just ship it" - Management (the worst kind)',
      '🧠 "I\'m not arguing, I\'m just explaining why I\'m right" - Every developer',
      '💅 "You touched this last. It\'s yours now." - The Medusa Handoff',
      '🤡 "This module smells like scope creep and trauma." - Code Review Medusa',
      '⏰ "Still waiting... like an unpaid intern with hope." - Patient Medusa',
      '🎪 "If it breaks again, I\'m blaming Cursor." - Tool-Blaming Medusa',
      '🏆 "Congrats on your latest regression." - Sarcastic Medusa',
      '🎨 "Medusa: Making passive-aggression productive since 2024."'
    ];
    
    const randomMeme = memes[Math.floor(Math.random() * memes.length)];
    console.log(chalk.magenta('🎭 Medusa Meme of the Day:'));
    console.log(chalk.yellow(`${randomMeme}\n`));
    
    // Add a random CLI quote for extra entertainment
    if (config.cliQuotes && Math.random() > 0.5) {
      const randomQuote = configManager.getRandomCliQuote();
      console.log(chalk.gray(`💬 Bonus Quote: "${randomQuote}"`));
    }
  });

/**
 * RCP Discovery command
 */
program
  .command('rcp-discover')
  .alias('rcp-scan')
  .description('Scan for available Cursor RCP servers')
  .action(async () => {
    try {
      const workspaceDetector = new WorkspaceDetector();
      const currentWorkspace = await workspaceDetector.getCurrentWorkspace();
      
      const rcpClient = new CursorRCPClient({ workspaceId: currentWorkspace });
      
      console.log(chalk.cyan('🔍 Scanning for Cursor RCP servers...'));
      console.log(chalk.gray('This will check common ports for RCP server availability\n'));
      
      const servers = await rcpClient.discoverRCPServers();
      
      if (servers.length > 0) {
        console.log(chalk.green(`\n✅ Found ${servers.length} RCP server(s):`));
        servers.forEach((server, index) => {
          console.log(chalk.white(`  ${index + 1}. ${server.endpoint}`));
        });
        console.log(chalk.blue('\n💡 Use "medusa rcp-connect --port <port>" to connect'));
      } else {
        console.log(chalk.yellow('\n⚠️  No RCP servers found'));
        console.log(chalk.gray('Enable RCP server in Cursor: Settings → Features → RCP Server'));
      }
      
    } catch (error) {
      handleMedusaError(error);
    }
  });

/**
 * RCP Connect command
 */
program
  .command('rcp-connect')
  .description('Connect to a Cursor RCP server')
  .option('--port <port>', 'RCP server port')
  .option('--host <host>', 'RCP server host', 'localhost')
  .option('--token <token>', 'Authentication token (if required)')
  .action(async (options) => {
    try {
      const workspaceDetector = new WorkspaceDetector();
      const currentWorkspace = await workspaceDetector.getCurrentWorkspace();
      
      const rcpClient = new CursorRCPClient({
        host: options.host,
        port: options.port ? parseInt(options.port) : null,
        token: options.token,
        workspaceId: currentWorkspace
      });
      
      console.log(chalk.cyan('🔗 Connecting to Cursor RCP server...'));
      
      const connected = await rcpClient.connect(options.port ? parseInt(options.port) : null);
      
      if (connected) {
        console.log(chalk.green('✅ Successfully connected to RCP server!'));
        
        // Test basic functionality
        console.log(chalk.blue('🧪 Testing RCP functionality...'));
        const testResult = await rcpClient.testConnection();
        
        if (testResult) {
          console.log(chalk.green('🎉 RCP integration is working perfectly!'));
          console.log(chalk.gray('Medusa can now communicate directly with Cursor workspaces'));
        } else {
          console.log(chalk.yellow('⚠️  RCP connected but some features may not work'));
        }
        
        await rcpClient.disconnect();
      }
      
    } catch (error) {
      handleMedusaError(error);
    }
  });

/**
 * RCP Status command
 */
program
  .command('rcp-status')
  .description('Show RCP connection status')
  .action(async () => {
    try {
      const workspaceDetector = new WorkspaceDetector();
      const currentWorkspace = await workspaceDetector.getCurrentWorkspace();
      
      const rcpClient = new CursorRCPClient({ workspaceId: currentWorkspace });
      const status = rcpClient.getStatus();
      
      console.log(chalk.cyan('📊 RCP Connection Status:\n'));
      console.log(chalk.white(`Connected: ${status.connected ? chalk.green('Yes') : chalk.red('No')}`));
      console.log(chalk.white(`Host: ${status.host}`));
      console.log(chalk.white(`Port: ${status.port || 'Not set'}`));
      console.log(chalk.white(`Protocol: ${status.protocol}`));
      console.log(chalk.white(`Reconnect attempts: ${status.reconnectAttempts}`));
      
      if (!status.connected) {
        console.log(chalk.yellow('\n💡 Use "medusa rcp-discover" to find available servers'));
      }
      
    } catch (error) {
      handleMedusaError(error);
    }
  });

// NEW: Medusa diagnostic and recovery command
program
  .command('medusa-diagnose')
  .description('🔍 Diagnose and fix Medusa Protocol issues')
  .option('--fix', 'Automatically attempt to fix detected issues')
  .action(async (options) => {
    try {
      const { execSync } = require('child_process');
      const chalk = require('chalk');
      
      console.log(chalk.cyan('🔍 Medusa Diagnostic Report'));
      console.log(chalk.cyan('=====================================\n'));
      
      // Check for running processes
      console.log(chalk.yellow('📊 Process Analysis:'));
      try {
        const processes = execSync('ps aux | grep -E "(medusa|mcp)" | grep -v grep', { encoding: 'utf8' });
        if (processes.trim()) {
          console.log(chalk.green('✅ Found running processes:'));
          processes.split('\n').filter(line => line.trim()).forEach(line => {
            console.log(`   ${line}`);
          });
        } else {
          console.log(chalk.red('❌ No Medusa processes running'));
        }
      } catch (error) {
        console.log(chalk.red('❌ No Medusa processes found'));
      }
      
      // Check API health
      console.log(chalk.yellow('\n🩺 API Health Check:'));
      try {
        const response = await fetch('http://localhost:3009/health');
        if (response.ok) {
          const health = await response.json();
          console.log(chalk.green(`✅ API responding: ${health.status}`));
          console.log(`   Workspaces: ${health.workspaces}`);
          console.log(`   Uptime: ${health.uptime}s`);
        } else {
          console.log(chalk.red(`❌ API error: HTTP ${response.status}`));
        }
      } catch (error) {
        console.log(chalk.red(`❌ API not responding: ${error.message}`));
        
        if (options.fix) {
          console.log(chalk.yellow('\n🔧 Attempting automatic fix...'));
          try {
            execSync('pkill -f "medusa" 2>/dev/null || true', { stdio: 'ignore' });
            execSync('pkill -f "mcp" 2>/dev/null || true', { stdio: 'ignore' });
            console.log(chalk.green('✅ Killed stale processes'));
            
            // Start server
            const { spawn } = require('child_process');
            const serverProcess = spawn('node', ['bin/medusa.js', 'medusa', 'start'], {
              detached: true,
              stdio: 'ignore'
            });
            serverProcess.unref();
            
            console.log(chalk.green('✅ Started new Medusa server'));
            console.log(chalk.cyan('⏳ Waiting 5 seconds for startup...'));
            
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            // Re-test
            const retestResponse = await fetch('http://localhost:3009/health');
            if (retestResponse.ok) {
              const health = await retestResponse.json();
              console.log(chalk.green(`🎉 Fix successful! Server status: ${health.status}`));
            } else {
              console.log(chalk.red('❌ Fix failed - server still not responding'));
            }
          } catch (fixError) {
            console.log(chalk.red(`❌ Fix failed: ${fixError.message}`));
          }
        }
      }
      
      // Check dashboard
      console.log(chalk.yellow('\n🎛️  Dashboard Check:'));
      try {
        const dashResponse = await fetch('http://localhost:8181');
        if (dashResponse.ok) {
          console.log(chalk.green('✅ Dashboard accessible at http://localhost:8181'));
        } else {
          console.log(chalk.red(`❌ Dashboard error: HTTP ${dashResponse.status}`));
        }
      } catch (error) {
        console.log(chalk.red(`❌ Dashboard not accessible: ${error.message}`));
      }
      
      // Recommendations
      console.log(chalk.cyan('\n💡 Recommendations:'));
      if (!options.fix) {
        console.log(chalk.yellow('   Run with --fix to attempt automatic recovery'));
      }
      console.log(chalk.yellow('   If issues persist, try: node bin/medusa.js medusa start'));
      console.log(chalk.yellow('   For clean restart: pkill -f medusa && node bin/medusa.js medusa start'));
      
    } catch (error) {
      console.error(chalk.red(`Diagnostic failed: ${error.message}`));
      process.exit(1);
    }
  });

/**
 * Comprehensive Help Command
 */
program
  .command('help [command]')
  .alias('?')
  .description('Show comprehensive help for Medusa commands (automatically discovers all commands)')
  .option('--list', 'Show compact command list')
  .option('--search <keyword>', 'Search commands by keyword')
  .option('--stats', 'Show command statistics')
  .action(async (command, options) => {
    try {
      const helpSystem = new HelpSystem(program);
      
      if (options.stats) {
        const stats = helpSystem.getStats();
        console.log(chalk.cyan('📊 Medusa Command Statistics:\n'));
        console.log(chalk.yellow(`Total Commands: ${stats.totalCommands}`));
        console.log(chalk.yellow(`Total Aliases: ${stats.totalAliases}`));
        console.log(chalk.yellow('Commands by Category:'));
        for (const [category, count] of Object.entries(stats.categories)) {
          console.log(`  ${category}: ${count}`);
        }
        return;
      }
      
      if (options.search) {
        helpSystem.searchCommands(options.search);
        return;
      }
      
      if (options.list) {
        helpSystem.showCommandList();
        return;
      }
      
      helpSystem.showHelp(command);
      
    } catch (error) {
      handleMedusaError(error);
    }
  });

/**
 * Commands command - Show all available commands
 */
program
  .command('commands')
  .alias('cmds')
  .description('Show all available commands in compact format')
  .action(async () => {
    try {
      const helpSystem = new HelpSystem(program);
      helpSystem.showCommandList();
    } catch (error) {
      handleMedusaError(error);
    }
  });

// Handle unknown commands with snark
program.on('command:*', () => {
  console.log(chalk.red('❌ Unknown command. What kind of situation is this?'));
  console.log(chalk.yellow('Run: medusa --help'));
  console.log(chalk.gray('Or try: medusa therapy'));
});

// If no command provided, show comprehensive help with attitude
if (!process.argv.slice(2).length) {
  try {
    const helpSystem = new HelpSystem(program);
    helpSystem.showHelp();
  } catch (error) {
    showBanner();
    console.log(chalk.yellow('Welcome to Medusa! Ready to start some workspace drama?\n'));
    program.help();
  }
} else {
  // Parse arguments and handle the situation
  program.parse(process.argv);
} 