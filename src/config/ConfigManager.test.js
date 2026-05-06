const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const inquirer = require('inquirer');
const ConfigManager = require('./ConfigManager');
const { MedusaError } = require('../utils/ErrorHandler');

// Mock dependencies
jest.mock('fs-extra');
jest.mock('os');
jest.mock('inquirer');
jest.mock('../utils/ErrorHandler', () => {
  const actual = jest.requireActual('../utils/ErrorHandler');
  return {
    ...actual,
    MedusaError: class extends Error {
      constructor(message, code) {
        super(message);
        this.code = code;
      }
      getSnarkyMessage() { return 'Mocked snark'; }
    }
  };
});

describe('ConfigManager', () => {
  let configManager;
  const mockHomedir = '/mock/home';
  const mockConfigDir = path.join(mockHomedir, '.medusa');
  const mockConfigFile = path.join(mockConfigDir, 'config.json');
  const mockWorkspaceFile = path.join(mockConfigDir, 'workspaces.json');

  beforeEach(() => {
    jest.clearAllMocks();
    os.homedir.mockReturnValue(mockHomedir);
    // We don't instantiate here because the constructor triggers an async call
    // that can interfere with tests if mocks aren't set up yet.
  });

  const createManager = () => {
    return new ConfigManager();
  };

  describe('Initialization', () => {
    test('should set correct global paths', () => {
      configManager = createManager();
      expect(configManager.getGlobalConfigDir()).toBe(mockConfigDir);
      expect(configManager.globalConfigFile).toBe(mockConfigFile);
      expect(configManager.workspaceMapFile).toBe(mockWorkspaceFile);
    });

    test('ensureGlobalConfigExists creates directory and welcome file', async () => {
      fs.pathExists.mockResolvedValue(false);
      configManager = createManager();
      await configManager.ensureGlobalConfigExists();
      
      expect(fs.ensureDir).toHaveBeenCalledWith(mockConfigDir);
      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join(mockConfigDir, 'welcome.txt'),
        expect.stringContaining('Welcome to Medusa')
      );
    });

    test('ensureGlobalConfigExists skip welcome file if it exists', async () => {
      fs.pathExists.mockResolvedValue(true);
      configManager = createManager();
      await configManager.ensureGlobalConfigExists();
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    test('ensureGlobalConfigExists throws MedusaError on failure', async () => {
      // Mock ensureDir to fail for BOTH the constructor call and the manual call
      fs.ensureDir.mockRejectedValue(new Error('Disk Full'));
      configManager = createManager();
      
      // The constructor call will trigger a rejection which might be unhandled
      // unless we catch it or ignore it. In a test environment, we should be careful.
      await expect(configManager.ensureGlobalConfigExists()).rejects.toThrow('Failed to create Medusa config directory');
    });
  });

  describe('Connection Management', () => {
    test('initializeConnection creates config and workspace mappings', async () => {
      fs.pathExists.mockResolvedValue(false);
      configManager = createManager();
      const options = { dev: 'SPiT', beta: 'TiLT' };
      
      const config = await configManager.initializeConnection(options);
      
      expect(config.dev).toBe('SPiT');
      expect(config.beta).toBe('TiLT');
      expect(fs.writeJson).toHaveBeenCalledWith(mockConfigFile, expect.any(Object), { spaces: 2 });
      expect(fs.writeJson).toHaveBeenCalledWith(mockWorkspaceFile, expect.any(Object), { spaces: 2 });
    });

    test('initializeConnection interactive setup', async () => {
      fs.pathExists.mockResolvedValue(false);
      inquirer.prompt.mockResolvedValue({
        dev: 'Alpha',
        beta: 'Omega',
        confirm: true
      });

      const config = await configManager.initializeConnection({});
      
      expect(config.dev).toBe('Alpha');
      expect(config.beta).toBe('Omega');
      expect(inquirer.prompt).toHaveBeenCalled();
    });

    test('initializeConnection throws error if dev and beta are same', async () => {
      fs.pathExists.mockResolvedValue(false);
      const options = { dev: 'Same', beta: 'Same' };
      
      await expect(configManager.initializeConnection(options)).rejects.toThrow('DEV and BETA workspaces cannot be the same');
    });

    test('validateConnection throws if no config exists', async () => {
      fs.pathExists.mockResolvedValue(false);
      await expect(configManager.validateConnection()).rejects.toThrow('No Connection configured');
    });

    test('validateConnection returns config if valid', async () => {
      fs.pathExists.mockResolvedValue(true);
      fs.readJson.mockResolvedValue({ dev: 'SPiT', beta: 'TiLT' });
      
      const config = await configManager.validateConnection();
      expect(config.dev).toBe('SPiT');
    });
  });

  describe('Workspace Mappings', () => {
    test('updateWorkspaceLocation updates existing mapping', async () => {
      fs.pathExists.mockResolvedValue(true);
      fs.readJson.mockResolvedValue({
        'SPiT': { name: 'SPiT', path: null }
      });

      await configManager.updateWorkspaceLocation('SPiT', '/path/to/spit');
      
      expect(fs.writeJson).toHaveBeenCalledWith(
        mockWorkspaceFile,
        expect.objectContaining({
          'SPiT': expect.objectContaining({
            path: '/path/to/spit',
            active: true
          })
        }),
        { spaces: 2 }
      );
    });
  });

  describe('Sass and Personalities', () => {
    test('applySassLevel adds correct emojis', () => {
      expect(configManager.applySassLevel('Hello', 'none')).toBe('Hello');
      expect(configManager.applySassLevel('Hello', 'low')).toBe('Hello 😊');
      expect(configManager.applySassLevel('Hello', 'medium')).toBe('Hello 😏');
      expect(configManager.applySassLevel('Hello', 'max')).toBe('Hello 💅');
    });

    test('getSassyMessage incorporates sass and emojis', () => {
      // Mock Math.random to ensure deterministic results for testing
      const spy = jest.spyOn(Math, 'random').mockReturnValue(0.5);
      
      const msg = configManager.getSassyMessage('Test', { sassLevel: 'max', addEmojis: false });
      expect(msg).toBe('Test 💅');
      
      spy.mockRestore();
    });

    test('getEnhancedConfig returns defaults', () => {
      const config = configManager.getEnhancedConfig();
      expect(config.identity).toBe('Unknown');
      expect(config.sassLevel).toBe('medium');
    });
  });

  describe('Export and Reset', () => {
    test('exportConfiguration writes to home directory', async () => {
      fs.pathExists.mockResolvedValue(true);
      fs.readJson.mockResolvedValueOnce({ dev: 'D' }) // config
                 .mockResolvedValueOnce({ D: {} }); // workspaces
      
      const exportPath = await configManager.exportConfiguration();
      expect(exportPath).toContain('medusa-config-backup-');
      expect(fs.writeJson).toHaveBeenCalledWith(exportPath, expect.any(Object), { spaces: 2 });
    });

    test('resetConfiguration removes files on confirmation', async () => {
      inquirer.prompt.mockResolvedValue({ confirm: true });
      fs.pathExists.mockResolvedValue(true);
      
      const result = await configManager.resetConfiguration();
      
      expect(result).toBe(true);
      expect(fs.remove).toHaveBeenCalledWith(mockConfigFile);
      expect(fs.remove).toHaveBeenCalledWith(mockWorkspaceFile);
    });

    test('resetConfiguration aborts if not confirmed', async () => {
      inquirer.prompt.mockResolvedValue({ confirm: false });
      const result = await configManager.resetConfiguration();
      expect(result).toBe(false);
      expect(fs.remove).not.toHaveBeenCalled();
    });
  });
});
