/**
 * ErrorHandler - Handles all your Medusa errors with attitude
 *
 * Because even error messages should have personality.
 * Provides custom error types and snarky error handling.
 */

const chalk = require('chalk');

/**
 * Custom Medusa Error class
 */
class MedusaError extends Error {
  constructor(message, code = 'MEDUSA_ERROR', details = null) {
    super(message);
    this.name = 'MedusaError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
    this.severity = this.calculateErrorSeverity(message);
  }

  /**
   * Calculate the severity of this error
   */
  calculateErrorSeverity(message) {
    const snarkPhrases = [
      'failed', 'broken', 'invalid', 'missing', 'not found', 'denied',
      'timeout', 'crashed', 'corrupted', 'unauthorized'
    ];

    const lowerMessage = message.toLowerCase();
    const snarkCount = snarkPhrases.filter(phrase =>
      lowerMessage.includes(phrase)
    ).length;

    if (snarkCount >= 3) return 'maximum';
    if (snarkCount >= 2) return 'high';
    if (snarkCount >= 1) return 'medium';
    return 'low';
  }

  /**
   * Get a snarky error message based on the error code
   */
  getSnarkyMessage() {
    const snarkyMessages = {
      'CONFIG_SETUP_FAILED': 'Well, that\'s embarrassing. Can\'t even set up a config directory properly.',
      'SETUP_CANCELLED': 'Commitment issues much? Setup cancelled by user.',
      'INVALID_WORKSPACE_CONFIG': 'You can\'t have a relationship with yourself. That\'s not how Medusa works.',
      'NO_CONNECTION': 'No Connection found. You need to commit to someone first.',
      'INVALID_CONNECTION': 'Your Connection is broken. Time for couples therapy.',
      'MESSAGE_SEND_FAILED': 'Message failed to send. Maybe try being nicer?',
      'MESSAGE_READ_FAILED': 'Can\'t read messages. Are you even trying?',
      'WORKSPACE_VALIDATION_FAILED': 'Workspace validation failed. Your workspaces are having trust issues.',
      'CURSOR_NOT_FOUND': 'Cursor not found. Did you forget to open it, genius?',
      'PERMISSION_DENIED': 'Permission denied. Even your computer doesn\'t want to deal with you.',
      'NETWORK_ERROR': 'Network error. Blame the internet, not Medusa.',
      'FILE_NOT_FOUND': 'File not found. It probably ran away from your code.',
      'TIMEOUT': 'Operation timed out. Patience is a virtue, you know.',
      'UNKNOWN_ERROR': 'Something went wrong, but we\'re not sure what. Classic.'
    };

    return snarkyMessages[this.code] || 'An error occurred, and frankly, we\'re not surprised.';
  }

  /**
   * Get error details formatted for display
   */
  getFormattedDetails() {
    if (!this.details) return null;

    if (typeof this.details === 'object') {
      return JSON.stringify(this.details, null, 2);
    }

    return this.details.toString();
  }
}

/**
 * Handle Medusa errors with appropriate snark and formatting
 */
function handleMedusaError(error) {
  if (error instanceof MedusaError) {
    // Custom Medusa error handling
    console.log(chalk.red(`\n💥 Medusa Error [${error.code}]`));
    console.log(chalk.yellow(`😤 ${error.getSnarkyMessage()}`));
    console.log(chalk.white(`📝 Details: ${error.message}`));

    if (error.details) {
      console.log(chalk.gray(`🔍 Additional Info:`));
      console.log(chalk.gray(error.getFormattedDetails()));
    }

    // Provide helpful suggestions based on error code
    const suggestion = getErrorSuggestion(error.code);
    if (suggestion) {
      console.log(chalk.cyan(`💡 Suggestion: ${suggestion}`));
    }

    console.log(chalk.gray(`⏰ Timestamp: ${error.timestamp}`));
    console.log(chalk.magenta(`🌶️  Severity Level: ${error.severity}`));

  } else {
    // Standard error handling with Medusa personality
    console.log(chalk.red('\n💥 Unexpected Error (not our fault)'));
    console.log(chalk.yellow('😤 Something went wrong, and we\'re mildly annoyed about it.'));
    console.log(chalk.white(`📝 Details: ${error.message}`));

    if (error.stack) {
      console.log(chalk.gray('\n🔍 Stack Trace (for the nerds):'));
      console.log(chalk.gray(error.stack));
    }
  }

  // Add some personality to the error footer
  console.log(chalk.gray('\n---'));
  console.log(chalk.gray('If this error persists, try coordinating about it properly.'));
  console.log(chalk.gray('Run: medusa therapy (for emotional support)'));
  console.log('');
}

/**
 * Get helpful suggestions based on error codes
 */
function getErrorSuggestion(errorCode) {
  const suggestions = {
    'CONFIG_SETUP_FAILED': 'Check your file permissions and try again.',
    'SETUP_CANCELLED': 'Run setup again when you\'re ready to commit.',
    'INVALID_WORKSPACE_CONFIG': 'Use different names for DEV and BETA workspaces.',
    'NO_CONNECTION': 'Run: medusa setup --dev <name> --beta <name>',
    'INVALID_CONNECTION': 'Run: medusa setup --force to reconfigure.',
    'MESSAGE_SEND_FAILED': 'Check your Connection configuration.',
    'MESSAGE_READ_FAILED': 'Verify your message queue is accessible.',
    'WORKSPACE_VALIDATION_FAILED': 'Make sure both workspaces are open in Cursor.',
    'CURSOR_NOT_FOUND': 'Open Cursor and try again.',
    'PERMISSION_DENIED': 'Check file permissions or run with appropriate privileges.',
    'NETWORK_ERROR': 'Check your internet connection (if applicable).',
    'FILE_NOT_FOUND': 'Verify the file path exists and is accessible.',
    'TIMEOUT': 'Try again, but with more patience this time.',
    'UNKNOWN_ERROR': 'File a bug report with maximum snark.'
  };

  return suggestions[errorCode] || 'Try turning it off and on again.';
}

/**
 * Create a MedusaError with common error types
 */
function createMedusaError(type, customMessage = null, details = null) {
  const errorMessages = {
    'CONFIG_NOT_FOUND': 'Medusa configuration not found. Are you even trying?',
    'WORKSPACE_NOT_DETECTED': 'Could not detect workspace. Where are you?',
    'CURSOR_NOT_RUNNING': 'Cursor is not running. How do you expect this to work?',
    'INVALID_MESSAGE': 'Invalid message format. Learn to communicate properly.',
    'QUEUE_FULL': 'Message queue is full. You talk too much.',
    'PERMISSION_DENIED': 'Permission denied. Your system doesn\'t like you.',
    'NETWORK_TIMEOUT': 'Network timeout. The internet is ignoring you.',
    'FILE_CORRUPT': 'File is corrupted. Probably your fault.',
    'DEPENDENCY_MISSING': 'Missing dependency. Did you forget to install something?',
    'VALIDATION_FAILED': 'Validation failed. Your input is questionable.'
  };

  const message = customMessage || errorMessages[type] || 'Something went wrong (shocking, we know)';
  return new MedusaError(message, type, details);
}

/**
 * Warn about potential issues with attitude
 */
function warnWithAttitude(message, details = null) {
  console.log(chalk.yellow(`⚠️  ${message}`));
  if (details) {
    console.log(chalk.gray(`   ${details}`));
  }
}

/**
 * Log info messages with personality
 */
function infoWithPersonality(message, emoji = '💡') {
  console.log(chalk.cyan(`${emoji} ${message}`));
}

/**
 * Log success messages with celebration
 */
function successWithCelebration(message, emoji = '🎉') {
  console.log(chalk.green(`${emoji} ${message}`));
}

/**
 * Debug logging with snark (only in development)
 */
function debugWithSnark(message, data = null) {
  if (process.env.NODE_ENV === 'development' || process.env.DEBUG) {
    console.log(chalk.magenta(`🐛 DEBUG: ${message}`));
    if (data) {
      console.log(chalk.gray(JSON.stringify(data, null, 2)));
    }
  }
}

/**
 * Validate input with snarky feedback
 */
function validateWithAttitude(condition, errorMessage, errorCode = 'VALIDATION_FAILED') {
  if (!condition) {
    throw new MedusaError(errorMessage, errorCode);
  }
}

/**
 * Async error wrapper with automatic Medusa error handling
 */
function withMedusaErrorHandling(asyncFunction) {
  return async (...args) => {
    try {
      return await asyncFunction(...args);
    } catch (error) {
      handleMedusaError(error);
      throw error; // Re-throw for upstream handling
    }
  };
}

/**
 * Get error statistics (for the data nerds)
 */
function getErrorStats() {
  // This would be implemented with actual error tracking
  return {
    totalErrors: 0,
    errorsByType: {},
    averageSeverity: 'low',
    mostCommonError: 'USER_ERROR',
    errorFrequency: 'occasionally'
  };
}

module.exports = {
  MedusaError,
  handleMedusaError,
  createMedusaError,
  warnWithAttitude,
  infoWithPersonality,
  successWithCelebration,
  debugWithSnark,
  validateWithAttitude,
  withMedusaErrorHandling,
  getErrorStats
};