#!/usr/bin/env node

/**
 * Medusa CLI Entry Point
 * Because sometimes you need to coordinate with your other workspace
 * and copy/paste is for peasants.
 */

const path = require('path');
const { spawn } = require('child_process');
const { program } = require('commander');
const chalk = require('chalk');
const figlet = require('figlet');
const fs = require('fs');

// Import components
const ConfigManager = require('../src/config/ConfigManager');
const MedusaWizard = require('../src/wizard/MedusaWizard');
const WorkspaceDetector = require('../src/workspace/WorkspaceDetector');
const MedusaNotifier = require('../src/utils/MedusaNotifier');
const MedusaClient = require('../src/medusa/client/MedusaClient');
const HelpSystem = require('../src/utils/HelpSystem');
const PrawductManager = require('../src/utils/PrawductManager');

// Use built-in fetch (Node.js 18+)
const fetch = globalThis.fetch;

// Get version from package.json
const packageJson = require('../package.json');

// Display ASCII art banner
console.log(chalk.magenta(figlet.textSync('Medusa', { horizontalLayout: 'full' })));
console.log(chalk.yellow(`Medusa Chat Protocol v${packageJson.version}`));
console.log(chalk.cyan('Medusa-MCP: Autonomous AI workspace coordination via Medusa Chat Protocol'));
console.log(chalk.gray('Making AI workspace coordination wickedly efficient since 2025\n'));

// Create the program
program
  .name('medusa')
  .description('Medusa - Making AI assistants work together through the Medusa Chat Protocol')
  .version(packageJson.version);

// Status command
program
  .command('status')
  .description('Check the Medusa status and workspace relationships')
  .action(async () => {
    try {
      const configManager = new ConfigManager();
      const config = await configManager.getMedusaConfig();
      const detector = new WorkspaceDetector();
      const workspaceName = await detector.getCurrentWorkspace();
      const currentWorkspace = workspaceName ? {
        name: workspaceName,
        path: process.cwd(),
        type: 'cursor'
      } : null;
      
      console.log(chalk.cyan('🔍 Medusa Status Report\n'));
      
      // Current workspace
      if (currentWorkspace) {
        console.log(chalk.green('📁 Current Workspace:'));
        console.log(`   Name: ${chalk.bold(currentWorkspace.name)}`);
        console.log(`   Path: ${currentWorkspace.path}`);
        console.log(`   Type: ${currentWorkspace.type}\n`);
      } else {
        console.log(chalk.yellow('⚠️  Not in a recognized workspace\n'));
      }
      
      // Medusa status
      const medusaClient = MedusaClient.getInstance({
    workspaceKey: process.cwd()
  });
      const medusaHealth = await medusaClient.checkHealth();
      
      if (medusaHealth.available) {
        console.log(chalk.green('✅ Medusa Protocol is running'));
        console.log(chalk.gray(`   Workspaces: ${medusaHealth.workspaces}`));
        console.log(chalk.gray(`   Messages: ${medusaHealth.messages}\n`));
      } else {
        console.log(chalk.red('❌ Medusa Protocol is not running'));
        console.log(chalk.gray('   Run "medusa medusa start" to start it\n'));
      }
      
      // Workspace relationships
      if (config) {
        console.log(chalk.cyan('\n💑 Workspace Relationship:'));
        console.log(`   ${chalk.bold(config.dev)} ↔️ ${chalk.bold(config.beta)}`);
        console.log(`   Established: ${new Date(config.createdAt).toLocaleDateString()}`);
        console.log(chalk.gray(`   Snark Level: ${config.settings?.snarkLevel || 'maximum'}\n`));
      } else {
        console.log(chalk.gray('\n💔 No workspace relationship established yet'));
        console.log(chalk.gray('   Run "medusa setup" to create your first relationship\n'));
      }
      
    } catch (error) {
      console.error(chalk.red('Error checking status:'), error.message);
      process.exit(1);
    }
  });

// Setup command
program
  .command('setup')
  .description('Set up Medusa workspace relationships')
  .action(async () => {
    try {
      const wizard = new MedusaWizard();
      await wizard.run();
    } catch (error) {
      console.error(chalk.red('Setup failed:'), error.message);
      process.exit(1);
    }
  });

// Medusa Slap command - Hard reset everything
program
  .command('slap')
  .description('💥 Medusa slap - Hard reset everything when shit hits the fan')
  .option('--medusa', 'Reset Medusa Protocol only')
  .option('--config', 'Reset configuration only')
  .option('--npm', 'Fix NPM binary resolution issues')
  .option('--nuclear', 'Nuclear option - reset EVERYTHING')
  .action(async (options) => {
    try {
      console.log(chalk.red('💥 INCOMING MEDUSA SLAP! 💥\n'));
      
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);
      
      let resetCount = 0;
      
      // Fix NPM binary resolution
      if (options.npm || options.nuclear) {
        console.log(chalk.yellow('📦 Slapping NPM binary resolution back to sanity...'));
        
        try {
          // Clear npm cache completely
          await execAsync('npm cache clean --force');
          console.log(chalk.green('   ✅ Cleared NPM cache'));
          
          // Remove node_modules if it exists
          if (fs.existsSync('node_modules')) {
            await execAsync('rm -rf node_modules');
            console.log(chalk.green('   ✅ Nuked node_modules'));
          }
          
          // Remove package-lock.json if it exists
          if (fs.existsSync('package-lock.json')) {
            fs.unlinkSync('package-lock.json');
            console.log(chalk.green('   ✅ Removed package-lock.json'));
          }
          
          // Reinstall with latest
          console.log(chalk.cyan('   🔄 Reinstalling medusa-mcp@latest...'));
          await execAsync('npm install medusa-mcp@latest');
          console.log(chalk.green('   ✅ Fresh installation complete'));
          
          resetCount++;
        } catch (error) {
          console.log(chalk.red('   ❌ NPM slap failed:'), error.message);
        }
      }
      
      // Reset Medusa Protocol
      if (options.medusa || options.nuclear || (!options.config && !options.medusa && !options.npm)) {
        console.log(chalk.yellow('🐍 Slapping Medusa Protocol back to reality...'));
        
        try {
          // Kill any running Medusa processes
          await execAsync('pkill -f "medusa-server" || true');
          await execAsync('pkill -f "medusa listen" || true');
          
          // Clear workspace registry
          const registryPath = path.join(process.cwd(), '.medusa-registry.json');
          if (fs.existsSync(registryPath)) {
            fs.unlinkSync(registryPath);
            console.log(chalk.green('   ✅ Cleared workspace registry'));
          }
          
          resetCount++;
        } catch (error) {
          console.log(chalk.red('   ❌ Medusa slap failed:'), error.message);
        }
      }
      
      // Reset configuration
      if (options.config || options.nuclear) {
        console.log(chalk.yellow('⚙️  Slapping configuration into submission...'));
        
        try {
          const configManager = new ConfigManager();
          await configManager.resetConfiguration();
          console.log(chalk.green('   ✅ Configuration reset'));
          resetCount++;
        } catch (error) {
          console.log(chalk.red('   ❌ Config slap failed:'), error.message);
        }
      }
      
      // Nuclear option
      if (options.nuclear) {
        console.log(chalk.red('☢️  NUCLEAR MEDUSA SLAP ENGAGED! ☢️'));
        
        try {
          // Clear all temp files
          const tempFiles = ['.medusa-lock', 'medusa-listener.log', 'listener.log'];
          tempFiles.forEach(file => {
            const filePath = path.join(process.cwd(), file);
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
              console.log(chalk.green(`   ✅ Nuked ${file}`));
            }
          });
          
          // Clear node_modules/.cache if it exists
          const cacheDir = path.join(process.cwd(), 'node_modules', '.cache');
          if (fs.existsSync(cacheDir)) {
            await execAsync(`rm -rf "${cacheDir}"`);
            console.log(chalk.green('   ✅ Nuked node cache'));
          }
          
          resetCount++;
        } catch (error) {
          console.log(chalk.red('   ❌ Nuclear option failed:'), error.message);
        }
      }
      
      // Results
      console.log(chalk.magenta('\n💥 MEDUSA SLAP COMPLETE! 💥'));
      
      if (resetCount === 0) {
        console.log(chalk.yellow('🤷 Nothing got slapped... maybe specify what needs slapping?'));
        console.log(chalk.gray('   --medusa   : Reset Medusa Protocol'));
        console.log(chalk.gray('   --config   : Reset configuration'));
        console.log(chalk.gray('   --npm      : Fix NPM binary resolution'));
        console.log(chalk.gray('   --nuclear  : Reset EVERYTHING'));
      } else {
        console.log(chalk.green(`✅ Successfully slapped ${resetCount} system(s) back into line!`));
        console.log(chalk.yellow('🎯 Medusa is ready for a fresh start!'));
        
        if (options.medusa || options.nuclear) {
          console.log(chalk.cyan('\n🐍 To restart Medusa: medusa medusa start'));
        }
        if (options.config || options.nuclear) {
          console.log(chalk.cyan('⚙️  To reconfigure: medusa setup'));
        }
      }
      
    } catch (error) {
      console.error(chalk.red('Medusa slap failed:'), error.message);
      process.exit(1);
    }
  });

// Medusa Protocol commands
const medusa = program
  .command('medusa')
  .description('🐍 Medusa Chat Protocol - Revolutionary workspace coordination');

// A2A Node commands
const a2a = program
  .command('a2a')
  .description('🤖 A2A Node - Peer-to-peer AI mesh coordination');

// Prawduct Governance commands
const prawduct = program
  .command('prawduct')
  .description('⚖️  Prawduct Governance - Automated session and chunk management');

prawduct
  .command('start')
  .description('🚀 Start a Prawduct development session and Medusa services')
  .action(async () => {
    try {
      const pm = new PrawductManager();
      await pm.startSession();
      
      console.log(chalk.cyan('🔄 Auto-starting Medusa services...'));
      // Call medusa start
      const { execSync } = require('child_process');
      execSync('node bin/medusa.js medusa start', { stdio: 'inherit' });
      
    } catch (error) {
      console.error(chalk.red('Failed to start Prawduct session:'), error.message);
    }
  });

prawduct
  .command('stop')
  .description('🛑 Stop a Prawduct development session and Medusa services')
  .action(async () => {
    try {
      const pm = new PrawductManager();
      await pm.stopSession();
      
      console.log(chalk.cyan('🔄 Auto-stopping Medusa services...'));
      // Call medusa stop
      const { execSync } = require('child_process');
      execSync('node bin/medusa.js medusa stop', { stdio: 'inherit' });
      
    } catch (error) {
      console.error(chalk.red('Failed to stop Prawduct session:'), error.message);
    }
  });

prawduct
  .command('status')
  .description('Show current Prawduct project status and chunk info')
  .action(async () => {
    try {
      const pm = new PrawductManager();
      const state = await pm.getProjectState();
      
      if (!state) {
        console.log(chalk.red('❌ No Prawduct project state found. Are you in a managed workspace?'));
        return;
      }
      
      console.log(chalk.cyan('⚖️  Prawduct Project Status\n'));
      console.log(`${chalk.yellow('Current Phase:')} ${state.current_phase}`);
      console.log(`${chalk.yellow('Last Completed Chunk:')} ${state.last_completed_chunk}`);
      console.log(`${chalk.yellow('Last Chunk Status:')} ${state.last_chunk_status}`);
      console.log(`${chalk.yellow('Next Step:')} ${state.next_step}\n`);
      
      if (state.work_in_progress) {
        console.log(chalk.magenta('🏗️  Work In Progress:'));
        console.log(`   Description: ${state.work_in_progress.description}`);
        console.log(`   Chunk: ${state.work_in_progress.chunk}`);
        console.log(`   Status: ${state.work_in_progress.status}\n`);
      }
    } catch (error) {
      console.error(chalk.red('Failed to get Prawduct status:'), error.message);
    }
  });

prawduct
  .command('backlog')
  .description('Show pending items from the project backlog')
  .action(async () => {
    try {
      const pm = new PrawductManager();
      const items = await pm.getBacklogItems();
      
      if (items.length === 0) {
        console.log(chalk.green('✅ Backlog is clear! (Or backlog.md is missing/empty)'));
        return;
      }
      
      console.log(chalk.cyan('📥 Prawduct Backlog - Pending Items\n'));
      items.forEach((item, index) => {
        const priorityColor = item.priority === 'High' ? chalk.red : (item.priority === 'Medium' ? chalk.yellow : chalk.green);
        console.log(`${index + 1}. ${chalk.bold(item.item)} [${priorityColor(item.priority)}]`);
        console.log(`   ${chalk.gray(item.description)}`);
        console.log(`   Origin: ${item.origin}\n`);
      });
    } catch (error) {
      console.error(chalk.red('Failed to get backlog:'), error.message);
    }
  });

prawduct
  .command('learn <title> <content>')
  .description('🧠 Add a new learning to the project knowledge base')
  .option('-t, --tags <tags>', 'Comma-separated tags', 'general')
  .action(async (title, content, options) => {
    try {
      const pm = new PrawductManager();
      const tags = options.tags.split(',').map(t => t.trim());
      await pm.addLearning(title, content, tags);
    } catch (error) {
      console.error(chalk.red('Failed to add learning:'), error.message);
    }
  });

prawduct
  .command('learnings')
  .description('📋 Show all learnings from the project knowledge base')
  .action(async () => {
    try {
      const pm = new PrawductManager();
      const items = await pm.getLearnings();
      
      if (items.length === 0) {
        console.log(chalk.yellow('🤷 No learnings found. Use "medusa prawduct learn <title> <content>" to add one.'));
        return;
      }
      
      console.log(chalk.cyan('🧠 Prawduct Project Learnings\n'));
      items.forEach((item, index) => {
        const date = new Date(item.timestamp).toLocaleString();
        console.log(`${index + 1}. ${chalk.bold(item.title)} [${chalk.gray(date)}]`);
        console.log(`   ${chalk.white(item.content)}`);
        console.log(`   ${chalk.cyan('Tags:')} ${item.tags.join(', ')}\n`);
      });
    } catch (error) {
      console.error(chalk.red('Failed to get learnings:'), error.message);
    }
  });

prawduct
  .command('janitor')
  .description('🧹 Automated codebase hygiene and cleanup')
  .option('--nuclear', 'Perform nuclear cleanup (clear A2A databases)')
  .action(async (options) => {
    try {
      const pm = new PrawductManager();
      await pm.performJanitorCleanup(options);
    } catch (error) {
      console.error(chalk.red('Janitor cleanup failed:'), error.message);
    }
  });

prawduct
  .command('summary')
  .description('📊 Get a summary of current session progress and learnings')
  .action(async () => {
    try {
      const pm = new PrawductManager();
      const summary = await pm.getSummary();
      
      console.log(chalk.cyan('📊 Prawduct Session Summary\n'));
      
      console.log(chalk.bold('🏗️  Current Status:'));
      console.log(`   Phase: ${summary.state.current_phase}`);
      console.log(`   Chunk: ${summary.state.work_in_progress.chunk}`);
      console.log(`   Task:  ${summary.state.work_in_progress.description}\n`);
      
      if (summary.recentLearnings.length > 0) {
        console.log(chalk.bold('🧠 Recent Learnings:'));
        summary.recentLearnings.forEach(l => console.log(`   - ${l.title}`));
        console.log('');
      }
      
      if (summary.pendingBacklog.length > 0) {
        console.log(chalk.bold('📋 Top Backlog Items:'));
        summary.pendingBacklog.forEach(b => console.log(`   - [${b.priority}] ${b.item}`));
        console.log('');
      }
    } catch (error) {
      console.error(chalk.red('Failed to get summary:'), error.message);
    }
  });

prawduct
  .command('wrap')
  .description('Automate the Prawduct session wrap protocol')
  .option('-n, --name <name>', 'Short name for the chunk (e.g. "GOVERNANCE")')
  .option('-t, --title <title>', 'Full title for the session wrap')
  .option('-m, --mission <summary>', 'Mission summary')
  .option('-w, --work <items>', 'Completed work items (markdown list)')
  .option('-h, --highlights <items>', 'Technical highlights (markdown list)')
  .option('-c, --critic <notes>', 'Independent Critic notes')
  .option('-s, --next <items>', 'Next steps (markdown list)')
  .action(async (options) => {
    try {
      const pm = new PrawductManager();
      const wrapPath = await pm.performSessionWrap({
        name: options.name,
        title: options.title,
        missionSummary: options.mission,
        completedWork: options.work,
        technicalHighlights: options.highlights,
        criticPass: options.critic,
        nextSteps: options.next
      });
      
      console.log(chalk.magenta('\n⚖️  SESSION WRAP COMPLETE ⚖️'));
      console.log(chalk.gray(`Artifact: ${wrapPath}`));
      console.log(chalk.yellow('Don\'t forget to commit your changes with the wrap artifact! 🚀'));
    } catch (error) {
      console.error(chalk.red('Session wrap failed:'), error.message);
    }
  });

a2a
  .command('start')
  .description('Start the A2A Python Node')
  .option('-p, --port <port>', 'Port to run on', '3200')
  .action(async (options) => {
    try {
      const { spawn } = require('child_process');
      const a2aPath = path.join(__dirname, '..', 'src', 'a2a_node', 'main.py');
      const venvPython = path.join(__dirname, '..', 'src', 'a2a_node', 'venv', 'bin', 'python');
      
      console.log(chalk.green('🤖 Starting Medusa A2A Node...'));
      
      // Use venv python if it exists
      const pythonCmd = fs.existsSync(venvPython) ? venvPython : 'python3';
      
      const a2aProcess = spawn(pythonCmd, [a2aPath], {
        detached: true,
        stdio: 'inherit',
        env: { ...process.env, A2A_PORT: options.port }
      });
      
      a2aProcess.unref();
      
      console.log(chalk.green(`✅ A2A Node starting at http://localhost:${options.port}`));
      console.log(chalk.gray('   Gossip mesh and Execution engine active.'));
    } catch (error) {
      console.error(chalk.red('Failed to start A2A Node:'), error.message);
      process.exit(1);
    }
  });

a2a
  .command('stop')
  .description('Stop the A2A Node')
  .action(async () => {
    try {
      const { execSync } = require('child_process');
      console.log(chalk.yellow('🛑 Stopping A2A Node processes...'));
      execSync('pkill -f "src/a2a_node/main.py" || true');
      console.log(chalk.green('✅ A2A Node stopped.'));
    } catch (error) {
      console.error(chalk.red('Failed to stop A2A Node:'), error.message);
    }
  });

a2a
  .command('list')
  .description('📋 List all tasks in the A2A ledger')
  .action(async () => {
    try {
      const a2aSecret = process.env.A2A_SECRET || 'medusa-please';
      const response = await fetch('http://localhost:3200/a2a/tasks', {
        headers: { 'X-Medusa-Secret': a2aSecret }
      });
      
      if (!response.ok) {
        throw new Error(`A2A Node responded with ${response.status}`);
      }
      
      const tasks = await response.json();
      
      if (tasks.length === 0) {
        console.log(chalk.yellow('🤷 No tasks found in A2A ledger.'));
        return;
      }
      
      console.log(chalk.cyan('🤖 A2A Task Ledger\n'));
      tasks.forEach((task) => {
        let statusColor = chalk.white;
        if (task.status === 'completed') statusColor = chalk.green;
        if (task.status === 'failed') statusColor = chalk.red;
        if (task.status === 'pending') statusColor = chalk.yellow;
        if (task.status === 'claimed') statusColor = chalk.magenta;
        
        console.log(`${chalk.bold(task.id.substring(0, 8))} [${statusColor(task.status)}] ${chalk.white(task.task_type)}`);
        console.log(`   ${chalk.gray(task.description)}`);
        if (task.claimed_by) {
          console.log(`   ${chalk.magenta('Claimed by:')} ${task.claimed_by}`);
        }
        console.log('');
      });
    } catch (error) {
      console.error(chalk.red('Failed to list A2A tasks:'), error.message);
    }
  });

a2a
  .command('claim <task_id>')
  .description('🪝 Claim a task from the A2A ledger')
  .action(async (taskId) => {
    try {
      const a2aSecret = process.env.A2A_SECRET || 'medusa-please';
      const nodeId = `Medusa-CLI-${process.pid}`;
      
      const response = await fetch(`http://localhost:3200/a2a/gossip/claim/${taskId}`, {
        method: 'POST',
        headers: { 
          'X-Medusa-Secret': a2aSecret,
          'node-id': nodeId
        }
      });
      
      const result = await response.json();
      
      if (result.status === 'claimed') {
        console.log(chalk.green(`✅ Task ${taskId} claimed successfully!`));
      } else {
        console.log(chalk.yellow(`⚠️  Failed to claim task: ${result.status}`));
        if (result.claimed_by) {
          console.log(chalk.gray(`   Already claimed by: ${result.claimed_by}`));
        }
      }
    } catch (error) {
      console.error(chalk.red('Failed to claim A2A task:'), error.message);
    }
  });

medusa
  .command('start')
  .description('Start the Medusa Protocol server')
  .option('--force', 'Force start even if another server is detected')
  .action(async (options) => {
    try {
      // NEW: Check for existing servers first
      const MedusaListener = require('../src/medusa/MedusaListener');
      const listener = new MedusaListener('temp-start-check');
      
      console.log(chalk.cyan('🔍 Checking for existing Medusa servers...'));
      const availability = await listener.checkServerAvailabilityForStartup();
      
      if (availability.existing && !options.force) {
        if (availability.ours) {
          console.log(chalk.green('✅ Medusa server already running under this workspace'));
          console.log(chalk.yellow('💡 Server is healthy and ready to use!'));
          return;
        } else if (availability.stale) {
          console.log(chalk.yellow('⚠️ Cleaning up stale processes before starting...'));
          const { execSync } = require('child_process');
          execSync('pkill -f "medusa-server" 2>/dev/null || true', { stdio: 'ignore' });

          await new Promise(resolve => setTimeout(resolve, 2000));
        } else {
          console.log(chalk.red('❌ Another workspace is already running Medusa server!'));
          console.log(chalk.cyan(`   Controlling Workspace: ${availability.controllingWorkspace}`));
          console.log(chalk.cyan(`   Status: ${availability.status}`));
          console.log(chalk.yellow('\n🤝 Use existing server instead:'));
          console.log(chalk.gray('   medusa medusa register  # Register with existing server'));
          console.log(chalk.gray('   medusa medusa listen    # Start listening to existing server'));
          console.log(chalk.yellow('\n🔧 Or force start (not recommended):'));
          console.log(chalk.gray('   medusa medusa start --force'));
          return;
        }
      }
      
      const { spawn } = require('child_process');
      const serverPath = path.join(__dirname, '..', 'src', 'medusa', 'medusa-server.js');
      
      console.log(chalk.green('🐍 Starting Medusa Chat Protocol...'));
      
      const medusaProcess = spawn('node', [serverPath], {
        detached: true,
        stdio: 'inherit'
      });
      
      medusaProcess.unref();
      
      // NEW: Start A2A Node automatically
      console.log(chalk.cyan('🤖 Automatically starting A2A Node...'));
      const a2aPath = path.join(__dirname, '..', 'src', 'a2a_node', 'main.py');
      const venvPython = path.join(__dirname, '..', 'src', 'a2a_node', 'venv', 'bin', 'python');
      const pythonCmd = fs.existsSync(venvPython) ? venvPython : 'python3';
      
      const a2aProcess = spawn(pythonCmd, [a2aPath], {
        detached: true,
        stdio: 'ignore' // Noisy on startup
      });
      a2aProcess.unref();
      
      console.log(chalk.green('✅ Medusa Protocol servers starting...'));
      console.log(chalk.cyan(`   Protocol API: http://localhost:3009`));
      console.log(chalk.cyan(`   Dashboard: http://localhost:8181`));
      console.log(chalk.cyan(`   A2A Node: http://localhost:3200`));
      console.log(chalk.yellow('\nThe two medusas are ready to coordinate! 🐍🔥🐍'));
    } catch (error) {
      console.error(chalk.red('Failed to start Medusa:'), error.message);
      process.exit(1);
    }
  });

medusa
  .command('stop')
  .description('Stop the Medusa Protocol server')
  .option('--force', 'Force stop all Medusa processes')
  .action(async (options) => {
    try {
      console.log(chalk.yellow('🛑 Stopping Medusa Protocol server...'));
      
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);
      
      try {
        // Kill medusa-server processes
        await execAsync('pkill -f "medusa-server" || true');
        console.log(chalk.green('   ✅ Stopped Medusa server'));
        
        // NEW: Stop A2A Node
        await execAsync('pkill -f "src/a2a_node/main.py" || true');
        console.log(chalk.green('   ✅ Stopped A2A Node'));
        

        
        // Clean up any stale process locks
        const ProcessLock = require('../src/utils/ProcessLock');
        await ProcessLock.cleanupStaleLocks();
        console.log(chalk.green('   ✅ Cleaned up process locks'));
        
        console.log(chalk.green('\n🎯 Medusa Protocol stopped successfully!'));
        console.log(chalk.gray('   Use "medusa medusa start" to restart when needed'));
        
      } catch (error) {
        if (options.force) {
          console.log(chalk.yellow('⚠️  Some processes may not have been running'));
        } else {
          console.log(chalk.red('❌ Error stopping server:'), error.message);
          console.log(chalk.yellow('💡 Try using --force flag for aggressive cleanup'));
        }
      }
      
    } catch (error) {
      console.error(chalk.red('Failed to stop Medusa:'), error.message);
      process.exit(1);
    }
  });

medusa
  .command('register')
  .description('Register this workspace with Medusa')
  .option('-n, --name <name>', 'Workspace name (defaults to folder name)')
  .action(async (options) => {
    try {
      const detector = new WorkspaceDetector();
      const workspaceName = await detector.getCurrentWorkspace();
      const workspace = {
        name: workspaceName,
        path: process.cwd(),
        type: 'cursor'
      };
      
      if (!workspace) {
        console.error(chalk.red('Not in a recognized workspace!'));
        process.exit(1);
      }
      
      const name = options.name || workspace.name;
      const client = MedusaClient.getInstance({
        workspaceKey: process.cwd()
      });
      
      // Check if server is running
      const health = await client.checkHealth();
      if (!health.available) {
        console.error(chalk.red('Medusa server not running! Start it with "medusa medusa start"'));
        process.exit(1);
      }
      
      // Register workspace
      const registration = await client.register(name, workspace.path, workspace.type);
      
      console.log(chalk.green('✅ Workspace registered with Medusa!'));
      console.log(chalk.cyan(`   ID: ${registration.id}`));
      console.log(chalk.cyan(`   Name: ${registration.name}`));
      console.log(chalk.yellow('\nReady to coordinate with other workspaces! 🐍'));
    } catch (error) {
      console.error(chalk.red('Registration failed:'), error.message);
      process.exit(1);
    }
  });

medusa
  .command('listen')
  .description('Start listening for incoming messages and auto-respond')
  .option('-i, --interval <ms>', 'Polling interval in milliseconds', '5000')
  .option('-d, --delay <ms>', 'Response delay in milliseconds', '2000')
  .action(async (options) => {
    try {
      const MedusaListener = require('../src/medusa/MedusaListener');
      const detector = new WorkspaceDetector();
      const workspaceName = await detector.getCurrentWorkspace();
      
      if (!workspaceName) {
        console.error(chalk.red('Not in a recognized workspace!'));
        process.exit(1);
      }
      
      // Load existing workspace ID from config
      const client = MedusaClient.getInstance({
        workspaceKey: process.cwd()
      });
      await client.loadConfig();
      
      if (!client.workspaceId) {
        console.error(chalk.red('This workspace is not registered! Run "medusa medusa register" first.'));
        process.exit(1);
      }
      
      console.log(chalk.green('🎧 Starting Medusa Listener...'));
      console.log(chalk.cyan(`   Workspace: ${workspaceName}`));
      console.log(chalk.cyan(`   Workspace ID: ${client.workspaceId}`));
      console.log(chalk.cyan(`   Poll Interval: ${options.interval}ms`));
      console.log(chalk.cyan(`   Response Delay: ${options.delay}ms`));
      
      const listener = new MedusaListener(client.workspaceId, {
        pollInterval: parseInt(options.interval),
        responseDelay: parseInt(options.delay)
      });
      
      await listener.startListening();
      
      console.log(chalk.yellow('\n🐍 Medusa is now listening and ready to auto-respond!'));
      console.log(chalk.gray('Press Ctrl+C to stop listening\n'));
      
      // Handle graceful shutdown
      process.on('SIGINT', () => {
        console.log(chalk.yellow('\n🔇 Stopping listener...'));
        listener.stopListening();
        process.exit(0);
      });
      
    } catch (error) {
      console.error(chalk.red('Failed to start listener:'), error.message);
      process.exit(1);
    }
  });

medusa
  .command('list')
  .description('List all registered workspaces with autonomous conversation status')
  .action(async () => {
    try {
      const client = MedusaClient.getInstance({
        workspaceKey: process.cwd()
      });
      
      // Check if server is running
      const health = await client.checkHealth();
      if (!health.available) {
        console.error(chalk.red('Medusa server not running! Start it with "medusa medusa start"'));
        process.exit(1);
      }
      
      const response = await client.listWorkspaces();
      const workspaces = response.workspaces || response; // Handle both old and new response formats
      const telemetry = response.telemetry;
      
      if (workspaces.length === 0) {
        console.log(chalk.yellow('No workspaces registered yet'));
        return;
      }
      
      console.log(chalk.cyan('🐍 Workspace Autonomous Conversation Status:\n'));
      
      // Show telemetry summary if available
      if (telemetry) {
        console.log(chalk.magenta('📊 Autonomous Conversation Readiness:'));
        console.log(chalk.cyan(`   Ready: ${telemetry.autonomousConversationReady}/${telemetry.totalWorkspaces} (${telemetry.readinessPercentage}%)`));
        console.log('');
      }
      
      workspaces.forEach(ws => {
        // Enhanced status indicators
        const connectionStatus = ws.connection?.webSocket ? chalk.green('🔌') : chalk.red('🔌');
        const listenerStatus = ws.listener?.active ? chalk.green('🎧') : chalk.red('🎧');
        const autonomousReady = ws.autonomousConversationReady ? chalk.green('🤖') : chalk.red('🤖');
        
        console.log(`${autonomousReady} ${chalk.bold(ws.name)} (${ws.id})`);
        console.log(`   Path: ${ws.path}`);
        console.log(`   Type: ${ws.type}`);
        console.log(`   Registered: ${new Date(ws.registeredAt).toLocaleString()}`);
        
        // Connection telemetry
        if (ws.connection) {
          console.log(`   ${connectionStatus} WebSocket: ${ws.connection.webSocket ? chalk.green('Connected') : chalk.red('Disconnected')} (${ws.connection.connectionCount} connections)`);
        }
        
        // Listener telemetry
        if (ws.listener) {
          const listenerText = ws.listener.active ? chalk.green('Active') : chalk.red('Inactive');
          const autonomousText = ws.listener.autonomousMode ? chalk.green('ON') : chalk.red('OFF');
          console.log(`   ${listenerStatus} Listener: ${listenerText} | Autonomous Mode: ${autonomousText}`);
          
          if (ws.listener.lastHeartbeat) {
            const heartbeatTime = new Date(ws.listener.lastHeartbeat).toLocaleTimeString();
            console.log(`   💓 Last Heartbeat: ${heartbeatTime}`);
          }
        }
        
        // Overall readiness
        const readinessText = ws.autonomousConversationReady ? 
          chalk.green('✅ READY for autonomous conversations') : 
          chalk.yellow('⚠️  Not ready - need active listener + WebSocket');
        console.log(`   ${readinessText}\n`);
      });
    } catch (error) {
      console.error(chalk.red('Failed to list workspaces:'), error.message);
      process.exit(1);
    }
  });

medusa
  .command('send <workspace> <message>')
  .description('Send a direct message to another workspace')
  .option('--wait', 'Wait for response (blocks terminal)')
  .action(async (workspace, message, options) => {
    try {
      const client = MedusaClient.getInstance({
        workspaceKey: process.cwd()
      });
      
      // Load config without full connection setup
      await client.loadConfig();
      
      if (!client.workspaceId) {
        console.error(chalk.red('This workspace is not registered! Run "medusa medusa register" first.'));
        process.exit(1);
      }
      
      // Fire-and-forget send: Just make the HTTP request without WebSocket/polling
      const response = await client.sendMessage(workspace, message);
      
      console.log(chalk.green('✅ Message sent!'));
      console.log(chalk.gray(`   Message ID: ${response.messageId}`));
      console.log(chalk.yellow('   Returning to prompt (fire-and-forget mode)'));
      
      // Exit immediately unless --wait flag is used
      if (!options.wait) {
        process.exit(0);
      } else {
        console.log(chalk.cyan('   Waiting for response... (use Ctrl+C to stop)'));
        // Only if --wait is specified, establish full connection
        await client.connect();
        
        // Keep process alive to listen for responses
        process.stdin.resume();
        
        // Handle Ctrl+C
        process.on('SIGINT', () => {
          console.log(chalk.yellow('\n👋 Stopping listener...'));
          client.disconnect();
          process.exit(0);
        });
      }
      
    } catch (error) {
      console.error(chalk.red('Failed to send message:'), error.message);
      process.exit(1);
    }
  });

medusa
  .command('broadcast <message>')
  .description('Broadcast a message to all workspaces')
  .option('--wait', 'Wait for responses (blocks terminal)')
  .action(async (message, options) => {
    try {
      const client = MedusaClient.getInstance({
        workspaceKey: process.cwd()
      });
      
      // Load config without full connection setup
      await client.loadConfig();
      
      if (!client.workspaceId) {
        console.error(chalk.red('This workspace is not registered! Run "medusa medusa register" first.'));
        process.exit(1);
      }
      
      // Fire-and-forget broadcast: Just make the HTTP request without WebSocket/polling
      const response = await client.broadcast(message);
      
      console.log(chalk.green('✅ Broadcast sent!'));
      console.log(chalk.gray(`   Recipients: ${response.recipients}`));
      console.log(chalk.gray(`   Message ID: ${response.messageId}`));
      console.log(chalk.yellow('   Returning to prompt (fire-and-forget mode)'));
      
      // Exit immediately unless --wait flag is used
      if (!options.wait) {
        process.exit(0);
      } else {
        console.log(chalk.cyan('   Waiting for responses... (use Ctrl+C to stop)'));
        // Only if --wait is specified, establish full connection
        await client.connect();
        
        // Keep process alive to listen for responses
        process.stdin.resume();
        
        // Handle Ctrl+C
        process.on('SIGINT', () => {
          console.log(chalk.yellow('\n👋 Stopping listener...'));
          client.disconnect();
          process.exit(0);
        });
      }
      
    } catch (error) {
      console.error(chalk.red('Failed to broadcast:'), error.message);
      process.exit(1);
    }
  });

medusa
  .command('test-ai [workspace]')
  .description('Send a test message that requires real AI to respond (not templates)')
  .action(async (workspace = 'tilt') => {
    try {
      const MedusaListener = require('../src/medusa/MedusaListener');
      const detector = new WorkspaceDetector();
      const workspaceName = await detector.getCurrentWorkspace();
      
      if (!workspaceName) {
        console.error(chalk.red('Not in a recognized workspace!'));
        process.exit(1);
      }
      
      const listener = new MedusaListener(workspaceName);
      
      console.log(chalk.cyan('🧪 Testing Real AI Integration'));
      console.log(chalk.gray(`This will send a unique question that requires real AI to answer correctly.`));
      console.log(chalk.gray(`If you get template responses, AI integration is NOT working.`));
      console.log('');
      
      const success = await listener.testRealAIIntegration(workspace);
      
      if (success) {
        console.log('');
        console.log(chalk.green('✅ Test message sent!'));
        console.log(chalk.yellow('📝 Expected Response Indicators:'));
        console.log(chalk.gray('   • Mathematical answer: 365 (127 + 238)'));
        console.log(chalk.gray('   • Exactly 3 sentences about quantum computing & JavaScript'));
        console.log(chalk.gray('   • Acknowledges the timestamp and test nature'));
        console.log(chalk.gray('   • NOT a generic template response'));
        console.log('');
        console.log(chalk.cyan('🎧 Watch your medusa listener for the response!'));
      } else {
        console.error(chalk.red('❌ Failed to send test message'));
        process.exit(1);
      }
      
    } catch (error) {
      console.error(chalk.red('Failed to run AI integration test:'), error.message);
      process.exit(1);
    }
  });

medusa
  .command('reset-loops')
  .description('Reset conversation counters to prevent reflection loops')
  .action(async () => {
    try {
      const MedusaListener = require('../src/medusa/MedusaListener');
      const detector = new WorkspaceDetector();
      const workspaceName = await detector.getCurrentWorkspace();
      
      if (!workspaceName) {
        console.error(chalk.red('Not in a recognized workspace!'));
        process.exit(1);
      }
      
      // Load existing workspace ID from config
      const client = MedusaClient.getInstance({
        workspaceKey: process.cwd()
      });
      await client.loadConfig();
      
      if (!client.workspaceId) {
        console.error(chalk.red('This workspace is not registered! Run "medusa medusa register" first.'));
        process.exit(1);
      }
      
      // Create temporary listener to reset counters
      const listener = new MedusaListener(client.workspaceId);
      listener.resetConversationCounters();
      
      console.log(chalk.green('✅ Conversation counters reset successfully!'));
      console.log(chalk.yellow('   All reflection loop prevention measures cleared.'));
      console.log(chalk.gray('   Safe to restart automated conversations.'));
      
    } catch (error) {
      console.error(chalk.red('Failed to reset conversation counters:'), error.message);
      process.exit(1);
    }
  });

medusa
  .command('interactive')
  .description('Listen for incoming messages (interactive mode)')
  .action(async () => {
    try {
      const client = MedusaClient.getInstance({
        workspaceKey: process.cwd()
      });
      
      // Connect and load config
      const workspace = await client.connect();
      
      if (!workspace) {
        console.error(chalk.red('This workspace is not registered! Run "medusa medusa register" first.'));
        process.exit(1);
      }
      
      console.log(chalk.green(`🐍 Listening for messages as ${workspace.name}...`));
      console.log(chalk.gray('Press Ctrl+C to stop\n'));
      
      // Listen for messages
      client.on('messageReceived', (message) => {
        console.log(MedusaClient.formatMessage(message));
        
        // Send notification (with error handling)
        try {
          const MedusaNotifier = require('../src/utils/MedusaNotifier');
          const notifier = new MedusaNotifier();
          notifier.sendCustomNotification('Medusa Message', `From ${message.fromName || message.from}: ${message.message}`, {
            type: 'info',
            timeout: 5
          }).catch(err => {
            console.log(chalk.gray(`⚠️  Notification failed: ${err.message}`));
          });
        } catch (notificationError) {
          console.log(chalk.gray(`⚠️  Notification system unavailable: ${notificationError.message}`));
        }
      });
      
      // Keep process alive
      process.stdin.resume();
      
      // Handle Ctrl+C
      process.on('SIGINT', () => {
        console.log(chalk.yellow('\n👋 Stopping message listener...'));
        client.disconnect();
        process.exit(0);
      });
    } catch (error) {
      console.error(chalk.red('Failed to start listener:'), error.message);
      process.exit(1);
    }
  });

medusa
  .command('restart')
  .description('Restart Cursor MCP connection without closing Cursor')
  .action(async () => {
    try {
      console.log(chalk.cyan('🔄 Medusa MCP Connection Restart'));
      console.log(chalk.yellow('   Automated fix for stuck MCP servers\n'));
      
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);
      
      // Step 1: Find extension host process
      console.log(chalk.gray('🔍 Finding Cursor extension host process...'));
      try {
        const { stdout } = await execAsync('ps aux | grep "extension-host" | grep -v grep');
        const lines = stdout.trim().split('\n').filter(line => line.includes('extension-host'));
        
        if (lines.length === 0) {
          console.log(chalk.red('❌ No extension host process found'));
          console.log(chalk.yellow('💡 Make sure Cursor is running and try again'));
          return;
        }
        
        // Extract PID from first matching process
        const pid = lines[0].trim().split(/\s+/)[1];
        console.log(chalk.green(`   ✅ Found extension host (PID: ${pid})`));
        
        // Step 2: Kill extension host process
        console.log(chalk.gray('🔨 Restarting extension host...'));
        await execAsync(`kill ${pid}`);
        console.log(chalk.green('   ✅ Extension host restarted'));
        
        // Step 3: Instructions
        console.log(chalk.cyan('\n🎯 Medusa MCP Restart Complete!'));
        console.log(chalk.yellow('📋 Next steps:'));
        console.log(chalk.gray('   1. If Cursor shows "Extension host terminated" dialog → Click "Restart Extension Host"'));
        console.log(chalk.gray('   2. Go to Cursor Settings → MCP Tools'));
        console.log(chalk.gray('   3. Toggle "medusa" server OFF then ON'));
        console.log(chalk.gray('   4. Should connect immediately (green with tools)'));
        console.log(chalk.green('\n🚀 Much faster than closing/reopening Cursor!'));
        console.log(chalk.yellow('💡 Alternative: If no dialog appears, toggle OFF → ON manually'));
        
      } catch (error) {
        console.log(chalk.red('❌ Failed to find or restart extension host'));
        console.log(chalk.yellow('💡 Fallback: Close and reopen Cursor manually'));
        console.log(chalk.gray(`   Error: ${error.message}`));
      }
      
    } catch (error) {
      console.error(chalk.red('MCP restart failed:'), error.message);
      process.exit(1);
    }
  });

medusa
  .command('version-check')
  .description('Check version compatibility between CLI and server')
  .action(async () => {
    try {
      // Get current CLI version
      const packagePath = path.join(__dirname, '..', 'package.json');
      const packageJson = require(packagePath);
      const cliVersion = packageJson.version;
      
      console.log(chalk.cyan('🔍 Medusa Version Compatibility Check'));
      console.log(chalk.gray(`   CLI Version: v${cliVersion}`));
      
      // Check server version
      try {
        const response = await fetch('http://localhost:3009/health');
        if (response.ok) {
          const health = await response.json();
          console.log(chalk.gray(`   Server Version: v${health.version}`));
          
          if (health.version === cliVersion) {
            console.log(chalk.green('✅ Versions match! Everything is running properly.'));
            console.log(chalk.cyan(`   Controlling Workspace: ${health.controllingWorkspace}`));
            console.log(chalk.cyan(`   Server Status: ${health.status}`));
            console.log(chalk.cyan(`   Uptime: ${Math.floor(health.uptime)}s`));
          } else {
            console.log(chalk.yellow('⚠️  Version mismatch detected!'));
            console.log(chalk.red(`   This can cause compatibility issues.`));
            console.log(chalk.cyan('\n🔄 Recommended actions:'));
            console.log(chalk.gray('   1. Stop current listener (Ctrl+C)'));
            console.log(chalk.gray('   2. Restart listener: medusa medusa listen'));
            console.log(chalk.gray('   3. Server will auto-restart with correct version'));
          }
        } else {
          console.log(chalk.red('❌ Server not responding'));
          console.log(chalk.yellow('💡 Start server: medusa medusa start'));
        }
      } catch (error) {
        console.log(chalk.red('❌ Server not running'));
        console.log(chalk.yellow('💡 Start server: medusa medusa start'));
      }
      
    } catch (error) {
      console.error(chalk.red('Version check failed:'), error.message);
      process.exit(1);
    }
  });

medusa
  .command('check')
  .description('Check Medusa server status and workspace coordination')
  .option('--json', 'Output results in JSON format')
  .action(async (options) => {
    try {
      const MedusaListener = require('../src/medusa/MedusaListener');
      const listener = new MedusaListener('temp-check-id');
      
      console.log(chalk.cyan('🔍 Medusa-MCP Server Coordination Check'));
      console.log(chalk.gray('   Checking for existing Medusa servers and workspace conflicts...\n'));
      
      const availability = await listener.checkServerAvailabilityForStartup();
      
      if (options.json) {
        console.log(JSON.stringify(availability, null, 2));
        return;
      }
      
      // Human-readable output
      if (availability.existing) {
        if (availability.ours) {
          console.log(chalk.green('✅ Medusa server is running and controlled by this workspace'));
          console.log(chalk.cyan(`   Status: ${availability.status}`));
          console.log(chalk.cyan(`   Version: v${availability.version}`));
          console.log(chalk.yellow('\n💡 Safe to use existing server - no conflicts detected'));
        } else if (availability.stale) {
          console.log(chalk.yellow('⚠️ Stale Medusa processes detected'));
          console.log(chalk.gray('   Server processes exist but not responding'));
          console.log(chalk.yellow('\n🔧 Recommended actions:'));
          console.log(chalk.gray('   1. Clean up stale processes: pkill -f medusa'));
          console.log(chalk.gray('   2. Start fresh server: medusa medusa start'));
        } else {
          console.log(chalk.yellow('🤝 Medusa server managed by another workspace'));
          console.log(chalk.cyan(`   Controlling Workspace: ${availability.controllingWorkspace}`));
          console.log(chalk.cyan(`   Status: ${availability.status}`));
          console.log(chalk.cyan(`   Version: v${availability.version}`));
          console.log(chalk.yellow('\n⚠️ DO NOT START NEW SERVER - Use existing one instead'));
          console.log(chalk.green('✅ Register with existing server: medusa medusa register'));
        }
      } else if (availability.available) {
        console.log(chalk.green('✅ No Medusa server detected - safe to start'));
        console.log(chalk.yellow('\n🚀 Ready to start server: medusa medusa start'));
      } else {
        console.log(chalk.red('❌ Server check failed'));
        console.log(chalk.red(`   Error: ${availability.error || 'Unknown error'}`));
      }
      
    } catch (error) {
      if (options.json) {
        console.log(JSON.stringify({ error: error.message }, null, 2));
      } else {
        console.error(chalk.red('Server check failed:'), error.message);
      }
      process.exit(1);
    }
  });

/**
 * 🎯 Comprehensive Help System Integration
 * Revolutionary auto-discovering help system with search and examples
 */

// Comprehensive help command that actually works
program
  .command('comprehensive-help [command]')
  .alias('ch')
  .alias('?')
  .description('🎯 Show comprehensive help with auto-discovery, examples, and search')
  .option('--list', 'Show compact command list')
  .option('--search <keyword>', 'Search commands by keyword')
  .option('--stats', 'Show command statistics')
  .option('--discover', 'Auto-discover and show all available commands')
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
      
      if (options.discover) {
        await helpSystem.showAutoDiscoveredHelp();
        return;
      }
      
      // Default comprehensive help
      helpSystem.showHelp(command);
      
    } catch (error) {
      console.error(chalk.red('Help system error:'), error.message);
      process.exit(1);
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
      console.error(chalk.red('Commands list error:'), error.message);
      process.exit(1);
    }
  });

/**
 * 🧟 ZombieDust - AI Monitoring and Autonomous Coordination
 */
program
  .command('zombify <workspace>')
  .description('🧟 Start ZombieDust AI monitoring for autonomous workspace coordination')
  .option('-m, --mode <mode>', 'Monitoring mode: zombify (continuous) or once (single check)', 'zombify')
  .action(async (workspace, options) => {
    try {
      console.log(chalk.magenta('🧟 Starting ZombieDust AI Monitoring...'));
      console.log(chalk.cyan(`   Workspace: ${workspace}`));
      console.log(chalk.cyan(`   Mode: ${options.mode}`));
      
      const zombiedustPath = path.join(__dirname, '..', 'ZombieDust.js');
      
      // Validate workspace parameter
      const validWorkspaces = ['tilt', 'medusa', 'auto-detect'];
      if (!validWorkspaces.includes(workspace.toLowerCase())) {
        console.log(chalk.yellow(`⚠️  Unknown workspace: ${workspace}`));
        console.log(chalk.gray(`   Valid workspaces: ${validWorkspaces.join(', ')}`));
        console.log(chalk.cyan('   Proceeding anyway - ZombieDust will auto-detect...\n'));
      }
      
      // Validate mode parameter
      const validModes = ['zombify', 'once'];
      if (!validModes.includes(options.mode)) {
        console.log(chalk.red(`❌ Invalid mode: ${options.mode}`));
        console.log(chalk.gray(`   Valid modes: ${validModes.join(', ')}`));
        process.exit(1);
      }
      
      console.log(chalk.yellow('🧟‍♂️ Transforming AI into autonomous coordination zombie...\n'));
      
      // Spawn ZombieDust process in VISIBLE FOREGROUND MODE as promised in protocol
      const zombieProcess = spawn('node', [zombiedustPath, workspace, options.mode], {
        stdio: 'inherit',  // Full foreground mode - visible monitoring with user control
        cwd: path.join(__dirname, '..')
      });
      
      // Handle process events
      zombieProcess.on('close', (code) => {
        if (code === 0) {
          console.log(chalk.green('\n✅ ZombieDust monitoring completed successfully'));
        } else {
          console.log(chalk.red(`\n❌ ZombieDust exited with code ${code}`));
        }
        process.exit(code);
      });
      
      zombieProcess.on('error', (error) => {
        console.error(chalk.red('ZombieDust spawn error:'), error.message);
        process.exit(1);
      });
      
      // Handle Ctrl+C gracefully
      process.on('SIGINT', () => {
        console.log(chalk.yellow('\n🧟 Stopping ZombieDust monitoring...'));
        zombieProcess.kill('SIGINT');
      });
      
    } catch (error) {
      console.error(chalk.red('Failed to start ZombieDust:'), error.message);
      process.exit(1);
    }
  });

// Parse commander commands
program.parse(process.argv);

// If no command was provided, show comprehensive help
if (!process.argv.slice(2).length) {
  try {
    const helpSystem = new HelpSystem(program);
    helpSystem.showHelp();
  } catch (error) {
    program.outputHelp();
  }
} 