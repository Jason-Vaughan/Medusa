const MedusaMCPServer = require('./medusa-mcp-server');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

jest.mock('http');

describe('MedusaMCPServer', () => {
  let mcpServer;
  
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.A2A_SECRET = 'test-secret';
    
    // Silence console.error for tests
    jest.spyOn(console, 'error').mockImplementation(() => {});
    
    mcpServer = new MedusaMCPServer();
  });
  
  afterEach(() => {
    delete process.env.A2A_SECRET;
    jest.restoreAllMocks();
  });
  
  describe('Initialization', () => {
    test('loads tools successfully', () => {
      expect(mcpServer.tools.length).toBeGreaterThan(0);
      expect(mcpServer.tools.some(t => t.name === 'medusa_hook')).toBe(true);
    });
  });

  describe('Protocol Handling', () => {
    test('handleRequest routes methods correctly', async () => {
      const initResp = await mcpServer.handleRequest({ method: 'initialize', id: 1 });
      expect(initResp.result.serverInfo.name).toBe('🐍 Medusa Protocol - A2A Edition');
      
      const toolsResp = await mcpServer.handleRequest({ method: 'tools/list', id: 2 });
      expect(toolsResp.result.tools.length).toBeGreaterThan(0);
    });
  });

  describe('callA2A', () => {
    test('makes HTTP requests correctly and returns JSON', async () => {
      const mockRequest = {
        on: jest.fn(),
        write: jest.fn(),
        end: jest.fn()
      };
      
      http.request.mockImplementation((url, options, callback) => {
        const mockResponse = {
          statusCode: 200,
          on: jest.fn((event, cb) => {
            if (event === 'data') cb(JSON.stringify({ success: true }));
            if (event === 'end') cb();
          })
        };
        callback(mockResponse);
        return mockRequest;
      });
      
      const result = await mcpServer.callA2A('POST', '/test', { data: 'value' });
      
      expect(http.request).toHaveBeenCalled();
      const call = http.request.mock.calls[0];
      expect(call[1].method).toBe('POST');
      expect(call[1].headers['X-Medusa-Signature'] || call[1].headers['x-medusa-signature']).toBeDefined();
      expect(mockRequest.write).toHaveBeenCalledWith(JSON.stringify({ data: 'value' }));
      
      expect(result).toEqual({ success: true });
    });
    
    test('handles >= 400 status codes appropriately', async () => {
      const mockRequest = { on: jest.fn(), end: jest.fn() };
      
      http.request.mockImplementation((url, options, callback) => {
        const mockResponse = {
          statusCode: 404,
          on: jest.fn((event, cb) => {
            if (event === 'data') cb(JSON.stringify({ detail: 'Not found' }));
            if (event === 'end') cb();
          })
        };
        callback(mockResponse);
        return mockRequest;
      });
      
      const result = await mcpServer.callA2A('GET', '/test');
      expect(result.error).toBe('Not found');
      expect(result.status).toBe(404);
    });
  });

  describe('handleToolCall Tools', () => {
    test('medusa_hook success', async () => {
      jest.spyOn(mcpServer, 'callA2A').mockResolvedValue({ status: 'sent' });
      
      const resp = await mcpServer.handleToolCall({
        name: 'medusa_hook',
        arguments: { target_workspace: 'remote-ws', message: 'test msg' }
      });
      
      expect(mcpServer.callA2A).toHaveBeenCalledWith('POST', '/a2a/messages/send', expect.any(Object));
      expect(resp.content[0].text).toContain('successfully');
      expect(resp.isError).toBeUndefined();
    });

    test('medusa_hook failure', async () => {
      jest.spyOn(mcpServer, 'callA2A').mockResolvedValue({ error: 'failed' });
      
      const resp = await mcpServer.handleToolCall({
        name: 'medusa_hook',
        arguments: { target_workspace: 'remote-ws', message: 'test msg' }
      });
      
      expect(resp.isError).toBe(true);
      expect(resp.content[0].text).toContain('Failed to hook AI');
    });

    test('medusa_gaze', async () => {
      jest.spyOn(mcpServer, 'callA2A').mockResolvedValue([
        { sender_id: 'a', content: 'hello', received_at: 'now' }
      ]);
      
      const resp = await mcpServer.handleToolCall({ name: 'medusa_gaze', arguments: {} });
      expect(resp.content[0].text).toContain('Gaze locked');
      expect(resp.content[0].text).toContain('hello');
    });
    
    test('medusa_craft local background task', async () => {
      jest.spyOn(mcpServer, 'callA2A').mockResolvedValue({ task_id: 't-1', status: 'pending' });
      
      const resp = await mcpServer.handleToolCall({
        name: 'medusa_craft',
        arguments: { task_description: 'do work' }
      });
      
      expect(mcpServer.callA2A).toHaveBeenCalledWith('POST', '/a2a/tasks', {
        task_type: 'local',
        description: 'do work',
        context: {},
        priority: 2
      });
      expect(resp.content[0].text).toContain('MedusaCraft background task created!');
    });
  });
});
