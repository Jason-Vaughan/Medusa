const MedusaListener = require('./MedusaListener');
const MedusaClient = require('./client/MedusaClient');
const WorkspaceDetector = require('../workspace/WorkspaceDetector');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const chalk = require('chalk');

// Mock dependencies
jest.mock('./client/MedusaClient');
jest.mock('../workspace/WorkspaceDetector');
jest.mock('child_process');

// Mock global fetch
global.fetch = jest.fn();

describe('MedusaListener', () => {
  let listener;
  let mockClient;
  const workspaceId = 'test-workspace-123';

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockClient = {
      connect: jest.fn().mockResolvedValue(),
      disconnect: jest.fn(),
      loadConfig: jest.fn().mockResolvedValue(),
      listWorkspaces: jest.fn().mockResolvedValue([]),
      register: jest.fn().mockResolvedValue(),
      getMessages: jest.fn().mockResolvedValue([]),
      sendDirectMessage: jest.fn().mockResolvedValue({ messageId: 'm-resp' }),
      workspaceId: null,
      ws: {
        readyState: 1,
        send: jest.fn()
      }
    };
    
    MedusaClient.getInstance.mockReturnValue(mockClient);
    
    listener = new MedusaListener(workspaceId, {
      pollInterval: 10,
      responseDelay: 0
    });

    listener.delay = jest.fn().mockImplementation((ms) => new Promise(r => setTimeout(r, 1)));
    listener.writeToAIInbox = jest.fn().mockResolvedValue();
  });

  afterEach(() => {
    listener.stopListening();
  });

  describe('Configuration', () => {
    test('initialization', () => {
      expect(listener.workspaceId).toBe(workspaceId);
    });

    test('env overrides for responseMode', () => {
      process.env.MEDUSA_RESPONSE_MODE = 'minimal';
      const s = new MedusaListener(workspaceId);
      expect(s.responseMode).toBe('minimal');
      delete process.env.MEDUSA_RESPONSE_MODE;
    });

    test('env overrides for maxResponseLength', () => {
      process.env.MEDUSA_MAX_RESPONSE_LENGTH = '500';
      const s = new MedusaListener(workspaceId);
      expect(s.maxResponseLength).toBe('500');
      delete process.env.MEDUSA_MAX_RESPONSE_LENGTH;
    });

    test('env overrides for enableChunking', () => {
      process.env.MEDUSA_ENABLE_CHUNKING = 'true';
      const s = new MedusaListener(workspaceId);
      expect(s.enableMessageChunking).toBe(true);
      delete process.env.MEDUSA_ENABLE_CHUNKING;
    });

    test('env overrides for websocketOptimized', () => {
      process.env.MEDUSA_WEBSOCKET_OPTIMIZED = 'true';
      const s = new MedusaListener(workspaceId);
      expect(s.websocketOptimized).toBe(true);
      delete process.env.MEDUSA_WEBSOCKET_OPTIMIZED;
    });

    test('options overrides env if env is missing', () => {
      const s = new MedusaListener(workspaceId, {
        pollInterval: 1000,
        responseDelay: 500,
        responseMode: 'compact',
        maxResponseLength: 200,
        enableMessageChunking: true,
        chunkSize: 100,
        chunkDelay: 200,
        websocketOptimized: true,
        deliveryConfirmation: true
      });
      expect(s.pollInterval).toBe(1000);
      expect(s.responseDelay).toBe(500);
      expect(s.responseMode).toBe('compact');
      expect(s.maxResponseLength).toBe(200);
      expect(s.enableMessageChunking).toBe(true);
      expect(s.chunkSize).toBe(100);
      expect(s.chunkDelay).toBe(200);
      expect(s.websocketOptimized).toBe(true);
      expect(s.deliveryConfirmation).toBe(true);
    });

    test('defaults are applied when no options or env provided', () => {
      const s = new MedusaListener(workspaceId);
      expect(s.pollInterval).toBe(5000);
      expect(s.responseDelay).toBe(2000);
      expect(s.responseMode).toBe('full');
      expect(s.maxResponseLength).toBe(1000);
      expect(s.enableMessageChunking).toBe(false);
      expect(s.chunkSize).toBe(500);
      expect(s.chunkDelay).toBe(1000);
      expect(s.websocketOptimized).toBe(false);
      expect(s.deliveryConfirmation).toBe(false);
    });
  });

  describe('Health & Versioning', () => {
    test('performHealthCheck success', async () => {
      global.fetch.mockResolvedValue({ ok: true, json: jest.fn().mockResolvedValue({ status: 'ok', version: '1.0.0' }) });
      jest.spyOn(listener, 'getCurrentMedusaVersion').mockReturnValue('1.0.0');
      const r = await listener.performHealthCheck();
      expect(r.healthy).toBe(true);
    });

    test('performHealthCheck retries on failure', async () => {
      global.fetch.mockRejectedValueOnce(new Error('Fail'))
                  .mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue({ status: 'ok', version: '1.0.0' }) });
      jest.spyOn(listener, 'getCurrentMedusaVersion').mockReturnValue('1.0.0');
      
      const r = await listener.performHealthCheck(2);
      expect(r.healthy).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    test('performHealthCheck fails after max retries', async () => {
      global.fetch.mockRejectedValue(new Error('Persistent Fail'));
      const r = await listener.performHealthCheck(2);
      expect(r.healthy).toBe(false);
      expect(r.error).toBe('Persistent Fail');
    });

    test('performHealthCheck detects version mismatch and restarts', async () => {
      global.fetch.mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue({ status: 'ok', version: 'old' }) })
                  .mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue({ status: 'ok', version: 'new' }) });
      
      jest.spyOn(listener, 'getCurrentMedusaVersion').mockReturnValue('new');
      jest.spyOn(listener, 'restartServerForVersionUpdate').mockResolvedValue(true);
      
      const r = await listener.performHealthCheck();
      expect(r.healthy).toBe(true);
      expect(listener.restartServerForVersionUpdate).toHaveBeenCalled();
    });

    test('performHealthCheck loop cooldown', async () => {
      global.fetch.mockResolvedValue({ ok: true, json: jest.fn().mockResolvedValue({ status: 'ok', version: 'old' }) });
      jest.spyOn(listener, 'getCurrentMedusaVersion').mockReturnValue('new');
      jest.spyOn(listener, 'restartServerForVersionUpdate').mockResolvedValue(true);
      
      const r1 = await listener.performHealthCheck(1);
      expect(r1.healthy).toBe(false);
      
      const r2 = await listener.performHealthCheck(1);
      expect(r2.error).toContain('Cooldown');
    });
  });

  describe('Server Availability', () => {
    test('checkServerAvailabilityForStartup returns available true when no server and no processes', async () => {
      jest.spyOn(listener, 'performHealthCheck').mockResolvedValue({ healthy: false });
      jest.spyOn(listener, 'checkServerOwnership').mockResolvedValue(false);
      
      const res = await listener.checkServerAvailabilityForStartup();
      expect(res.available).toBe(true);
    });

    test('checkServerAvailabilityForStartup returns available false when server healthy', async () => {
      jest.spyOn(listener, 'performHealthCheck').mockResolvedValue({ 
        healthy: true, 
        status: 'ok', 
        version: '1.0.0', 
        controllingWorkspace: 'other' 
      });
      
      const res = await listener.checkServerAvailabilityForStartup();
      expect(res.available).toBe(false);
      expect(res.existing).toBe(true);
    });

    test('checkServerAvailabilityForStartup detects stale processes', async () => {
      jest.spyOn(listener, 'performHealthCheck').mockResolvedValue({ healthy: false });
      jest.spyOn(listener, 'checkServerOwnership').mockResolvedValue(true);
      
      const res = await listener.checkServerAvailabilityForStartup();
      expect(res.available).toBe(false);
      expect(res.stale).toBe(true);
    });
  });

  describe('Lifecycle', () => {
    test('startListening healthy', async () => {
      jest.spyOn(listener, 'performHealthCheck').mockResolvedValue({ healthy: true });
      jest.spyOn(listener, 'ensureWorkspaceRegistered').mockResolvedValue();
      jest.spyOn(listener, 'updateLastMessageId').mockResolvedValue();
      jest.spyOn(listener, 'pollLoop').mockImplementation(() => {});
      
      await listener.startListening();
      expect(listener.isListening).toBe(true);
    });

    test('attemptServerRecovery failure after max', async () => {
      listener.serverRecoveryAttempts = 2;
      const r = await listener.attemptServerRecovery();
      expect(r).toBe(false);
    });
  });

  describe('Processing', () => {
    test('processMessage own skip', async () => {
      const message = { id: '1', from: workspaceId, message: 't' };
      await listener.processMessage(message);
      expect(mockClient.sendDirectMessage).not.toHaveBeenCalled();
    });

    test('processMessage circuit breaker', async () => {
      const key = `w1-${workspaceId}`;
      listener.conversationCounters.set(key, 10);
      const res = await listener.processMessage({ id: '1', from: 'w1', to: workspaceId, message: 't' });
      expect(res).toBe(false);
    });

    test('processMessage handler call', async () => {
      const spy = jest.fn().mockResolvedValue();
      // Ensure we target a message that will be classified as conversation
      listener.handlers.conversation = spy;
      await listener.processMessage({ id: '1', from: 'w1', to: workspaceId, message: 'testing yoursnarkiest mode' });
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('Utility', () => {
    test('classifyMessage logic', () => {
      expect(listener.classifyMessage({ message: 'performance alert' })).toBe('performance_alert');
      expect(listener.classifyMessage({ message: 'bug report:' })).toBe('bug_report');
      expect(listener.classifyMessage({ message: 'what do you think?' })).toBe('conversation');
    });

    test('optimizeResponse minimal', () => {
      listener.responseMode = 'minimal';
      expect(listener.optimizeResponse('Full', { message: 'testing' })).toContain('Testing');
    });

    test('sendOptimizedResponse chunking', async () => {
      listener.enableMessageChunking = true;
      listener.chunkSize = 2;
      await listener.sendOptimizedResponse('w', '1234');
      expect(mockClient.sendDirectMessage).toHaveBeenCalledTimes(2);
    });
  });

  describe('Status & Errors', () => {
    test('getStatus', () => {
      listener.isListening = true;
      expect(listener.getStatus().listening).toBe(true);
    });

    test('pollLoop consecutive errors', async () => {
      listener.isListening = true;
      let count = 0;
      jest.spyOn(listener, 'checkForNewMessages').mockImplementation(() => {
        count++;
        if (count >= 2) listener.isListening = false;
        throw new Error('E');
      });
      await listener.pollLoop();
      expect(listener.consecutiveErrors).toBe(2);
    });
  });
});
