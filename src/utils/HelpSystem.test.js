const HelpSystem = require('./HelpSystem');
const chalk = require('chalk');
const figlet = require('figlet');

// Mock figlet
jest.mock('figlet', () => ({
  textSync: jest.fn().mockReturnValue('MEDUSA BANNER')
}));

describe('HelpSystem', () => {
  let helpSystem;
  let mockProgram;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create a mock commander program
    const mockCommand = (name, desc, aliases = [], usage = '') => ({
      name: () => name,
      description: () => desc,
      aliases: () => aliases,
      usage: () => usage,
      options: [
        { flags: '--force', description: 'Force it', required: false, defaultValue: undefined }
      ],
      registeredArguments: [
        { name: () => 'id', description: 'The ID', required: true, variadic: false }
      ],
      commands: []
    });

    const cmdWithSub = mockCommand('medusa', 'Medusa root');
    cmdWithSub.commands = [
      {
        name: () => 'start',
        description: () => 'Start it',
        aliases: () => [],
        usage: () => '',
        fullName: 'medusa start' // This is added by HelpSystem during discovery? No, HelpSystem builds it.
      }
    ];

    mockProgram = {
      commands: [
        mockCommand('setup', 'Setup Medusa', ['init']),
        mockCommand('status', 'Check status', ['wtf']),
        cmdWithSub
      ]
    };

    helpSystem = new HelpSystem(mockProgram);
  });

  describe('Command Discovery', () => {
    test('should discover all commands and their metadata', () => {
      const commands = helpSystem.commands;
      expect(commands.has('setup')).toBe(true);
      expect(commands.get('setup').description).toBe('Setup Medusa');
      expect(commands.get('setup').aliases).toContain('init');
    });

    test('should discover subcommands', () => {
      const medusaCmd = helpSystem.commands.get('medusa');
      expect(medusaCmd.subcommands).toHaveLength(1);
      expect(medusaCmd.subcommands[0].name).toBe('start');
    });
  });

  describe('Categorization', () => {
    test('should categorize commands correctly', () => {
      expect(helpSystem.categorizeCommand('setup')).toBe('Setup & Configuration');
      expect(helpSystem.categorizeCommand('medusa')).toBe('Medusa Protocol');
      expect(helpSystem.categorizeCommand('unknown')).toBe('Other');
    });
  });

  describe('Examples', () => {
    test('should provide examples for known commands', () => {
      const examples = helpSystem.getCommandExamples('setup');
      expect(examples).toContain('medusa setup --wizard');
    });

    test('should provide default example for unknown commands', () => {
      const examples = helpSystem.getCommandExamples('mystery');
      expect(examples).toEqual(['medusa mystery']);
    });
  });

  describe('Search and Stats', () => {
    test('searchCommands should find matching commands', () => {
      const spy = jest.spyOn(console, 'log').mockImplementation();
      helpSystem.searchCommands('setup');
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('setup'));
      spy.mockRestore();
    });

    test('getStats should return aggregate information', () => {
      const stats = helpSystem.getStats();
      expect(stats.totalCommands).toBe(3);
      expect(stats.totalAliases).toBe(2); // init, wtf
    });
  });

  describe('Help Display', () => {
    test('showHelp calls display methods', () => {
      const spy = jest.spyOn(console, 'log').mockImplementation();
      helpSystem.showHelp();
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('📖 Overview:'));
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('🚀 Quick Start:'));
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('📋 Commands by Category:'));
      spy.mockRestore();
    });

    test('showCommandHelp displays detailed info', () => {
      const spy = jest.spyOn(console, 'log').mockImplementation();
      helpSystem.showCommandHelp('setup');
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('📖 Help: setup'));
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('Description:'));
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('Arguments:'));
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('Options:'));
      spy.mockRestore();
    });

    test('showCommandHelp handles unknown command', () => {
      const spy = jest.spyOn(console, 'log').mockImplementation();
      helpSystem.showCommandHelp('missing');
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('❌ Unknown command: missing'));
      spy.mockRestore();
    });
  });
});
