const AIAgentHook = require('./AIAgentHook');
const EventEmitter = require('events');

describe('AIAgentHook', () => {
  let aiHook;
  let mockLiveChat;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    
    // Create mock liveChat
    mockLiveChat = new EventEmitter();
    mockLiveChat.workspace = 'TestWorkspace';
    mockLiveChat.sessionId = '123';
    mockLiveChat.messageCount = 5;
    mockLiveChat.lastActivity = Date.now();
    mockLiveChat.onAITrigger = jest.fn();
    mockLiveChat.sendAsAgent = jest.fn().mockResolvedValue({ success: true });
    mockLiveChat.getConversationContext = jest.fn().mockReturnValue([]);

    aiHook = new AIAgentHook(mockLiveChat, { enabled: true, autoRespond: true });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Trigger Detection', () => {
    test('should trigger AI on matching phrase', async () => {
      const spy = jest.spyOn(aiHook, 'generateAutoResponse').mockResolvedValue();
      
      mockLiveChat.emit('message_received', { text: 'Hey AI, help me' });
      
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    test('should not trigger if disabled', async () => {
      aiHook.setEnabled(false);
      const spy = jest.spyOn(aiHook, 'generateAutoResponse');
      
      mockLiveChat.emit('message_received', { text: 'Hey AI, help me' });
      
      expect(spy).not.toHaveBeenCalled();
    });

    test('should not trigger if no match', async () => {
      const spy = jest.spyOn(aiHook, 'generateAutoResponse');
      mockLiveChat.emit('message_received', { text: 'Just a normal message' });
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('Response Generation', () => {
    test('generateResponse returns specific content for keywords', async () => {
      expect(await aiHook.generateResponse({ text: 'status' })).toContain('status: Active');
      expect(await aiHook.generateResponse({ text: 'help' })).toContain('help with workspace coordination');
    });

    test('generateAutoResponse sends message through liveChat after delay', async () => {
      const message = { text: 'status' };
      const responsePromise = aiHook.generateAutoResponse(message);
      
      // Fast-forward delay
      jest.advanceTimersByTime(1000);
      
      await responsePromise;
      
      expect(mockLiveChat.sendAsAgent).toHaveBeenCalledWith(
        expect.stringContaining('status: Active'),
        expect.objectContaining({ type: 'auto_response' })
      );
    });

    test('generateAutoResponse handles errors', async () => {
      mockLiveChat.sendAsAgent.mockRejectedValueOnce(new Error('Send Failed'));
      const spy = jest.spyOn(console, 'log').mockImplementation();
      
      const promise = aiHook.generateAutoResponse({ text: 'status' });
      jest.runAllTimers();
      await promise;
      
      expect(mockLiveChat.sendAsAgent).toHaveBeenCalledTimes(2); // First failed, second is error template
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('AI response failed'));
      spy.mockRestore();
    });
  });

  describe('AI Triggers', () => {
    test('handleAITrigger request_status sends status', async () => {
      await aiHook.handleAITrigger({ type: 'request_status' });
      expect(mockLiveChat.sendAsAgent).toHaveBeenCalledWith(expect.stringContaining('AI Agent Status'));
    });

    test('handleAITrigger coordinate_task sends coordination details', async () => {
      const payload = { task: 'Code Review', targetWorkspace: 'Beta', priority: 'high' };
      await aiHook.handleAITrigger({ type: 'coordinate_task', payload });
      expect(mockLiveChat.sendAsAgent).toHaveBeenCalledWith(expect.stringContaining('Code Review'));
    });
  });

  describe('Context and Commands', () => {
    test('getContext returns data from liveChat', () => {
      const context = aiHook.getContext();
      expect(context.workspace).toBe('TestWorkspace');
      expect(context.messageCount).toBe(5);
    });

    test('addTriggerPhrase adds to the list', () => {
      aiHook.addTriggerPhrase('newTrigger');
      expect(aiHook.triggerPhrases).toContain('newtrigger');
    });

    test('getCommandInterface provides access to methods', async () => {
      const api = aiHook.getCommandInterface();
      await api.respond('Hello from API');
      expect(mockLiveChat.sendAsAgent).toHaveBeenCalledWith('Hello from API', expect.any(Object));
    });
  });
});
