/**
 * WorkspaceDetector - Finds your Cursor workspaces like a digital bloodhound
 *
 * Detects active Cursor workspaces, determines current workspace context,
 * and keeps track of where your workspaces are located.
 *
 * Because knowing where you are is half the battle in any relationship.
 */

const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');
const chalk = require('chalk');
const { MedusaError } = require('../utils/ErrorHandler');

const execAsync = promisify(exec);

class WorkspaceDetector {
  constructor() {
    this.platform = os.platform();
    this.cursorProcessName = this.getCursorProcessName();
  }

  /**
   * Get the Cursor process name based on platform
   */
  getCursorProcessName() {
    switch (this.platform) {
      case 'darwin': return 'Cursor';
      case 'win32': return 'Cursor.exe';
      case 'linux': return 'cursor';
      default: return 'cursor';
    }
  }

  /**
   * Get currently active Cursor workspaces
   */
  async getActiveWorkspaces() {
    try {
      const processes = await this.getCursorProcesses();
      const workspaces = await this.extractWorkspaceInfo(processes);

      return {
        current: await this.getCurrentWorkspace(),
        active: workspaces.map(w => w.name),
        details: workspaces
      };

    } catch (error) {
      console.log(chalk.gray(`⚠️  Could not detect active workspaces: ${error.message}`));
      return {
        current: null,
        active: [],
        details: []
      };
    }
  }

  /**
   * Get current workspace based on working directory
   */
  async getCurrentWorkspace() {
    try {
      const cwd = process.cwd();
      const workspaceName = path.basename(cwd);

      // Try to detect if we're in a known project structure
      const knownProjects = ['SPiT', 'TiLT', 'Medusa'];
      const foundProject = knownProjects.find(project =>
        workspaceName.toLowerCase().includes(project.toLowerCase()) ||
        cwd.toLowerCase().includes(project.toLowerCase())
      );

      return foundProject || workspaceName;

    } catch (error) {
      console.log(chalk.gray(`⚠️  Could not determine current workspace: ${error.message}`));
      return 'Unknown';
    }
  }

  /**
   * Get Cursor processes running on the system
   */
  async getCursorProcesses() {
    try {
      let command;

      switch (this.platform) {
        case 'darwin':
          command = `ps aux | grep -i "${this.cursorProcessName}" | grep -v grep`;
          break;
        case 'win32':
          command = `tasklist /FI "IMAGENAME eq ${this.cursorProcessName}" /FO CSV`;
          break;
        case 'linux':
          command = `ps aux | grep -i "${this.cursorProcessName}" | grep -v grep`;
          break;
        default:
          command = `ps aux | grep -i "${this.cursorProcessName}" | grep -v grep`;
      }

      const { stdout } = await execAsync(command);
      return stdout.trim().split('\n').filter(line => line.length > 0);

    } catch (error) {
      // If we can't detect processes, return empty array (not critical)
      return [];
    }
  }

  /**
   * Extract workspace information from process list
   */
  async extractWorkspaceInfo(processes) {
    const workspaces = [];

    for (const process of processes) {
      try {
        // This is a simplified approach - in a real implementation,
        // we'd need to parse Cursor's command line arguments or
        // use platform-specific APIs to get window titles
        const workspaceInfo = await this.parseProcessForWorkspace(process);
        if (workspaceInfo) {
          workspaces.push(workspaceInfo);
        }
      } catch (error) {
        // Skip processes we can't parse
        continue;
      }
    }

    return workspaces;
  }

  /**
   * Parse a process line to extract workspace information
   */
  async parseProcessForWorkspace(processLine) {
    try {
      // This is a basic implementation - would need platform-specific parsing
      // For now, we'll try to extract directory names from the process line
      const pathMatches = processLine.match(/\/([^\/\s]+)(?=\s|$)/g);

      if (pathMatches && pathMatches.length > 0) {
        const potentialWorkspace = pathMatches[pathMatches.length - 1].replace('/', '');

        // Filter out system directories and focus on likely project names
        const systemDirs = ['bin', 'usr', 'opt', 'Applications', 'Program Files'];
        if (!systemDirs.some(dir => potentialWorkspace.includes(dir))) {
          return {
            name: potentialWorkspace,
            path: null, // Would need more sophisticated detection
            pid: this.extractPID(processLine),
            active: true
          };
        }
      }

      return null;

    } catch (error) {
      return null;
    }
  }

  /**
   * Extract PID from process line
   */
  extractPID(processLine) {
    try {
      const pidMatch = processLine.match(/\s+(\d+)\s+/);
      return pidMatch ? parseInt(pidMatch[1]) : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Validate if both DEV and BETA workspaces are active
   */
  async validateConnectionActive(devWorkspace, betaWorkspace) {
    try {
      const activeWorkspaces = await this.getActiveWorkspaces();
      const currentWorkspace = await this.getCurrentWorkspace();

      // Build list of active workspace names
      const activeNames = activeWorkspaces.active.map(name => name.toLowerCase());

      // CRITICAL FIX: Current workspace is ALWAYS considered active since we're running from it
      if (currentWorkspace && !activeNames.includes(currentWorkspace.toLowerCase())) {
        activeNames.push(currentWorkspace.toLowerCase());
      }

      const devActive = activeNames.includes(devWorkspace.toLowerCase());
      const betaActive = activeNames.includes(betaWorkspace.toLowerCase());

      return {
        devActive,
        betaActive,
        bothActive: devActive && betaActive,
        activeWorkspaces: [...activeWorkspaces.active, currentWorkspace].filter((v, i, a) => a.indexOf(v) === i) // Remove duplicates
      };

    } catch (error) {
      throw new MedusaError(`Failed to validate workspace activity: ${error.message}`, 'WORKSPACE_VALIDATION_FAILED');
    }
  }

  /**
   * Get workspace path if detectable
   */
  async getWorkspacePath(workspaceName) {
    try {
      // Try common workspace locations
      const commonPaths = [
        path.join(os.homedir(), 'Documents', 'Projects'),
        path.join(os.homedir(), 'Projects'),
        path.join(os.homedir(), 'Development'),
        path.join(os.homedir(), 'Code'),
        path.join(os.homedir(), 'Workspace')
      ];

      for (const basePath of commonPaths) {
        const workspacePath = path.join(basePath, workspaceName);
        if (await fs.pathExists(workspacePath)) {
          return workspacePath;
        }
      }

      return null;

    } catch (error) {
      console.log(chalk.gray(`⚠️  Could not detect workspace path: ${error.message}`));
      return null;
    }
  }

  /**
   * Monitor workspace changes (basic implementation)
   */
  async startWorkspaceMonitoring(callback) {
    try {
      // Simple polling approach - in production, would use file system watchers
      const monitorInterval = setInterval(async () => {
        try {
          const workspaces = await this.getActiveWorkspaces();
          callback(workspaces);
        } catch (error) {
          console.log(chalk.gray(`⚠️  Workspace monitoring error: ${error.message}`));
        }
      }, 5000); // Check every 5 seconds

      return monitorInterval;

    } catch (error) {
      throw new MedusaError(`Failed to start workspace monitoring: ${error.message}`, 'MONITORING_FAILED');
    }
  }

  /**
   * Stop workspace monitoring
   */
  stopWorkspaceMonitoring(monitorInterval) {
    if (monitorInterval) {
      clearInterval(monitorInterval);
    }
  }

  /**
   * Get workspace statistics
   */
  async getWorkspaceStats() {
    try {
      const workspaces = await this.getActiveWorkspaces();

      return {
        totalActive: workspaces.active.length,
        currentWorkspace: workspaces.current,
        detectedWorkspaces: workspaces.active,
        platform: this.platform,
        cursorProcessName: this.cursorProcessName,
        monitoringCapable: true
      };

    } catch (error) {
      throw new MedusaError(`Failed to get workspace statistics: ${error.message}`, 'STATS_FAILED');
    }
  }

  /**
   * Detect if we're running inside a Cursor workspace
   */
  async isInCursorWorkspace() {
    try {
      const cwd = process.cwd();

      // Check for common Cursor workspace indicators
      const cursorIndicators = [
        '.cursor',
        '.vscode', // Cursor is VS Code compatible
        'package.json',
        'tsconfig.json',
        'pyproject.toml',
        'Cargo.toml',
        'go.mod'
      ];

      for (const indicator of cursorIndicators) {
        if (await fs.pathExists(path.join(cwd, indicator))) {
          return true;
        }
      }

      return false;

    } catch (error) {
      return false;
    }
  }

  /**
   * Get recommended workspace setup
   */
  async getRecommendedSetup() {
    try {
      const currentWorkspace = await this.getCurrentWorkspace();
      const isInWorkspace = await this.isInCursorWorkspace();
      const workspacePath = await this.getWorkspacePath(currentWorkspace);

      return {
        currentWorkspace,
        isInWorkspace,
        workspacePath,
        recommendations: this.generateRecommendations(currentWorkspace, isInWorkspace)
      };

    } catch (error) {
      throw new MedusaError(`Failed to get recommended setup: ${error.message}`, 'RECOMMENDATION_FAILED');
    }
  }

  /**
   * Generate setup recommendations
   */
  generateRecommendations(currentWorkspace, isInWorkspace) {
    const recommendations = [];

    if (!isInWorkspace) {
      recommendations.push({
        type: 'warning',
        message: 'You don\'t appear to be in a Cursor workspace. Medusa works best when run from within your project directories.'
      });
    }

    if (currentWorkspace === 'Unknown') {
      recommendations.push({
        type: 'info',
        message: 'Could not detect your current workspace. Consider running Medusa from your project root directory.'
      });
    }

    recommendations.push({
      type: 'tip',
      message: 'For best results, open both your DEV and BETA workspaces in separate Cursor windows before setting up Medusa.'
    });

    return recommendations;
  }
}

module.exports = WorkspaceDetector;