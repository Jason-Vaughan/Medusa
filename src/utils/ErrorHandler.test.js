const { 
  MedusaError, 
  handleMedusaError, 
  createMedusaError, 
  validateWithAttitude, 
  withMedusaErrorHandling 
} = require('./ErrorHandler');
const chalk = require('chalk');

describe('ErrorHandler', () => {
  describe('MedusaError', () => {
    test('should initialize with code and details', () => {
      const error = new MedusaError('Test message', 'TEST_CODE', { foo: 'bar' });
      expect(error.message).toBe('Test message');
      expect(error.code).toBe('TEST_CODE');
      expect(error.details).toEqual({ foo: 'bar' });
      expect(error.timestamp).toBeDefined();
    });

    test('should calculate severity based on keywords', () => {
      expect(new MedusaError('Normal').severity).toBe('low');
      expect(new MedusaError('Operation failed').severity).toBe('medium');
      expect(new MedusaError('Operation failed and is broken').severity).toBe('high');
      expect(new MedusaError('Operation failed, is broken and timeout').severity).toBe('maximum');
    });

    test('should get snarky message for known codes', () => {
      const error = new MedusaError('m', 'CONFIG_SETUP_FAILED');
      expect(error.getSnarkyMessage()).toContain('Can\'t even set up a config directory');
    });

    test('should get default snarky message for unknown codes', () => {
      const error = new MedusaError('m', 'WEIRD_CODE');
      expect(error.getSnarkyMessage()).toBe('An error occurred, and frankly, we\'re not surprised.');
    });

    test('should format details correctly', () => {
      const error = new MedusaError('m', 'c', { a: 1 });
      expect(error.getFormattedDetails()).toBe(JSON.stringify({ a: 1 }, null, 2));
      
      const errorStr = new MedusaError('m', 'c', 'simple string');
      expect(errorStr.getFormattedDetails()).toBe('simple string');
    });
  });

  describe('handleMedusaError', () => {
    test('should log MedusaError details', () => {
      const spy = jest.spyOn(console, 'log').mockImplementation();
      const error = new MedusaError('Specific error', 'TIMEOUT');
      
      handleMedusaError(error);
      
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('Medusa Error [TIMEOUT]'));
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('Patience is a virtue'));
      spy.mockRestore();
    });

    test('should log standard Error details', () => {
      const spy = jest.spyOn(console, 'log').mockImplementation();
      const error = new Error('Generic failure');
      
      handleMedusaError(error);
      
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('Unexpected Error'));
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('Generic failure'));
      spy.mockRestore();
    });
  });

  describe('Utility Functions', () => {
    test('createMedusaError uses default messages', () => {
      const error = createMedusaError('QUEUE_FULL');
      expect(error.message).toBe('Message queue is full. You talk too much.');
    });

    test('validateWithAttitude throws on false condition', () => {
      expect(() => validateWithAttitude(true, 'fail')).not.toThrow();
      expect(() => validateWithAttitude(false, 'Expected failure')).toThrow(MedusaError);
      expect(() => validateWithAttitude(false, 'Expected failure')).toThrow('Expected failure');
    });

    test('withMedusaErrorHandling wraps and handles async errors', async () => {
      const spy = jest.spyOn(console, 'log').mockImplementation();
      const failFunc = async () => { throw new MedusaError('Async Fail', 'FAIL'); };
      const wrapped = withMedusaErrorHandling(failFunc);
      
      await expect(wrapped()).rejects.toThrow('Async Fail');
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('Medusa Error [FAIL]'));
      spy.mockRestore();
    });
  });
});
