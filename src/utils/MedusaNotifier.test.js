const notifier = require('node-notifier');
const MedusaNotifier = require('./MedusaNotifier');
const chalk = require('chalk');

// Mock node-notifier
jest.mock('node-notifier', () => ({
  notify: jest.fn((data, callback) => callback(null, 'ok'))
}));

describe('MedusaNotifier', () => {
  let medusaNotifier;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    medusaNotifier = new MedusaNotifier();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('should initialize with default values', () => {
    expect(medusaNotifier.isEnabled).toBe(true);
    expect(medusaNotifier.soundEnabled).toBe(true);
    expect(medusaNotifier.iconPath).toBeNull();
  });

  test('sendPriorityNotification sends correctly formatted notification', async () => {
    await medusaNotifier.sendPriorityNotification('DevSpace', 'Fix it!');
    
    expect(notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '🚨 Urgent Medusa Message',
        message: expect.stringContaining('From: DevSpace\nFix it!'),
        sound: 'Basso'
      }),
      expect.any(Function)
    );
  });

  test('sendStone sends critical notification and schedules a follow-up', async () => {
    await medusaNotifier.sendStone('BetaSpace', 'Wake up!');
    
    expect(notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        urgency: 'critical',
        message: expect.stringContaining('BetaSpace needs your attention NOW!')
      }),
      expect.any(Function)
    );

    // Fast-forward 3 seconds for the follow-up
    jest.advanceTimersByTime(3000);
    
    expect(notifier.notify).toHaveBeenCalledTimes(2);
    expect(notifier.notify).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: '👋 Still waiting...',
        message: 'Your Medusa is getting impatient.'
      }),
      expect.any(Function)
    );
  });

  test('sendMessageNotification handles priority and normal levels', async () => {
    // Normal
    await medusaNotifier.sendMessageNotification('UserX', 'Hello');
    expect(notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: '📨 New Medusa Message', sound: 'Blow' }),
      expect.any(Function)
    );

    // Priority
    await medusaNotifier.sendMessageNotification('UserY', 'Urgent', true);
    expect(notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: '🚨 Priority Medusa Message', sound: 'Basso' }),
      expect.any(Function)
    );
  });

  test('sendWorkspaceStatusNotification maps emojis correctly', async () => {
    await medusaNotifier.sendWorkspaceStatusNotification('error', 'Something failed');
    expect(notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '💥 Medusa Workspace Status',
        sound: 'Basso'
      }),
      expect.any(Function)
    );

    await medusaNotifier.sendWorkspaceStatusNotification('connected', 'All good');
    expect(notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '🟢 Medusa Workspace Status',
        sound: false
      }),
      expect.any(Function)
    );
  });

  test('sendCustomNotification adds personality', async () => {
    // Pass null title to use type-based title
    await medusaNotifier.sendCustomNotification(null, 'Message', { type: 'reminder' });
    
    expect(notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '⏰ Medusa Reminder (Don\'t Forget)',
        message: expect.stringMatching(/.*: Message/)
      }),
      expect.any(Function)
    );
  });

  test('sendCustomNotification uses provided title over type', async () => {
    await medusaNotifier.sendCustomNotification('Custom Title', 'Message', { type: 'success' });
    
    expect(notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Custom Title'
      }),
      expect.any(Function)
    );
  });

  test('truncateMessage works correctly', () => {
    const longMsg = 'A'.repeat(150);
    const truncated = medusaNotifier.truncateMessage(longMsg, 100);
    expect(truncated).toHaveLength(100);
    expect(truncated.endsWith('...')).toBe(true);
    
    const shortMsg = 'Short';
    expect(medusaNotifier.truncateMessage(shortMsg)).toBe('Short');
  });

  test('setEnabled and setSoundEnabled toggle flags', () => {
    medusaNotifier.setEnabled(false);
    expect(medusaNotifier.isEnabled).toBe(false);
    
    medusaNotifier.setSoundEnabled(false);
    expect(medusaNotifier.soundEnabled).toBe(false);
  });

  test('should not notify when disabled', async () => {
    medusaNotifier.setEnabled(false);
    await medusaNotifier.sendPriorityNotification('X', 'Y');
    expect(notifier.notify).not.toHaveBeenCalled();
  });

  test('scheduleNotification executes after delay', async () => {
    await medusaNotifier.scheduleNotification('Later', 'Soon', 5000);
    
    expect(notifier.notify).not.toHaveBeenCalled();
    
    jest.advanceTimersByTime(5000);
    
    expect(notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Soon') }),
      expect.any(Function)
    );
  });

  test('sendStartupNotification sends success message', async () => {
    await medusaNotifier.sendStartupNotification();
    expect(notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Medusa Online',
        sound: 'Blow'
      }),
      expect.any(Function)
    );
  });

  test('handle notifier error gracefully', async () => {
    // Clear any background tasks from previous tests
    jest.clearAllTimers();
    
    notifier.notify.mockImplementationOnce((data, callback) => {
      callback(new Error('Native Error'));
    });
    
    await expect(medusaNotifier.sendNotification({})).rejects.toThrow('Native Error');
  });
});
