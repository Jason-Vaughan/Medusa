const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const crypto = require('crypto');
const PrawductManager = require('./PrawductManager');
const { execSync } = require('child_process');

// Mock dependencies
jest.mock('fs');
jest.mock('child_process');
jest.mock('js-yaml');
jest.mock('./ProcessLock', () => ({
  cleanupStaleLocks: jest.fn().mockResolvedValue(2)
}));

// Mock global fetch
global.fetch = jest.fn();

describe('PrawductManager', () => {
  let pm;
  const mockRoot = path.join(__dirname, '..', '..');
  const mockStateFile = path.join(mockRoot, '.prawduct', 'project-state.yaml');

  beforeEach(() => {
    jest.clearAllMocks();
    pm = new PrawductManager();
  });

  describe('signA2ARequest', () => {
    test('should generate valid HMAC signature', () => {
      const secret = 'test-secret';
      const path = '/test';
      const result = pm.signA2ARequest(path, secret);
      
      expect(result['X-Medusa-Timestamp']).toBeDefined();
      expect(result['X-Medusa-Signature']).toHaveLength(64);
      
      // Verify signature manually
      const expectedPayload = `${result['X-Medusa-Timestamp']}${path}`;
      const expectedSignature = crypto.createHmac('sha256', secret)
        .update(expectedPayload)
        .digest('hex');
      expect(result['X-Medusa-Signature']).toBe(expectedSignature);
    });
  });

  describe('runProductHook', () => {
    test('should execute shell script if exists', async () => {
      fs.existsSync.mockReturnValue(true);
      const result = await pm.runProductHook('start');
      
      expect(result).toBe(true);
      expect(execSync).toHaveBeenCalledWith(expect.stringContaining('start.sh'), expect.any(Object));
    });

    test('should return null if hook does not exist', async () => {
      fs.existsSync.mockReturnValue(false);
      const result = await pm.runProductHook('non-existent');
      expect(result).toBeNull();
    });

    test('should return false if hook fails', async () => {
      fs.existsSync.mockReturnValue(true);
      execSync.mockImplementation(() => { throw new Error('Fail'); });
      const result = await pm.runProductHook('fail');
      expect(result).toBe(false);
    });
  });

  describe('State Management', () => {
    test('getProjectState reads and loads YAML', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('last_completed_chunk: 1');
      yaml.load.mockReturnValue({ last_completed_chunk: 1 });
      
      const state = await pm.getProjectState();
      expect(state.last_completed_chunk).toBe(1);
      expect(fs.readFileSync).toHaveBeenCalledWith(mockStateFile, 'utf8');
    });

    test('startSession updates state and runs hook', async () => {
      const mockState = { last_chunk_status: 'Ready' };
      jest.spyOn(pm, 'getProjectState').mockResolvedValue(mockState);
      jest.spyOn(pm, 'runProductHook').mockResolvedValue(true);
      yaml.dump.mockReturnValue('dumped-yaml');
      
      await pm.startSession();
      
      expect(pm.runProductHook).toHaveBeenCalledWith('start');
      expect(mockState.last_chunk_status).toBe('In Progress');
      expect(fs.writeFileSync).toHaveBeenCalledWith(mockStateFile, 'dumped-yaml');
    });
  });

  describe('Learnings', () => {
    test('addLearning calls A2A Node', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: '123', title: 'Test' })
      });
      
      const result = await pm.addLearning('Test', 'Content');
      expect(result.id).toBe('123');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(':3200/a2a/learnings/'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    test('addLearning falls back to local file if A2A fails', async () => {
      global.fetch.mockRejectedValue(new Error('Down'));
      fs.existsSync.mockReturnValue(false); // mkdirSync called
      
      const result = await pm.addLearning('Local', 'Content');
      expect(result.title).toBe('Local');
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('learnings'),
        expect.stringContaining('Local')
      );
    });
  });

  describe('Janitor', () => {
    test('performJanitorCleanup cleans locks and nukes files', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.lstatSync.mockReturnValue({ isDirectory: () => false });
      jest.spyOn(pm, 'runProductHook').mockResolvedValue(true);
      
      const cleaned = await pm.performJanitorCleanup({ nuclear: true });
      
      expect(cleaned).toBeGreaterThanOrEqual(3); // 2 locks + at least one file
      expect(fs.unlinkSync).toHaveBeenCalled();
    });
  });

  describe('Session Wrap', () => {
    test('performSessionWrap creates artifact and increments chunk', async () => {
      const mockState = { 
        last_completed_chunk: 5,
        work_in_progress: { chunk: 6, status: 'Building' }
      };
      jest.spyOn(pm, 'getProjectState').mockResolvedValue(mockState);
      yaml.dump.mockReturnValue('new-state');
      
      const filePath = await pm.performSessionWrap({ title: 'Finish X' });
      
      expect(filePath).toContain('SESSION_WRAP_CHUNK_6');
      expect(fs.writeFileSync).toHaveBeenCalledWith(filePath, expect.stringContaining('Finish X'));
      expect(mockState.last_completed_chunk).toBe(6);
      expect(fs.writeFileSync).toHaveBeenCalledWith(mockStateFile, 'new-state');
    });
  });

  describe('Backlog', () => {
    test('getBacklogItems parses markdown table', async () => {
      const markdown = `
## ✅ Completed Items
| Done | X |
## 📥 Pending Items
| Item | Origin | Priority | Status | Description |
|------|--------|----------|--------|-------------|
| Fix Bug | User | High | 📥 Pending | Do it |
| Task 2 | Dev | Low | 📥 Pending | Later |
`;
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(markdown);
      
      const items = await pm.getBacklogItems();
      expect(items).toHaveLength(2);
      expect(items[0].item).toBe('Fix Bug');
      expect(items[1].description).toBe('Later');
    });
  });
});
