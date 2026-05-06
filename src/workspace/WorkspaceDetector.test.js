const WorkspaceDetector = require('./WorkspaceDetector');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const util = require('util');

// Mock child_process
jest.mock('child_process');
// Mock fs-extra
jest.mock('fs-extra');

describe('WorkspaceDetector', () => {
  let detector;

  beforeEach(() => {
    jest.clearAllMocks();
    detector = new WorkspaceDetector();
  });

  describe('Platform Specifics', () => {
    test('getCursorProcessName returns correct name for each platform', () => {
      const platforms = {
        'darwin': 'Cursor',
        'win32': 'Cursor.exe',
        'linux': 'cursor'
      };
      
      for (const [platform, expected] of Object.entries(platforms)) {
        jest.spyOn(os, 'platform').mockReturnValue(platform);
        const d = new WorkspaceDetector();
        expect(d.getCursorProcessName()).toBe(expected);
      }
    });
  });

  describe('Current Workspace', () => {
    test('getCurrentWorkspace detects project names from CWD', async () => {
      jest.spyOn(process, 'cwd').mockReturnValue('/Users/jason/Projects/Medusa');
      expect(await detector.getCurrentWorkspace()).toBe('Medusa');

      jest.spyOn(process, 'cwd').mockReturnValue('/Users/jason/Projects/SPiT-Dev');
      expect(await detector.getCurrentWorkspace()).toBe('SPiT');
    });

    test('getCurrentWorkspace defaults to directory name', async () => {
      jest.spyOn(process, 'cwd').mockReturnValue('/Users/jason/unknown-project');
      expect(await detector.getCurrentWorkspace()).toBe('unknown-project');
    });
  });

  describe('Process Parsing', () => {
    test('extractPID should find numbers in process line', () => {
      expect(detector.extractPID('user  12345  0.0  0.1 ...')).toBe(12345);
      expect(detector.extractPID('invalid line')).toBeNull();
    });

    test('parseProcessForWorkspace extracts path segment', async () => {
      const line = 'user 1234 /Applications/Cursor.app/Contents/MacOS/Cursor --folder-uri /Users/j/Code/MyProject';
      const info = await detector.parseProcessForWorkspace(line);
      expect(info.name).toBe('MyProject');
      expect(info.pid).toBe(1234);
    });

    test('parseProcessForWorkspace filters out generic segments', async () => {
      const line = 'user 1234 /usr/bin/Cursor';
      const info = await detector.parseProcessForWorkspace(line);
      expect(info).toBeNull();
    });
  });

  describe('Connection Validation', () => {
    test('validateConnectionActive considers current workspace active', async () => {
      jest.spyOn(detector, 'getCurrentWorkspace').mockResolvedValue('BETA');
      jest.spyOn(detector, 'getCursorProcesses').mockResolvedValue([]); // No processes found
      
      const result = await detector.validateConnectionActive('DEV', 'BETA');
      
      expect(result.betaActive).toBe(true); // Because it is the current workspace
      expect(result.devActive).toBe(false);
      expect(result.bothActive).toBe(false);
    });

    test('validateConnectionActive finds other active workspaces', async () => {
      jest.spyOn(detector, 'getCurrentWorkspace').mockResolvedValue('BETA');
      // Mock processes for DEV
      jest.spyOn(detector, 'getCursorProcesses').mockResolvedValue(['user 1 /Code/DEV']);
      
      const result = await detector.validateConnectionActive('DEV', 'BETA');
      
      expect(result.devActive).toBe(true);
      expect(result.betaActive).toBe(true);
      expect(result.bothActive).toBe(true);
    });
  });

  describe('Workspace Indicators', () => {
    test('isInCursorWorkspace checks for common files', async () => {
      fs.pathExists.mockResolvedValueOnce(false) // .cursor
                   .mockResolvedValueOnce(true); // .vscode
      
      expect(await detector.isInCursorWorkspace()).toBe(true);
    });

    test('getWorkspacePath searches common locations', async () => {
      jest.spyOn(os, 'homedir').mockReturnValue('/home/user');
      fs.pathExists.mockImplementation(async (p) => p.includes('Documents/Projects'));
      
      const p = await detector.getWorkspacePath('MyProject');
      expect(p).toBe(path.join('/home/user', 'Documents', 'Projects', 'MyProject'));
    });
  });

  describe('Stats and Recommendations', () => {
    test('getWorkspaceStats aggregates data', async () => {
      jest.spyOn(detector, 'getCurrentWorkspace').mockResolvedValue('W1');
      jest.spyOn(detector, 'getCursorProcesses').mockResolvedValue(['user 1 /W2']);
      
      const stats = await detector.getWorkspaceStats();
      expect(stats.totalActive).toBe(1);
      expect(stats.currentWorkspace).toBe('W1');
      expect(stats.detectedWorkspaces).toContain('W2');
    });

    test('generateRecommendations gives advice', () => {
      const recs = detector.generateRecommendations('Unknown', false);
      expect(recs.some(r => r.type === 'warning')).toBe(true);
      expect(recs.some(r => r.type === 'info')).toBe(true);
    });
  });
});
