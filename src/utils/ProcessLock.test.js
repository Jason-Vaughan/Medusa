const fs = require('fs').promises;
const os = require('os');
const ProcessLock = require('./ProcessLock');
const path = require('path');

// Mock fs.promises
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn().mockResolvedValue(),
    writeFile: jest.fn().mockResolvedValue(),
    readFile: jest.fn(),
    unlink: jest.fn().mockResolvedValue(),
    readdir: jest.fn().mockResolvedValue([])
  }
}));

// Mock os
jest.mock('os', () => ({
  tmpdir: jest.fn().mockReturnValue('/tmp'),
  hostname: jest.fn().mockReturnValue('mock-host')
}));

describe('ProcessLock', () => {
  let lock;
  const lockName = 'test-service';
  const mockPid = 12345;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    // Mock process.pid and process.kill
    Object.defineProperty(process, 'pid', { value: mockPid, writable: true });
    process.kill = jest.fn();
    
    lock = new ProcessLock(lockName);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Acquisition', () => {
    test('should successfully acquire a lock if none exists', async () => {
      fs.readFile.mockRejectedValue({ code: 'ENOENT' });
      
      const success = await lock.acquire();
      
      expect(success).toBe(true);
      expect(fs.mkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true });
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining(`${lockName}.lock`),
        expect.stringContaining(`"pid": ${mockPid}`)
      );
    });

    test('should fail to acquire if an active lock exists', async () => {
      const activeLockData = {
        pid: 99999,
        lastHeartbeat: Date.now(),
        hostname: 'other-host'
      };
      fs.readFile.mockResolvedValue(JSON.stringify(activeLockData));
      process.kill.mockReturnValue(true); // PID 99999 is running
      
      await expect(lock.acquire()).rejects.toThrow('Another instance of test-service is already running');
    });

    test('should acquire lock if existing lock is stale', async () => {
      const staleLockData = {
        pid: 99999,
        lastHeartbeat: Date.now() - 60000 // 60s old (maxAge is 30s)
      };
      fs.readFile.mockResolvedValue(JSON.stringify(staleLockData));
      
      const success = await lock.acquire();
      expect(success).toBe(true);
      expect(fs.unlink).toHaveBeenCalled(); // Cleaned up stale lock
    });
  });

  describe('Heartbeat', () => {
    test('should update lastHeartbeat periodically', async () => {
      fs.readFile.mockRejectedValue({ code: 'ENOENT' });
      await lock.acquire();
      
      const firstWriteCall = fs.writeFile.mock.calls.length;
      
      // Fast-forward 5 seconds (default checkInterval)
      jest.advanceTimersByTime(5000);
      
      expect(fs.writeFile).toHaveBeenCalledTimes(firstWriteCall + 1);
      const lastCallData = JSON.parse(fs.writeFile.mock.calls[firstWriteCall][1]);
      expect(lastCallData.lastHeartbeat).toBeGreaterThan(0);
    });
  });

  describe('Release', () => {
    test('should stop heartbeat and unlink file', async () => {
      fs.readFile.mockRejectedValue({ code: 'ENOENT' });
      await lock.acquire();
      
      await lock.release();
      
      expect(fs.unlink).toHaveBeenCalledWith(expect.stringContaining(`${lockName}.lock`));
      expect(lock.isLocked).toBe(false);
      
      // Verify heartbeat stopped
      jest.advanceTimersByTime(5000);
      expect(fs.writeFile).toHaveBeenCalledTimes(1); // Only the initial write
    });
  });

  describe('Static Methods', () => {
    test('getAllLocks should list and parse lock files', async () => {
      fs.readdir.mockResolvedValue(['s1.lock', 's2.lock']);
      fs.readFile.mockResolvedValue(JSON.stringify({ pid: 1, startTime: Date.now(), lastHeartbeat: Date.now() }));
      process.kill.mockReturnValue(true);

      const locks = await ProcessLock.getAllLocks();
      expect(locks).toHaveLength(2);
      expect(locks[0].name).toBe('s1');
    });

    test('cleanupStaleLocks should remove stale or orphaned locks', async () => {
      const locks = [
        { name: 'stale', pid: 1, isStale: true, isRunning: true },
        { name: 'orphaned', pid: 2, isStale: false, isRunning: false },
        { name: 'active', pid: 3, isStale: false, isRunning: true }
      ];
      // Mock getAllLocks via prototype prototype? No, mock the static call.
      jest.spyOn(ProcessLock, 'getAllLocks').mockResolvedValue(locks);
      
      const cleaned = await ProcessLock.cleanupStaleLocks();
      
      expect(cleaned).toBe(2);
      expect(fs.unlink).toHaveBeenCalledTimes(2);
      expect(fs.unlink).toHaveBeenCalledWith(expect.stringContaining('stale.lock'));
      expect(fs.unlink).toHaveBeenCalledWith(expect.stringContaining('orphaned.lock'));
    });
  });
});
