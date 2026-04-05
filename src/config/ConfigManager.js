/**
 * ConfigManager - Manages your Connection configuration
 *
 * Because even dysfunctional workspace relationships need proper setup.
 * Handles the sacred bond between DEV and BETA workspaces.
 */

const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const inquirer = require('inquirer');
const chalk = require('chalk');
const { MedusaError } = require('../utils/ErrorHandler');

// Try to load the medusa.config.js file for enhanced configuration
let medusaConfig = {};
try {
  const configPath = path.join(process.cwd(), 'medusa.config.js');
  if (fs.existsSync(configPath)) {
    medusaConfig = require(configPath);
  }
} catch (error) {
  // Config file not found or invalid, use defaults
}

class ConfigManager {
  constructor() {
    // Global Medusa configuration directory
    this.globalConfigDir = path.join(os.homedir(), '.medusa');
    this.globalConfigFile = path.join(this.globalConfigDir, 'config.json');
    this.workspaceMapFile = path.join(this.globalConfigDir, 'workspaces.json');

    // Ensure the global config directory exists (create the medusa-cave)
    this.ensureGlobalConfigExists();
  }

  /**
   * Ensure the global Medusa configuration directory exists
   */
  async ensureGlobalConfigExists() {
    try {
      await fs.ensureDir(this.globalConfigDir);

      // Create a welcome file for first-time users
      const welcomeFile = path.join(this.globalConfigDir, 'welcome.txt');
      if (!await fs.pathExists(welcomeFile)) {
        await fs.writeFile(welcomeFile,
          '🎉 Welcome to Medusa!\n\n' +
          'This directory contains your global Medusa configuration.\n' +
          'Here\'s where all your workspace drama gets stored.\n\n' +
          'Files you might find here:\n' +
          '- config.json: Your Connection settings\n' +
          '- workspaces.json: Workspace location mappings\n' +
          '- messages/: Global message queue directory\n\n' +
          'Remember: With great Medusa power comes great responsibility.\n' +
          'Use it wisely, or at least entertainingly.\n\n' +
          '💕 The Medusa Team'
        );
      }
    } catch (error) {
      throw new MedusaError(`Failed to create Medusa config directory: ${error.message}`, 'CONFIG_SETUP_FAILED');
    }
  }

  /**
   * Initialize the Connection between DEV and BETA workspaces
   */
  async initializeConnection(options = {}) {
    try {
      let devWorkspace = options.dev;
      let betaWorkspace = options.beta;

      // Check if config already exists
      const existingConfig = await this.getMedusaConfig();
      if (existingConfig && !options.force) {
        console.log(chalk.yellow('⚠️  Connection already exists!'));
        console.log(chalk.blue(`Current: ${existingConfig.dev} ↔ ${existingConfig.beta}`));

        const answer = await inquirer.prompt([{
          type: 'confirm',
          name: 'reconfigure',
          message: 'Do you want to reconfigure your Connection?',
          default: false
        }]);

        if (!answer.reconfigure) {
          console.log(chalk.gray('Keeping existing Connection (probably for the best)'));
          return existingConfig;
        }
      }

      // Interactive setup if no options provided
      if (!devWorkspace || !betaWorkspace) {
        console.log(chalk.cyan('🤔 Let\'s set up your Connection...\n'));

        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'dev',
            message: 'What\'s your DEV workspace name? (the one that breaks things)',
            default: devWorkspace || 'SPiT',
            validate: (input) => input.trim().length > 0 || 'DEV workspace name is required!'
          },
          {
            type: 'input',
            name: 'beta',
            message: 'What\'s your BETA workspace name? (the one that complains)',
            default: betaWorkspace || 'TiLT',
            validate: (input) => input.trim().length > 0 || 'BETA workspace name is required!'
          },
          {
            type: 'confirm',
            name: 'confirm',
            message: (answers) => `Confirm Connection: ${answers.dev} ↔ ${answers.beta}?`,
            default: true
          }
        ]);

        if (!answers.confirm) {
          throw new MedusaError('Connection setup cancelled (commitment issues?)', 'SETUP_CANCELLED');
        }

        devWorkspace = answers.dev.trim();
        betaWorkspace = answers.beta.trim();
      }

      // Validate workspace names
      if (devWorkspace === betaWorkspace) {
        throw new MedusaError('DEV and BETA workspaces cannot be the same! (That would be talking to yourself)', 'INVALID_WORKSPACE_CONFIG');
      }

      // Create the configuration
      const config = {
        version: '0.1.0',
        dev: devWorkspace,
        beta: betaWorkspace,
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        settings: {
          defaultPriority: false,
          enableNotifications: true,
          maxMessageHistory: 1000,
          autoCleanupDays: 30,
          snarkLevel: 'maximum' // Because we're extra like that
        }
      };

      // Save the configuration
      await fs.writeJson(this.globalConfigFile, config, { spaces: 2 });

      console.log(chalk.green('✅ Connection configuration saved!'));
      console.log(chalk.blue(`📝 Config file: ${this.globalConfigFile}`));

      // Initialize workspace mappings
      await this.initializeWorkspaceMappings(devWorkspace, betaWorkspace);

      return config;

    } catch (error) {
      if (error instanceof MedusaError) {
        throw error;
      }
      throw new MedusaError(`Failed to initialize Connection: ${error.message}`, 'CONFIG_INIT_FAILED');
    }
  }

  /**
   * Initialize workspace location mappings
   */
  async initializeWorkspaceMappings(devWorkspace, betaWorkspace) {
    try {
      const workspaceMap = {
        [devWorkspace]: {
          name: devWorkspace,
          role: 'dev',
          lastSeen: null,
          path: null, // Will be detected when workspace is active
          active: false
        },
        [betaWorkspace]: {
          name: betaWorkspace,
          role: 'beta',
          lastSeen: null,
          path: null,
          active: false
        }
      };

      await fs.writeJson(this.workspaceMapFile, workspaceMap, { spaces: 2 });
      console.log(chalk.gray('📍 Workspace mappings initialized'));

    } catch (error) {
      throw new MedusaError(`Failed to initialize workspace mappings: ${error.message}`, 'WORKSPACE_MAP_FAILED');
    }
  }

  /**
   * Get the current Connection configuration
   */
  async getMedusaConfig() {
    try {
      if (!await fs.pathExists(this.globalConfigFile)) {
        return null;
      }

      const config = await fs.readJson(this.globalConfigFile);
      return config;

    } catch (error) {
      throw new MedusaError(`Failed to read Medusa configuration: ${error.message}`, 'CONFIG_READ_FAILED');
    }
  }

  /**
   * Validate that a proper Connection is configured
   */
  async validateConnection() {
    const config = await this.getMedusaConfig();

    if (!config) {
      throw new MedusaError(
        'No Connection configured! Run: medusa setup --dev <name> --beta <name>',
        'NO_CONNECTION'
      );
    }

    if (!config.dev || !config.beta) {
      throw new MedusaError(
        'Invalid Connection configuration! Missing DEV or BETA workspace.',
        'INVALID_CONNECTION'
      );
    }

    return config;
  }

  /**
   * Update workspace mapping with current location
   */
  async updateWorkspaceLocation(workspaceName, workspacePath) {
    try {
      let workspaceMap = {};

      if (await fs.pathExists(this.workspaceMapFile)) {
        workspaceMap = await fs.readJson(this.workspaceMapFile);
      }

      if (workspaceMap[workspaceName]) {
        workspaceMap[workspaceName].path = workspacePath;
        workspaceMap[workspaceName].lastSeen = new Date().toISOString();
        workspaceMap[workspaceName].active = true;

        await fs.writeJson(this.workspaceMapFile, workspaceMap, { spaces: 2 });
      }

    } catch (error) {
      // Non-critical error, log but don't throw
      console.log(chalk.gray(`⚠️  Could not update workspace location: ${error.message}`));
    }
  }

  /**
   * Get workspace mappings
   */
  async getWorkspaceMappings() {
    try {
      if (!await fs.pathExists(this.workspaceMapFile)) {
        return {};
      }

      return await fs.readJson(this.workspaceMapFile);

    } catch (error) {
      console.log(chalk.gray(`⚠️  Could not read workspace mappings: ${error.message}`));
      return {};
    }
  }

  /**
   * Save Medusa configuration (used by wizard)
   */
  async saveMedusaConfig(config) {
    try {
      await fs.writeJson(this.globalConfigFile, config, { spaces: 2 });
      console.log(chalk.green('✅ Medusa configuration saved successfully!'));
      return config;
    } catch (error) {
      throw new MedusaError(`Failed to save Medusa configuration: ${error.message}`, 'CONFIG_SAVE_FAILED');
    }
  }

  /**
   * Update configuration settings
   */
  async updateSettings(newSettings) {
    try {
      const config = await this.validateConnection();

      config.settings = { ...config.settings, ...newSettings };
      config.lastModified = new Date().toISOString();

      await fs.writeJson(this.globalConfigFile, config, { spaces: 2 });

      console.log(chalk.green('✅ Medusa settings updated successfully!'));
      return config;

    } catch (error) {
      throw new MedusaError(`Failed to update settings: ${error.message}`, 'SETTINGS_UPDATE_FAILED');
    }
  }

  /**
   * Reset configuration (nuclear option)
   */
  async resetConfiguration() {
    try {
      const answer = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: 'Are you sure you want to reset ALL Medusa configuration? (This will destroy your Connection)',
        default: false
      }]);

      if (!answer.confirm) {
        console.log(chalk.yellow('Reset cancelled (probably wise)'));
        return false;
      }

      // Remove all config files
      if (await fs.pathExists(this.globalConfigFile)) {
        await fs.remove(this.globalConfigFile);
      }

      if (await fs.pathExists(this.workspaceMapFile)) {
        await fs.remove(this.workspaceMapFile);
      }

      console.log(chalk.green('🧹 Medusa configuration reset successfully!'));
      console.log(chalk.gray('Your Connection has been terminated (it\'s not you, it\'s the config)'));

      return true;

    } catch (error) {
      throw new MedusaError(`Failed to reset configuration: ${error.message}`, 'CONFIG_RESET_FAILED');
    }
  }

  /**
   * Get the global Medusa directory path
   */
  getGlobalConfigDir() {
    return this.globalConfigDir;
  }

  /**
   * Export configuration for backup
   */
  async exportConfiguration() {
    try {
      const config = await this.getMedusaConfig();
      const workspaces = await this.getWorkspaceMappings();

      const exportData = {
        config,
        workspaces,
        exportedAt: new Date().toISOString(),
        version: '0.1.0'
      };

      const exportPath = path.join(os.homedir(), `medusa-config-backup-${Date.now()}.json`);
      await fs.writeJson(exportPath, exportData, { spaces: 2 });

      console.log(chalk.green(`📦 Configuration exported to: ${exportPath}`));
      return exportPath;

    } catch (error) {
      throw new MedusaError(`Failed to export configuration: ${error.message}`, 'CONFIG_EXPORT_FAILED');
    }
  }

  /**
   * Get enhanced configuration with defaults
   */
  getEnhancedConfig() {
    const defaults = {
      identity: "Unknown",
      sassLevel: "medium",
      emojiMode: "neutral",
      responseTemplates: [
        "Message received.",
        "Working on it.",
        "Will look into this.",
        "Thanks for the update."
      ],
      cliQuotes: [
        "Medusa: Professional workspace communication.",
        "Facilitating inter-workspace dialogue.",
        "Your message has been processed."
      ],
      style: {
        promptPrefix: "Medusa says:",
        defaultRecipient: "Unknown",
        colorScheme: "terminalDark",
        verbosity: "normal"
      }
    };

    return { ...defaults, ...medusaConfig };
  }

  /**
   * Get a random response template based on sass level
   */
  getRandomResponseTemplate() {
    const config = this.getEnhancedConfig();
    const templates = config.responseTemplates || [];

    if (templates.length === 0) {
      return "Message processed.";
    }

    const randomIndex = Math.floor(Math.random() * templates.length);
    return templates[randomIndex];
  }

  /**
   * Get a random CLI quote
   */
  getRandomCliQuote() {
    const config = this.getEnhancedConfig();
    const quotes = config.cliQuotes || [];

    if (quotes.length === 0) {
      return "Medusa: Ready to facilitate workspace communication.";
    }

    const randomIndex = Math.floor(Math.random() * quotes.length);
    return quotes[randomIndex];
  }

  /**
   * Apply sass level to a message
   */
  applySassLevel(message, sassLevel = null) {
    const config = this.getEnhancedConfig();
    const level = sassLevel || config.sassLevel || 'medium';

    switch (level) {
      case 'none':
        return message;
      case 'low':
        return `${message} 😊`;
      case 'medium':
        return `${message} 😏`;
      case 'max':
        return `${message} 💅`;
      default:
        return message;
    }
  }

  /**
   * Add emojis based on emoji mode
   */
  addEmojis(message, mode = null) {
    const config = this.getEnhancedConfig();
    const emojiMode = mode || config.emojiMode || 'neutral';

    const emojiSets = {
      off: [],
      neutral: ['😊', '👍', '✅', '💡'],
      aggressive: ['😤', '🔥', '💥', '⚡', '👊'],
      passiveAggressive: ['🙃', '😇', '💅', '🤷', '😏', '🎭']
    };

    const emojis = emojiSets[emojiMode] || emojiSets.neutral;

    if (emojis.length === 0 || Math.random() > 0.3) {
      return message;
    }

    const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
    return `${message} ${randomEmoji}`;
  }

  /**
   * Get sass-enhanced message
   */
  getSassyMessage(baseMessage, options = {}) {
    const config = this.getEnhancedConfig();
    let message = baseMessage;

    // Apply sass level
    if (options.applySass !== false) {
      message = this.applySassLevel(message, options.sassLevel);
    }

    // Add emojis
    if (options.addEmojis !== false) {
      message = this.addEmojis(message, options.emojiMode);
    }

    // Add editorial comments if enabled
    if (config.advanced?.quirks?.addEditorialComments && Math.random() > 0.7) {
      const editorialComments = [
        "(obviously)",
        "(as expected)",
        "(shocking, I know)",
        "(again)",
        "(sigh)",
        "(naturally)"
      ];
      const comment = editorialComments[Math.floor(Math.random() * editorialComments.length)];
      message = `${message} ${comment}`;
    }

    return message;
  }

  /**
   * Check if enhanced config is available
   */
  hasEnhancedConfig() {
    return Object.keys(medusaConfig).length > 0;
  }

  /**
   * Get trigger word behavior
   */
  getTriggerWordBehavior(word) {
    const config = this.getEnhancedConfig();
    return config.triggerWords?.[word] || null;
  }

  /**
   * Get style preferences
   */
  getStylePreferences() {
    const config = this.getEnhancedConfig();
    return config.style || {};
  }

  /**
   * Get current configuration status including enhanced config
   */
  async getConfigStatus() {
    try {
      const globalConfig = await this.getMedusaConfig();
      const workspaceMap = await this.getWorkspaceMappings();
      const enhancedConfig = this.getEnhancedConfig();

      return {
        configured: globalConfig && globalConfig.dev && globalConfig.beta,
        globalConfig,
        workspaceMap,
        enhancedConfig,
        configPath: this.globalConfigFile,
        workspaceMapPath: this.workspaceMapFile,
        hasEnhancedConfig: Object.keys(medusaConfig).length > 0
      };
    } catch (error) {
      throw new MedusaError(`Failed to get configuration status: ${error.message}`, 'CONFIG_STATUS_FAILED');
    }
  }
}

module.exports = ConfigManager;