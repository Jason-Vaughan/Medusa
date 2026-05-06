const MedusaWizard = require('./MedusaWizard');
const inquirer = require('inquirer');
const ConfigManager = require('../config/ConfigManager');
const WorkspaceDetector = require('../workspace/WorkspaceDetector');
const MedusaNotifier = require('../utils/MedusaNotifier');
const figlet = require('figlet');

// Mock dependencies
jest.mock('inquirer');
jest.mock('../config/ConfigManager');
jest.mock('../workspace/WorkspaceDetector');
jest.mock('../utils/MedusaNotifier');
jest.mock('figlet', () => ({
  textSync: jest.fn().mockReturnValue('MEDUSA')
}));

describe('MedusaWizard', () => {
  let wizard;
  let mockConfigManager;
  let mockWorkspaceDetector;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup detector mock
    WorkspaceDetector.prototype.getCurrentWorkspace.mockResolvedValue('BETA-WS');
    WorkspaceDetector.prototype.getActiveWorkspaces.mockResolvedValue({
      current: 'BETA-WS',
      active: ['BETA-WS', 'DEV-WS']
    });
    WorkspaceDetector.prototype.validateConnectionActive.mockResolvedValue({
      bothActive: true,
      devActive: true,
      betaActive: true
    });

    wizard = new MedusaWizard();
    mockConfigManager = wizard.configManager;
    mockWorkspaceDetector = wizard.workspaceDetector;
    
    // Silence console
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'clear').mockImplementation();
    jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('Process.exit called'); });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Full Flow', () => {
    test('should complete the full wizard flow successfully', async () => {
      // Step 1: Welcome
      inquirer.prompt.mockResolvedValueOnce({
        userName: 'Jason',
        experience: 'intermediate',
        readyToProceed: true
      })
      // Step 3: Connection Setup (suggested roles)
      .mockResolvedValueOnce({
        useRoles: 'suggested'
      })
      // Step 4: Validate Workspaces (already mocked as true, no prompt)
      // Step 5: Final Configuration
      .mockResolvedValueOnce({
        sassLevel: 'max',
        features: ['notifications', 'humor']
      });

      await wizard.startWizard();

      expect(wizard.wizardState.config.userName).toBe('Jason');
      expect(wizard.wizardState.config.devWorkspace).toBe('DEV-WS');
      expect(wizard.wizardState.config.betaWorkspace).toBe('BETA-WS');
      expect(mockConfigManager.saveMedusaConfig).toHaveBeenCalledWith(expect.objectContaining({
        dev: 'DEV-WS',
        beta: 'BETA-WS',
        sassLevel: 'max'
      }));
    });

    test('should handle manual workspace selection', async () => {
      // Mock Step 1
      inquirer.prompt.mockResolvedValueOnce({ userName: 'J', experience: 'expert', readyToProceed: true })
      // Step 3: Manual selection
      .mockResolvedValueOnce({ useRoles: 'manual' })
      .mockResolvedValueOnce({ devWorkspace: 'ManualDev' })
      .mockResolvedValueOnce({ betaWorkspace: 'ManualBeta' })
      // Step 5
      .mockResolvedValueOnce({ sassLevel: 'medium', features: [] });

      // Mock validation for manual workspaces
      mockWorkspaceDetector.validateConnectionActive.mockResolvedValue({ bothActive: true });

      await wizard.startWizard();

      expect(wizard.wizardState.config.devWorkspace).toBe('ManualDev');
      expect(wizard.wizardState.config.betaWorkspace).toBe('ManualBeta');
    });
  });

  describe('Edge Cases', () => {
    test('should exit if user is not ready', async () => {
      inquirer.prompt.mockResolvedValueOnce({ readyToProceed: false });
      
      await expect(wizard.stepWelcome()).rejects.toThrow('Process.exit called');
    });

    test('should wait for workspaces if none detected', async () => {
      mockWorkspaceDetector.getActiveWorkspaces.mockResolvedValueOnce({ active: [] }) // first scan
                                               .mockResolvedValueOnce({ active: ['W1', 'W2'] }); // second scan
      
      inquirer.prompt.mockResolvedValueOnce({ openWorkspaces: true }) // proceed to wait
                     .mockResolvedValueOnce({ continue: '' }); // press enter

      await wizard.stepWorkspaceDetection();
      
      expect(wizard.wizardState.activeWorkspaces).toEqual(['W1', 'W2']);
    });

    test('should handle validation failure and wait for missing workspaces', async () => {
      wizard.wizardState.config = { devWorkspace: 'D', betaWorkspace: 'B' };
      
      // First validation fails
      mockWorkspaceDetector.validateConnectionActive.mockResolvedValueOnce({ bothActive: false, devActive: false, betaActive: true })
                                                     .mockResolvedValueOnce({ bothActive: true }); // next attempt succeeds
      
      inquirer.prompt.mockResolvedValueOnce({ waitForWorkspaces: true });

      // Use real timers for the wait loop but mock the delay? 
      // Actually, MedusaWizard uses a manual Promise delay.
      jest.useFakeTimers();
      
      const stepPromise = wizard.stepValidateWorkspaces();
      
      // Advance timers to trigger the loop
      await jest.advanceTimersByTimeAsync(2000);
      
      await stepPromise;
      
      expect(mockWorkspaceDetector.validateConnectionActive).toHaveBeenCalledTimes(2);
      jest.useRealTimers();
    });
  });

  describe('Error Handling and Edge Cases', () => {
    test('handleWizardError logs appropriate messages', () => {
      const spy = jest.spyOn(console, 'log').mockImplementation();
      wizard.handleWizardError(new Error('Chaos!'));
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('Wizard encountered a situation'));
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('Chaos!'));
    });

    test('promptForMoreWorkspaces exits if user refuses', async () => {
      inquirer.prompt.mockResolvedValueOnce({ openAnother: false });
      await expect(wizard.promptForMoreWorkspaces()).rejects.toThrow('Process.exit called');
    });

    test('saveConfiguration throws and logs on error', async () => {
      mockConfigManager.saveMedusaConfig.mockRejectedValueOnce(new Error('Disk Full'));
      const spy = jest.spyOn(console, 'log').mockImplementation();
      
      await expect(wizard.saveConfiguration()).rejects.toThrow('Disk Full');
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to save configuration'), 
        'Disk Full'
      );
    });
  });

  describe('Personalization', () => {
    test('getPersonalizedGreeting handles expert level', () => {
      expect(wizard.getPersonalizedGreeting('expert')).toContain('full Medusa experience');
    });

    test('getPersonalizedGreeting defaults to intermediate', () => {
      expect(wizard.getPersonalizedGreeting('unknown')).toContain('let\'s get this situation sorted');
    });
  });
});
