/**
 * MedusaWizard - Interactive Medusa Setup Wizard
 *
 * Guides users through the Connection setup process with
 * maximum snark, inappropriate humor, and intelligent workspace detection.
 *
 * Because even relationship setup should be automated and snarky.
 */

const inquirer = require('inquirer');
const chalk = require('chalk');
const figlet = require('figlet');
const ConfigManager = require('../config/ConfigManager');
const WorkspaceDetector = require('../workspace/WorkspaceDetector');
const MedusaNotifier = require('../utils/MedusaNotifier');
const { MedusaError, successWithCelebration, infoWithPersonality } = require('../utils/ErrorHandler');

// Get version from package.json dynamically
const packageJson = require('../../package.json');

class MedusaWizard {
  constructor() {
    this.configManager = new ConfigManager();
    this.workspaceDetector = new WorkspaceDetector();
    this.notifier = new MedusaNotifier();
    this.wizardState = {
      step: 0,
      totalSteps: 6,
      config: {},
      detectedWorkspaces: [],
      activeWorkspaces: []
    };
  }

  /**
   * Start the Medusa Wizard experience
   */
  async startWizard() {
    try {
      this.showWizardIntro();
      await this.stepWelcome();
      await this.stepWorkspaceDetection();
      await this.stepConnectionSetup();
      await this.stepValidateWorkspaces();
      await this.stepFinalConfiguration();
      this.showWizardCompletion();
    } catch (error) {
      this.handleWizardError(error);
    }
  }

  /**
   * Run method for compatibility with CLI
   */
  async run() {
    return this.startWizard();
  }

  /**
   * Show the wizard introduction with proper Medusa branding
   */
  showWizardIntro() {
    console.clear();

    // Show the Medusa logo
    console.log(chalk.magenta(figlet.textSync('Medusa', {
      font: 'isometric3',
      horizontalLayout: 'default',
      verticalLayout: 'default'
    })));
    console.log(chalk.gray('Multi-Editor Distributed Unified Sync Architecture'));
    console.log(chalk.magenta(`🧙‍♀️ Interactive Setup Wizard v${packageJson.version}`));
    console.log(chalk.yellow('Because even tangled relationships need proper configuration\n'));
  }

  /**
   * Step 1: Welcome and user introduction
   */
  async stepWelcome() {
    console.log(chalk.cyan('🎭 Step 1: Welcome to the Status Check\n'));

    // Simple universal logic: Initiator = BETA, Other workspace = DEV
    const currentWorkspace = await this.workspaceDetector.getCurrentWorkspace();
    const workspaceInfo = await this.workspaceDetector.getActiveWorkspaces();

    // Whoever initiates Medusa is assumed to be BETA
    const smartDefault = 'BETA';

    // Find other active workspaces as potential DEV candidates
    const otherWorkspaces = workspaceInfo.active.filter(w => w !== currentWorkspace);

    if (otherWorkspaces.length > 0) {
      // Suggest the first other workspace as DEV
      this.wizardState.suggestedDevWorkspace = otherWorkspaces[0];
      console.log(chalk.gray(`💡 Smart detection: Current workspace (${currentWorkspace}) = BETA`));
      console.log(chalk.gray(`💡 Smart detection: Found potential DEV workspace "${otherWorkspaces[0]}"`));
    } else {
      console.log(chalk.gray(`💡 Smart detection: Current workspace (${currentWorkspace}) = BETA`));
      console.log(chalk.yellow(`⚠️  No other workspaces detected - you'll need to open your DEV workspace`));
    }

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'userName',
        message: 'What should we call you, you beautiful developer?',
        default: smartDefault
      },
      {
        type: 'list',
        name: 'experience',
        message: 'How familiar are you with workspace drama?',
        choices: [
          { name: '😇 New to this (be gentle)', value: 'beginner' },
          { name: '😏 I know my way around (standard snark)', value: 'intermediate' },
          { name: '😈 Maximum chaos please', value: 'expert' }
        ]
      },
      {
        type: 'confirm',
        name: 'readyToProceed',
        message: 'Ready to establish your Connection?',
        default: true
      }
    ]);

    if (!answers.readyToProceed) {
      console.log(chalk.yellow('💔 Setup cancelled. Come back when you\'re ready for commitment.'));
      process.exit(0);
    }

    this.wizardState.config.userName = answers.userName;
    this.wizardState.config.experience = answers.experience;

    const greeting = this.getPersonalizedGreeting(answers.experience);
    console.log(chalk.green(`${greeting} ${answers.userName}! Let's set up your Medusa properly.\n`));
  }

  /**
   * Step 2: Detect active workspaces
   */
  async stepWorkspaceDetection() {
    console.log(chalk.cyan('🔍 Step 2: Workspace Detection\n'));
    console.log(chalk.yellow('Scanning for active Cursor workspaces...'));

    const workspaceInfo = await this.workspaceDetector.getActiveWorkspaces();
    this.wizardState.activeWorkspaces = workspaceInfo.active;
    this.wizardState.currentWorkspace = workspaceInfo.current;

    if (workspaceInfo.active.length === 0) {
      console.log(chalk.red('❌ No active Cursor workspaces detected!'));
      console.log(chalk.yellow('You need to have at least 2 Cursor workspaces open for Medusa to work.'));

      const answer = await inquirer.prompt([{
        type: 'confirm',
        name: 'openWorkspaces',
        message: 'Would you like me to wait while you open your workspaces?',
        default: true
      }]);

      if (answer.openWorkspaces) {
        await this.waitForWorkspaces();
      } else {
        console.log(chalk.red('💔 Medusa needs workspaces to create connections. Exiting...'));
        process.exit(1);
      }
    } else {
      console.log(chalk.green(`✅ Found ${workspaceInfo.active.length} active workspace(s):`));
      workspaceInfo.active.forEach((workspace, index) => {
        const current = workspace === workspaceInfo.current ? chalk.green(' (current)') : '';
        console.log(chalk.white(`   ${index + 1}. ${workspace}${current}`));
      });

      // Show a warning if we detected too many generic workspaces
      if (workspaceInfo.active.length > 10) {
        console.log(chalk.yellow('\n⚠️  Detected many workspaces - some may be system processes.'));
        console.log(chalk.gray('Medusa will help you select the right ones for your Connection.'));
      }

      console.log('');
    }
  }

  /**
   * Step 3: Set up the Connection intelligently
   */
  async stepConnectionSetup() {
    console.log(chalk.cyan('💕 Step 3: Connection Configuration\n'));

    const activeWorkspaces = this.wizardState.activeWorkspaces;
    const currentWorkspace = this.wizardState.currentWorkspace;
    const suggestedDevWorkspace = this.wizardState.suggestedDevWorkspace;

    if (activeWorkspaces.length < 2) {
      console.log(chalk.red('❌ You need at least 2 workspaces for a proper Connection!'));
      await this.promptForMoreWorkspaces();
      return;
    }

    let devWorkspace, betaWorkspace;

    // Use simple universal logic: Current = BETA, Other = DEV
    if (suggestedDevWorkspace) {
      console.log(chalk.yellow('🤖 Smart suggestions based on who initiated Medusa:'));
      console.log(chalk.white(`   BETA (initiator): ${currentWorkspace}`));
      console.log(chalk.white(`   DEV (detected): ${suggestedDevWorkspace}`));

      const roleChoice = await inquirer.prompt([{
        type: 'list',
        name: 'useRoles',
        message: 'How would you like to assign workspace roles?',
        choices: [
          {
            name: `✅ Use suggested roles (${currentWorkspace} = BETA, ${suggestedDevWorkspace} = DEV)`,
            value: 'suggested'
          },
          {
            name: `🔄 Reverse roles (${currentWorkspace} = DEV, ${suggestedDevWorkspace} = BETA)`,
            value: 'reversed'
          },
          {
            name: '⚙️  Manual selection',
            value: 'manual'
          }
        ],
        default: 'suggested'
      }]);

      if (roleChoice.useRoles === 'suggested') {
        betaWorkspace = currentWorkspace;
        devWorkspace = suggestedDevWorkspace;
      } else if (roleChoice.useRoles === 'reversed') {
        devWorkspace = currentWorkspace;
        betaWorkspace = suggestedDevWorkspace;
        console.log(chalk.cyan('🔄 Roles reversed - you know your situation better than I do!'));
      } else {
        const manual = await this.manualWorkspaceSelection();
        devWorkspace = manual.devWorkspace;
        betaWorkspace = manual.betaWorkspace;
      }

    } else {
      // No other workspace detected, go straight to manual
      console.log(chalk.yellow('🤷 Only one workspace detected. Let\'s set this up manually.'));
      const manual = await this.manualWorkspaceSelection();
      devWorkspace = manual.devWorkspace;
      betaWorkspace = manual.betaWorkspace;
    }

    this.wizardState.config.devWorkspace = devWorkspace;
    this.wizardState.config.betaWorkspace = betaWorkspace;

    console.log(chalk.green(`💕 Connection configured: ${devWorkspace} ↔ ${betaWorkspace}\n`));
  }

  /**
   * Step 4: Validate both workspaces are actually open
   */
  async stepValidateWorkspaces() {
    console.log(chalk.cyan('🔍 Step 4: Validating Connection\n'));

    const { devWorkspace, betaWorkspace } = this.wizardState.config;
    const validation = await this.workspaceDetector.validateConnectionActive(devWorkspace, betaWorkspace);

    console.log(chalk.yellow('Checking workspace status...'));
    console.log(chalk.white(`   DEV (${devWorkspace}): ${validation.devActive ? chalk.green('✅ Active') : chalk.red('❌ Not found')}`));
    console.log(chalk.white(`   BETA (${betaWorkspace}): ${validation.betaActive ? chalk.green('✅ Active') : chalk.red('❌ Not found')}`));

    if (!validation.bothActive) {
      console.log(chalk.red('\n💔 Houston, we have a situation!'));

      if (!validation.devActive) {
        console.log(chalk.yellow(`Please open your DEV workspace: ${devWorkspace}`));
      }
      if (!validation.betaActive) {
        console.log(chalk.yellow(`Please open your BETA workspace: ${betaWorkspace}`));
      }

      const wait = await inquirer.prompt([{
        type: 'confirm',
        name: 'waitForWorkspaces',
        message: 'Wait for you to open the missing workspace(s)?',
        default: true
      }]);

      if (wait.waitForWorkspaces) {
        await this.waitForMissingWorkspaces(devWorkspace, betaWorkspace);
      } else {
        console.log(chalk.red('💔 Can\'t establish Connection without both workspaces. Exiting...'));
        process.exit(1);
      }
    } else {
      console.log(chalk.green('\n🎉 Both workspaces are active! Connection validated!'));
    }
  }

  /**
   * Step 5: Final configuration and preferences
   */
  async stepFinalConfiguration() {
    console.log(chalk.cyan('⚙️  Step 5: Final Configuration\n'));

    const preferences = await inquirer.prompt([
      {
        type: 'list',
        name: 'sassLevel',
        message: 'Choose your default sass level:',
        choices: [
          { name: '😇 Professional (minimal snark)', value: 'none' },
          { name: '😏 Sassy (moderate attitude)', value: 'low' },
          { name: '😤 Snarky (standard operations)', value: 'medium' },
          { name: '😈 Maximum Chaos (full Medusa mode)', value: 'max' }
        ],
        default: 'medium'
      },
      {
        type: 'checkbox',
        name: 'features',
        message: 'Enable additional Medusa features:',
        choices: [
          { name: '🔔 System notifications', value: 'notifications', checked: true },
          { name: '🎭 Random memes and quotes', value: 'humor', checked: true },
          { name: '🧠 Therapy sessions', value: 'therapy', checked: true },
          { name: '🎪 Easter eggs and chaos', value: 'easterEggs', checked: false }
        ]
      }
    ]);

    this.wizardState.config.sassLevel = preferences.sassLevel;
    this.wizardState.config.enabledFeatures = preferences.features;

    // Save the configuration
    await this.saveConfiguration();
  }

  /**
   * Manual workspace selection
   */
  async manualWorkspaceSelection() {
    const choices = this.wizardState.activeWorkspaces.map(workspace => ({
      name: workspace,
      value: workspace
    }));

    // First prompt - select DEV workspace
    const devAnswer = await inquirer.prompt([
      {
        type: 'list',
        name: 'devWorkspace',
        message: 'Select your DEV workspace:',
        choices: choices
      }
    ]);

    // Second prompt - select BETA workspace (excluding DEV choice)
    const betaAnswer = await inquirer.prompt([
      {
        type: 'list',
        name: 'betaWorkspace',
        message: 'Select your BETA workspace:',
        choices: choices.filter(choice => choice.value !== devAnswer.devWorkspace)
      }
    ]);

    return {
      devWorkspace: devAnswer.devWorkspace,
      betaWorkspace: betaAnswer.betaWorkspace
    };
  }

  /**
   * Wait for workspaces to be opened
   */
  async waitForWorkspaces() {
    console.log(chalk.yellow('\n⏳ Waiting for workspaces to be detected...'));
    console.log(chalk.gray('Open your Cursor workspaces and press Enter when ready.'));

    await inquirer.prompt([{
      type: 'input',
      name: 'continue',
      message: 'Press Enter when you have your workspaces open...'
    }]);

    // Re-detect workspaces
    await this.stepWorkspaceDetection();
  }

  /**
   * Wait for missing workspaces
   */
  async waitForMissingWorkspaces(devWorkspace, betaWorkspace) {
    let attempts = 0;
    const maxAttempts = 5;

    while (attempts < maxAttempts) {
      console.log(chalk.yellow(`\n⏳ Attempt ${attempts + 1}/${maxAttempts}: Checking for workspaces...`));

      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds

      const validation = await this.workspaceDetector.validateConnectionActive(devWorkspace, betaWorkspace);

      if (validation.bothActive) {
        console.log(chalk.green('🎉 Both workspaces detected! Continuing...'));
        return;
      }

      attempts++;

      if (attempts < maxAttempts) {
        console.log(chalk.yellow('Still waiting... Make sure both workspaces are open in Cursor.'));
      }
    }

    console.log(chalk.red('💔 Timeout waiting for workspaces. Please run the wizard again when both are open.'));
    process.exit(1);
  }

  /**
   * Prompt for more workspaces
   */
  async promptForMoreWorkspaces() {
    console.log(chalk.yellow('You need to open another Cursor workspace to create a proper Connection.'));

    const answer = await inquirer.prompt([{
      type: 'confirm',
      name: 'openAnother',
      message: 'Open another workspace and continue?',
      default: true
    }]);

    if (answer.openAnother) {
      await this.waitForWorkspaces();
      await this.stepConnectionSetup(); // Retry this step
    } else {
      console.log(chalk.red('💔 Medusa needs multiple workspaces. Come back when you\'re ready for polyamory.'));
      process.exit(1);
    }
  }

  /**
   * Save the configuration
   */
  async saveConfiguration() {
    try {
      const config = {
        dev: this.wizardState.config.devWorkspace,
        beta: this.wizardState.config.betaWorkspace,
        userName: this.wizardState.config.userName,
        sassLevel: this.wizardState.config.sassLevel,
        enabledFeatures: this.wizardState.config.enabledFeatures,
        setupDate: new Date().toISOString(),
        version: packageJson.version
      };

      await this.configManager.saveMedusaConfig(config);
      console.log(chalk.green('✅ Configuration saved successfully!'));

    } catch (error) {
      console.log(chalk.red('❌ Failed to save configuration:'), error.message);
      throw error;
    }
  }

  /**
   * Get personalized greeting based on experience level
   */
  getPersonalizedGreeting(experience) {
    const greetings = {
      beginner: '🌸 Welcome, sweet summer child!',
      intermediate: '😎 Alright, let\'s get this situation sorted!',
      expert: '😈 Oh, you want the full Medusa experience? Buckle up!'
    };

    return greetings[experience] || greetings.intermediate;
  }

  /**
   * Show completion with style
   */
  showWizardCompletion() {
    console.log(chalk.green(`\n🎉 Medusa Wizard v${packageJson.version} Complete!\n`));

    // Show the configuration summary
    console.log(chalk.cyan('📋 Your Connection Summary:'));
    console.log(chalk.white(`   👤 User: ${this.wizardState.config.userName}`));
    console.log(chalk.white(`   💕 DEV ↔ BETA: ${this.wizardState.config.devWorkspace} ↔ ${this.wizardState.config.betaWorkspace}`));
    console.log(chalk.white(`   😈 Sass Level: ${this.wizardState.config.sassLevel}`));
    console.log(chalk.white(`   🎪 Features: ${this.wizardState.config.enabledFeatures?.join(', ') || 'Standard'}`));
    console.log(chalk.white(`   🚀 Medusa Version: ${packageJson.version}`));

    console.log(chalk.magenta('\n🚀 Ready to start coordinating!'));
    console.log(chalk.yellow('Try these commands:'));
    console.log(chalk.gray('   medusa status    - Check your status'));
    console.log(chalk.gray('   medusa send --to <workspace> --msg "Hello!"'));
    console.log(chalk.gray('   medusa therapy   - Get emotional support'));
    console.log(chalk.gray('   medusa meme      - Random entertainment\n'));

    console.log(chalk.green('🎭 Welcome to the Medusa family! 💕'));
  }

  /**
   * Handle errors with appropriate snark
   */
  handleWizardError(error) {
    console.log(chalk.red('\n💥 Wizard encountered a situation!'));
    console.log(chalk.yellow(error.message));
    console.log(chalk.gray('\nTry running: medusa wizard --help'));
    console.log(chalk.gray('Or: medusa therapy (for emotional support)'));
  }
}

module.exports = MedusaWizard;