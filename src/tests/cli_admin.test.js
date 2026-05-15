const { spawn } = require('child_process');
const path = require('path');

describe('Medusa CLI Admin Commands', () => {
  const medusaBin = path.join(__dirname, '..', '..', 'bin', 'medusa.js');

  test('a2a profile command exists', (done) => {
    const child = spawn('node', [medusaBin, 'a2a', 'profile', '--help']);
    let output = '';
    let error = '';
    child.stdout.on('data', (data) => output += data);
    child.stderr.on('data', (data) => error += data);
    child.on('close', (code) => {
      if (code !== 0) {
        console.error('CLI Help error:', error);
      }
      expect(code).toBe(0);
      expect(output).toContain('Capability Profile management');
      expect(output).toContain('list');
      expect(output).toContain('create');
      expect(output).toContain('show');
      done();
    });
  }, 10000);

  test('a2a grant command exists', (done) => {
    const child = spawn('node', [medusaBin, 'a2a', 'grant', '--help']);
    let output = '';
    let error = '';
    child.stdout.on('data', (data) => output += data);
    child.stderr.on('data', (data) => error += data);
    child.on('close', (code) => {
      if (code !== 0) {
        console.error('CLI Help error:', error);
      }
      expect(code).toBe(0);
      expect(output).toContain('Workspace Grant management');
      expect(output).toContain('list');
      expect(output).toContain('create');
      expect(output).toContain('revoke');
      done();
    });
  }, 10000);

  test('a2a peer command exists', (done) => {
    const child = spawn('node', [medusaBin, 'a2a', 'peer', '--help']);
    let output = '';
    let error = '';
    child.stdout.on('data', (data) => output += data);
    child.stderr.on('data', (data) => error += data);
    child.on('close', (code) => {
      if (code !== 0) {
        console.error('CLI Help error:', error);
      }
      expect(code).toBe(0);
      expect(output).toContain('Mesh Peer management');
      expect(output).toContain('list');
      expect(output).toContain('quarantine');
      expect(output).toContain('unquarantine');
      done();
    });
  }, 10000);
});
