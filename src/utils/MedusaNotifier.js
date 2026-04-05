/**
 * MedusaNotifier - Sends notifications with attitude
 *
 * Handles system notifications for urgent messages,
 * stones, and other important workspace drama.
 *
 * Because sometimes you need to get someone's attention aggressively.
 */

const notifier = require('node-notifier');
const path = require('path');
const chalk = require('chalk');
const { MedusaError } = require('./ErrorHandler');

class MedusaNotifier {
  constructor() {
    this.isEnabled = true;
    this.soundEnabled = true;
    this.iconPath = this.getNotificationIcon();
  }

  /**
   * Get the notification icon path
   */
  getNotificationIcon() {
    // In a real implementation, we'd bundle an icon file
    // For now, we'll use the system default
    return null;
  }

  /**
   * Send a priority notification
   */
  async sendPriorityNotification(targetWorkspace, message) {
    if (!this.isEnabled) {
      console.log(chalk.gray('📵 Notifications disabled'));
      return;
    }

    try {
      const notificationData = {
        title: `🚨 Urgent Medusa Message`,
        message: `From: ${targetWorkspace}\n${this.truncateMessage(message)}`,
        icon: this.iconPath,
        sound: this.soundEnabled ? 'Basso' : false,
        timeout: 10,
        actions: ['Reply', 'Ignore'],
        dropdownLabel: 'Medusa Actions',
        closeLabel: 'Dismiss',
        wait: false
      };

      await this.sendNotification(notificationData);
      console.log(chalk.green('🔔 Priority notification sent'));

    } catch (error) {
      console.log(chalk.yellow(`⚠️  Failed to send priority notification: ${error.message}`));
    }
  }

  /**
   * Send a stone notification (maximum urgency)
   */
  async sendStone(targetWorkspace, message) {
    if (!this.isEnabled) {
      console.log(chalk.gray('📵 Notifications disabled'));
      return;
    }

    try {
      const stoneMessages = [
        '👋 STONE INCOMING!',
        '💥 WAKE UP CALL!',
        '🚨 URGENT MEDUSA ALERT!',
        '⚡ PRIORITY INTERRUPT!',
        '🔥 EMERGENCY STATUS!'
      ];

      const randomStoneTitle = stoneMessages[Math.floor(Math.random() * stoneMessages.length)];

      const notificationData = {
        title: randomStoneTitle,
        message: `${targetWorkspace} needs your attention NOW!\n${this.truncateMessage(message)}`,
        icon: this.iconPath,
        sound: this.soundEnabled ? 'Funk' : false,
        timeout: 15,
        actions: ['Respond', 'Snooze'],
        dropdownLabel: 'Emergency Actions',
        closeLabel: 'I\'m awake!',
        wait: false,
        urgency: 'critical'
      };

      await this.sendNotification(notificationData);

      // Send multiple notifications for maximum annoyance
      setTimeout(() => {
        this.sendNotification({
          ...notificationData,
          title: '👋 Still waiting...',
          message: 'Your Medusa is getting impatient.',
          timeout: 5
        });
      }, 3000);

      console.log(chalk.red('👋 STONE notification delivered with maximum prejudice!'));

    } catch (error) {
      console.log(chalk.yellow(`⚠️  Failed to send stone: ${error.message}`));
    }
  }

  /**
   * Send a regular message notification
   */
  async sendMessageNotification(from, message, priority = false) {
    if (!this.isEnabled) {
      return;
    }

    try {
      const title = priority ? '🚨 Priority Medusa Message' : '📨 New Medusa Message';
      const sound = priority ? 'Basso' : 'Blow';

      const notificationData = {
        title,
        message: `From: ${from}\n${this.truncateMessage(message)}`,
        icon: this.iconPath,
        sound: this.soundEnabled ? sound : false,
        timeout: priority ? 10 : 5,
        actions: priority ? ['Reply', 'Mark Read'] : ['View'],
        wait: false
      };

      await this.sendNotification(notificationData);
      console.log(chalk.blue(`🔔 Message notification sent (${priority ? 'priority' : 'normal'})`));

    } catch (error) {
      console.log(chalk.gray(`⚠️  Failed to send message notification: ${error.message}`));
    }
  }

  /**
   * Send a workspace status notification
   */
  async sendWorkspaceStatusNotification(status, details) {
    if (!this.isEnabled) {
      return;
    }

    try {
      const statusEmojis = {
        'connected': '🟢',
        'disconnected': '🔴',
        'error': '💥',
        'warning': '⚠️',
        'info': '💡'
      };

      const notificationData = {
        title: `${statusEmojis[status] || '📊'} Medusa Workspace Status`,
        message: details,
        icon: this.iconPath,
        sound: this.soundEnabled && status === 'error' ? 'Basso' : false,
        timeout: 5,
        wait: false
      };

      await this.sendNotification(notificationData);

    } catch (error) {
      console.log(chalk.gray(`⚠️  Failed to send status notification: ${error.message}`));
    }
  }

  /**
   * Send a custom notification with Medusa personality
   */
  async sendCustomNotification(title, message, options = {}) {
    if (!this.isEnabled) {
      return;
    }

    try {
      const notifyTitles = {
        'success': '🎉 Medusa Success (Shocking!)',
        'error': '💥 Medusa Error (Typical)',
        'warning': '⚠️  Medusa Warning (Listen Up)',
        'info': '💡 Medusa Info (Pay Attention)',
        'reminder': '⏰ Medusa Reminder (Don\'t Forget)'
      };

      const finalTitle = notifyTitles[options.type] || title;

      const notificationData = {
        title: finalTitle,
        message: this.addPersonality(message),
        icon: this.iconPath,
        sound: this.soundEnabled ? (options.sound || 'Blow') : false,
        timeout: options.timeout || 5,
        actions: options.actions || ['OK'],
        wait: false,
        ...options
      };

      await this.sendNotification(notificationData);

    } catch (error) {
      console.log(chalk.gray(`⚠️  Failed to send custom notification: ${error.message}`));
    }
  }

  /**
   * Send the actual notification using node-notifier
   */
  async sendNotification(notificationData) {
    return new Promise((resolve, reject) => {
      notifier.notify(notificationData, (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  /**
   * Truncate message for notification display
   */
  truncateMessage(message, maxLength = 100) {
    if (message.length <= maxLength) {
      return message;
    }
    return message.substring(0, maxLength - 3) + '...';
  }

  /**
   * Add Medusa personality to notification messages
   */
  addPersonality(message) {
    const personalityPhrases = [
      'Just so you know',
      'FYI',
      'In case you care',
      'Thought you should know',
      'Breaking news',
      'Update from your Medusa'
    ];

    const randomPhrase = personalityPhrases[Math.floor(Math.random() * personalityPhrases.length)];
    return `${randomPhrase}: ${message}`;
  }

  /**
   * Enable/disable notifications
   */
  setEnabled(enabled) {
    this.isEnabled = enabled;
    console.log(chalk.cyan(`🔔 Notifications ${enabled ? 'enabled' : 'disabled'}`));
  }

  /**
   * Enable/disable notification sounds
   */
  setSoundEnabled(enabled) {
    this.soundEnabled = enabled;
    console.log(chalk.cyan(`🔊 Notification sounds ${enabled ? 'enabled' : 'disabled'}`));
  }

  /**
   * Test notifications
   */
  async testNotifications() {
    try {
      console.log(chalk.cyan('🧪 Testing Medusa notifications...'));

      // Test basic notification
      await this.sendCustomNotification('Medusa Test', 'If you can see this, notifications are working!', {
        type: 'info',
        timeout: 3
      });

      // Test priority notification
      setTimeout(async () => {
        await this.sendPriorityNotification('Test Workspace', 'This is a test priority message');
      }, 2000);

      // Test stone (if user confirms)
      setTimeout(async () => {
        console.log(chalk.yellow('⚠️  Testing stone notification in 3 seconds...'));
        setTimeout(async () => {
          await this.sendStone('Test Workspace', 'This is a test stone (don\'t worry, it\'s just a test)');
        }, 3000);
      }, 4000);

      console.log(chalk.green('✅ Notification test sequence initiated'));

    } catch (error) {
      throw new MedusaError(`Notification test failed: ${error.message}`, 'NOTIFICATION_TEST_FAILED');
    }
  }

  /**
   * Get notification statistics
   */
  getNotificationStats() {
    // This would be implemented with actual tracking
    return {
      enabled: this.isEnabled,
      soundEnabled: this.soundEnabled,
      totalSent: 0,
      prioritySent: 0,
      stonesSent: 0,
      lastSent: null,
      platform: process.platform
    };
  }

  /**
   * Schedule a delayed notification
   */
  async scheduleNotification(title, message, delayMs, options = {}) {
    setTimeout(async () => {
      try {
        await this.sendCustomNotification(title, message, {
          ...options,
          type: 'reminder'
        });
      } catch (error) {
        console.log(chalk.gray(`⚠️  Scheduled notification failed: ${error.message}`));
      }
    }, delayMs);

    console.log(chalk.blue(`⏰ Notification scheduled for ${Math.round(delayMs / 1000)} seconds`));
  }

  /**
   * Send a notification when Medusa starts up
   */
  async sendStartupNotification() {
    if (!this.isEnabled) {
      return;
    }

    const startupMessages = [
      'Medusa is ready to cause some drama!',
      'Your workspace communication assistant is online.',
      'Ready to facilitate some professional coordinating.',
      'Medusa initialized. Let the workspace drama begin!',
      'Communication bridge established. Start complaining!'
    ];

    const randomMessage = startupMessages[Math.floor(Math.random() * startupMessages.length)];

    await this.sendCustomNotification('Medusa Online', randomMessage, {
      type: 'success',
      timeout: 3
    });
  }
}

module.exports = MedusaNotifier;