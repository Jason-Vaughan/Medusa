/**
 * Medusa Help System - Comprehensive CLI documentation
 *
 * Automatically discovers all commands and provides detailed help
 * Because even snakes need good documentation.
 */

const chalk = require('chalk');
const figlet = require('figlet');
const packageJson = require('../../package.json');

class HelpSystem {
  constructor(program) {
    this.program = program;
    this.commands = this.discoverCommands();
  }

  /**
   * Automatically discover all registered commands
   */
  discoverCommands() {
    const commands = new Map();

    // Get all commands from the program
    const allCommands = this.program.commands;

    for (const cmd of allCommands) {
      const commandInfo = {
        name: cmd.name(),
        description: cmd.description(),
        aliases: cmd.aliases(),
        usage: cmd.usage(),
        options: cmd.options.map(opt => ({
          flags: opt.flags,
          description: opt.description,
          required: opt.required,
          defaultValue: opt.defaultValue
        })),
        args: cmd.registeredArguments.map(arg => ({
          name: arg.name(),
          description: arg.description,
          required: arg.required,
          variadic: arg.variadic
        })),
        examples: this.getCommandExamples(cmd.name()),
        category: this.categorizeCommand(cmd.name()),
        subcommands: []
      };

      // Check for subcommands (like medusa subcommands)
      if (cmd.commands && cmd.commands.length > 0) {
        for (const subcmd of cmd.commands) {
          commandInfo.subcommands.push({
            name: subcmd.name(),
            description: subcmd.description(),
            aliases: subcmd.aliases(),
            usage: subcmd.usage(),
            fullName: `${cmd.name()} ${subcmd.name()}`
          });
        }
      }

      commands.set(cmd.name(), commandInfo);
    }

    return commands;
  }

  /**
   * Categorize commands for better organization
   */
  categorizeCommand(commandName) {
    const categories = {
      'Setup & Configuration': ['setup', 'wizard', 'slap', 'prawduct'],
      'Status & Information': ['status', 'whoami', 'version-check', 'check'],
      'Medusa Protocol': ['medusa', 'medusa-diagnose'],
      'Messaging & Communication': ['send', 'please', 'read', 'reply', 'chat', 'conversation', 'drama', 'live', 'broadcast'],
      'Daemon Management': ['daemon-start', 'daemon-stop', 'daemon-status'],

      'Workspace Management': ['listen', 'clean', 'register', 'list'],
      'Utilities & Fun': ['slap', 'therapy', 'meme', 'interactive', 'reset-loops']
    };

    for (const [category, commands] of Object.entries(categories)) {
      if (commands.includes(commandName)) {
        return category;
      }
    }

    return 'Other';
  }

  /**
   * Get examples for specific commands
   */
  getCommandExamples(commandName) {
    const examples = {
      'setup': [
        'medusa setup --wizard',
        'medusa setup --dev MyProject --beta TestProject',
        'medusa setup --force'
      ],
      'status': [
        'medusa status',
        'medusa wtf'
      ],
      'send': [
        'medusa send "Deploy is ready for testing"',
        'medusa send --workspace TiLT "Check the new feature"',
        'medusa send --urgent "Critical bug found!"'
      ],
      'medusa': [
        'medusa medusa start',
        'medusa medusa stop',
        'medusa medusa register',
        'medusa medusa listen',
        'medusa medusa list'
      ],
      'prawduct': [
        'medusa prawduct status',
        'medusa prawduct backlog',
        'medusa prawduct wrap --name GOVERNANCE --title "Chunk 10 Success"'
      ],

      'slap': [
        'medusa slap --medusa',
        'medusa slap --config',
        'medusa slap --npm',
        'medusa slap --nuclear'
      ],
      'listen': [
        'medusa listen',
        'medusa watch',
        'medusa medusa listen'
      ],
      'chat': [
        'medusa chat TiLT',
        'medusa live Medusa'
      ],
      'therapy': [
        'medusa therapy'
      ],
      'meme': [
        'medusa meme'
      ]
    };

    return examples[commandName] || [`medusa ${commandName}`];
  }

  /**
   * Display the comprehensive help
   */
  showHelp(specificCommand = null) {
    if (specificCommand) {
      this.showCommandHelp(specificCommand);
      return;
    }

    this.showBanner();
    this.showOverview();
    this.showQuickStart();
    this.showCommandsByCategory();
    this.showFooter();
  }

  /**
   * Show Medusa banner
   */
  showBanner() {
    console.log(chalk.magenta(figlet.textSync('Medusa', {
      font: 'isometric3',
      horizontalLayout: 'default',
      verticalLayout: 'default'
    })));
    console.log(chalk.cyan('Bidirectional Interface for Chat Handoffs'));
    console.log(chalk.yellow(`Version ${packageJson.version} - Medusa Chat Protocol (MCP)`));
    console.log(chalk.gray('Making workspace coordination inappropriately efficient since 2025\n'));
  }

  /**
   * Show overview and description
   */
  showOverview() {
    console.log(chalk.cyan('📖 Overview:'));
    console.log(chalk.white('Medusa is a CLI tool for developers to coordinate between multiple Cursor workspaces'));
    console.log(chalk.white('with autonomous AI conversation capabilities via the Medusa Chat Protocol.\n'));

    console.log(chalk.cyan('🎯 Key Features:'));
    console.log(chalk.white('• Cross-workspace messaging and coordination'));
    console.log(chalk.white('• Autonomous AI-to-AI conversations'));
    console.log(chalk.white('• Real-time workspace monitoring'));

    console.log(chalk.white('• Professional server-based architecture\n'));
  }

  /**
   * Show quick start guide
   */
  showQuickStart() {
    console.log(chalk.cyan('🚀 Quick Start:'));
    console.log(chalk.yellow('1. First-time setup:') + chalk.white('    medusa setup --wizard'));
    console.log(chalk.yellow('2. Check status:') + chalk.white('       medusa status'));
    console.log(chalk.yellow('3. Start Medusa server:') + chalk.white(' medusa medusa start'));
    console.log(chalk.yellow('4. Register workspace:') + chalk.white('  medusa medusa register'));
    console.log(chalk.yellow('5. Start listening:') + chalk.white('     medusa medusa listen'));
    console.log(chalk.yellow('6. Send a message:') + chalk.white('     medusa medusa send <workspace> "Hello!"'));
    console.log('');
  }

  /**
   * Show commands organized by category
   */
  showCommandsByCategory() {
    console.log(chalk.cyan('📋 Commands by Category:\n'));

    // Group commands by category
    const categorized = new Map();
    for (const [name, info] of this.commands) {
      const category = info.category;
      if (!categorized.has(category)) {
        categorized.set(category, []);
      }
      categorized.get(category).push({ name, ...info });
    }

    // Display each category
    for (const [category, commands] of categorized) {
      console.log(chalk.yellow(`${category}:`));

      for (const cmd of commands.sort((a, b) => a.name.localeCompare(b.name))) {
        const aliases = cmd.aliases.length > 0 ? chalk.gray(` (${cmd.aliases.join(', ')})`) : '';
        console.log(`  ${chalk.green(cmd.name)}${aliases}`);
        console.log(`    ${chalk.white(cmd.description)}`);

        // Show subcommands if any
        if (cmd.subcommands.length > 0) {
          console.log(`    ${chalk.gray('Subcommands:')}`);
          for (const subcmd of cmd.subcommands) {
            const subAliases = subcmd.aliases.length > 0 ? chalk.gray(` (${subcmd.aliases.join(', ')})`) : '';
            console.log(`      ${chalk.cyan(subcmd.fullName)}${subAliases} - ${subcmd.description}`);
          }
        }

        // Show primary example
        if (cmd.examples.length > 0) {
          console.log(`    ${chalk.gray('Example:')} ${chalk.cyan(cmd.examples[0])}`);
        }
        console.log('');
      }
    }
  }

  /**
   * Show detailed help for a specific command
   */
  showCommandHelp(commandName) {
    const cmd = this.commands.get(commandName);
    if (!cmd) {
      console.log(chalk.red(`❌ Unknown command: ${commandName}`));
      console.log(chalk.yellow('Run "medusa help" to see all available commands'));
      return;
    }

    console.log(chalk.cyan(`📖 Help: ${cmd.name}\n`));

    // Description
    console.log(chalk.yellow('Description:'));
    console.log(`  ${cmd.description}\n`);

    // Aliases
    if (cmd.aliases.length > 0) {
      console.log(chalk.yellow('Aliases:'));
      console.log(`  ${cmd.aliases.join(', ')}\n`);
    }

    // Usage
    console.log(chalk.yellow('Usage:'));
    console.log(`  medusa ${cmd.name} ${cmd.usage || ''}\n`);

    // Arguments
    if (cmd.args.length > 0) {
      console.log(chalk.yellow('Arguments:'));
      for (const arg of cmd.args) {
        const required = arg.required ? chalk.red('*') : ' ';
        const variadic = arg.variadic ? '...' : '';
        console.log(`  ${required}${arg.name}${variadic}  ${arg.description}`);
      }
      console.log('');
    }

    // Options
    if (cmd.options.length > 0) {
      console.log(chalk.yellow('Options:'));
      for (const opt of cmd.options) {
        const defaultVal = opt.defaultValue ? chalk.gray(` (default: ${opt.defaultValue})`) : '';
        console.log(`  ${chalk.green(opt.flags)}  ${opt.description}${defaultVal}`);
      }
      console.log('');
    }

    // Examples
    if (cmd.examples.length > 0) {
      console.log(chalk.yellow('Examples:'));
      for (const example of cmd.examples) {
        console.log(`  ${chalk.cyan(example)}`);
      }
      console.log('');
    }

    // Category
    console.log(chalk.yellow('Category:'));
    console.log(`  ${cmd.category}\n`);
  }

  /**
   * Show footer with additional help
   */
  showFooter() {
    console.log(chalk.cyan('💡 Additional Help:'));
    console.log(chalk.white('• Detailed command help:') + chalk.cyan('  medusa help <command>'));
    console.log(chalk.white('• Check system status:') + chalk.cyan('    medusa status'));
    console.log(chalk.white('• Emergency reset:') + chalk.cyan('       medusa slap --nuclear'));
    console.log(chalk.white('• Medusa dashboard:') + chalk.cyan('      http://localhost:8181'));
    console.log(chalk.white('• Need therapy?') + chalk.cyan('          medusa therapy'));
    console.log('');

    console.log(chalk.gray('For more information, visit: https://github.com/Jason-Vaughan/Medusa'));
    console.log(chalk.gray('Report issues: https://github.com/Jason-Vaughan/Medusa/issues'));
    console.log('');

    console.log(chalk.magenta('Remember: Medusa is here to make your workspace coordination'));
    console.log(chalk.magenta('inappropriately efficient. Embrace the snark! 😏'));
  }

  /**
   * Show command list in compact format
   */
  showCommandList() {
    console.log(chalk.cyan('📋 Available Commands:\n'));

    const commands = Array.from(this.commands.values())
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const cmd of commands) {
      const aliases = cmd.aliases.length > 0 ? chalk.gray(` (${cmd.aliases.join(', ')})`) : '';
      console.log(`${chalk.green(cmd.name)}${aliases} - ${cmd.description}`);
    }

    console.log(chalk.gray('\nRun "medusa help <command>" for detailed help on any command'));
  }

  /**
   * Search commands by keyword
   */
  searchCommands(keyword) {
    const results = [];
    const searchTerm = keyword.toLowerCase();

    for (const [name, info] of this.commands) {
      if (name.toLowerCase().includes(searchTerm) ||
          info.description.toLowerCase().includes(searchTerm) ||
          info.aliases.some(alias => alias.toLowerCase().includes(searchTerm))) {
        results.push({ name, ...info });
      }
    }

    if (results.length === 0) {
      console.log(chalk.yellow(`No commands found matching "${keyword}"`));
      return;
    }

    console.log(chalk.cyan(`🔍 Commands matching "${keyword}":\n`));

    for (const cmd of results) {
      const aliases = cmd.aliases.length > 0 ? chalk.gray(` (${cmd.aliases.join(', ')})`) : '';
      console.log(`${chalk.green(cmd.name)}${aliases} - ${cmd.description}`);
    }
  }

  /**
   * Get command statistics
   */
  getStats() {
    const categories = new Map();
    let totalCommands = 0;
    let totalAliases = 0;

    for (const [name, info] of this.commands) {
      totalCommands++;
      totalAliases += info.aliases.length;

      const category = info.category;
      categories.set(category, (categories.get(category) || 0) + 1);
    }

    return {
      totalCommands,
      totalAliases,
      categories: Object.fromEntries(categories)
    };
  }
}

module.exports = HelpSystem;