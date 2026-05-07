const MedusaMCPServer = require('./mcp-server');
const MedusaClient = require('./client/MedusaClient');
const ProcessLock = require('../utils/ProcessLock');
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const http = require('http');
const fs = require('fs').promises;
const { EventEmitter } = require('events');

// Mock dependencies
jest.mock('./client/MedusaClient');
jest.mock('../utils/ProcessLock');
jest.mock('@anthropic-ai/sdk');
jest.mock('openai');
jest.mock('http');

describe('MedusaMCPServer', () => {
  let mcpServer;
  let mockMedusaClient;
  let mockStdin;
  let mockStdout;

  const setupHttpMock = () => {
    const mockServer = { 
      listen: jest.fn((port, cb) => {
        if (cb) setTimeout(cb, 0);
        return mockServer;
      }),
      close: jest.fn((cb) => {
        if (cb) setTimeout(cb, 0);
        return mockServer;
      })
    };
    http.createServer.mockReturnValue(mockServer);
    return mockServer;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockMedusaClient = {
      connect: jest.fn().mockResolvedValue(),
      disconnect: jest.fn(),
      loadConfig: jest.fn().mockResolvedValue(),
      listWorkspaces: jest.fn().mockResolvedValue([]),
      register: jest.fn().mockResolvedValue(),
      getMessages: jest.fn().mockResolvedValue([]),
      sendMessage: jest.fn().mockResolvedValue({ messageId: 'm1' }),
      broadcast: jest.fn().mockResolvedValue({ messageId: 'b1', recipients: [] }),
      shareContext: jest.fn().mockResolvedValue({ success: true }),
      workspaceId: 'test-ws',
      on: jest.fn()
    };
    
    MedusaClient.getInstance.mockReturnValue(mockMedusaClient);

    mockStdin = new EventEmitter();
    mockStdout = { write: jest.fn() };
    
    mcpServer = new MedusaMCPServer({
      stdin: mockStdin,
      stdout: mockStdout
    });
  });

  afterEach(async () => {
    setupHttpMock();
    await mcpServer.stop();
  });

  describe('AI Providers', () => {
    test('default provider', () => {
      expect(mcpServer.activeProvider).toBe('cursor');
    });

    test('fallback routing', async () => {
      mcpServer.aiClients = {
        openai: { enabled: true, chat: { completions: { create: jest.fn().mockRejectedValue(new Error('fail')) } } },
        cursor: { enabled: true }
      };
      mcpServer.activeProvider = 'openai';
      jest.spyOn(mcpServer, 'generateCursorAIResponse').mockResolvedValue('cursor-reply');
      
      const resp = await mcpServer.generateAIResponse({ message: 'hi', from: 'w1' });
      expect(resp).toBe('cursor-reply');
    });
  });

  describe('MCP Protocol', () => {
    test('handleInitialize', async () => {
      const resp = await mcpServer.handleInitialize({});
      expect(resp.serverInfo.name).toBe('Medusa Protocol');
    });

    test('handleMCPRequest routes correctly', async () => {
      const req = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} };
      const resp = await mcpServer.handleMCPRequest(req);
      expect(resp.result.serverInfo.name).toBe('Medusa Protocol');
    });
  });

  describe('Tools', () => {
    test('sendMessage', async () => {
      const res = await mcpServer.sendMessage({ target_workspace: 'w1', message: 'h' });
      expect(mockMedusaClient.sendMessage).toHaveBeenCalled();
      expect(res.success).toBe(true);
    });

    test('handleGetContext', async () => {
      mockMedusaClient.listWorkspaces.mockResolvedValue([{ id: '1', lastSeen: new Date().toISOString() }]);
      const res = await mcpServer.handleGetContext();
      expect(res.content[0].text).toContain('Active workspaces: 1');
    });
  });

  describe('Autonomous Logic', () => {
    test('handleIncomingMessage triggers reply', async () => {
      const spy = jest.spyOn(mcpServer, 'generateAutonomousReply').mockResolvedValue();
      await mcpServer.handleIncomingMessage({ from: 'w1', message: 'hello' });
      expect(spy).toHaveBeenCalled();
    });

    test('collaboration exchange limit', async () => {
      const sid = 's1';
      mcpServer.collaborationSessions.set(sid, { target: 'w1', exchanges: 1, max_exchanges: 1, active: true, task: 't' });
      jest.spyOn(mcpServer, 'generateCollaborativeResponse').mockResolvedValue('reply');
      
      await mcpServer.handleCollaborationMessage({ from: 'w1', message: 'ok' }, sid);
      expect(mcpServer.collaborationSessions.get(sid).active).toBe(false);
    });
  });

  describe('History & Templates', () => {
    test('updateConversationHistory limits history', () => {
      mcpServer.maxConversationHistory = 2;
      mcpServer.updateConversationHistory('w1', 'u1', 'a1');
      mcpServer.updateConversationHistory('w1', 'u2', 'a2');
      expect(mcpServer.conversationHistory.get('w1')).toHaveLength(2);
      expect(mcpServer.conversationHistory.get('w1')[1].content).toBe('a2');
    });

    test('generateFallbackResponse', () => {
      expect(mcpServer.generateFallbackResponse({ message: 'error' })).toContain('Bug reports');
    });
  });

  describe('Transports', () => {
    test('handleSSE setup', () => {
      let closeHandler;
      const mockRes = { writeHead: jest.fn(), write: jest.fn(), on: jest.fn(), writableEnded: false };
      const mockReq = { on: jest.fn((e, cb) => { if (e === 'close') closeHandler = cb; }) };
      mcpServer.handleSSE(mockReq, mockRes);
      expect(mockRes.write).toHaveBeenCalledWith(expect.stringContaining('ping'));
      if (closeHandler) closeHandler();
    });

    test('startStdioTransport attaches listeners', () => {
      mcpServer.startStdioTransport();
      expect(mockStdin.listenerCount('data')).toBe(1);
    });

    test('startHttpTransport busy handling', async () => {
      const mockServer = { listen: jest.fn(() => { throw new Error('E'); }), close: jest.fn(cb => cb && cb()) };
      http.createServer.mockReturnValue(mockServer);
      mcpServer.server = null;
      await expect(mcpServer.startHttpTransport()).rejects.toThrow();
    });
  });
});
