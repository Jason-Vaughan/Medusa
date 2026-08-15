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