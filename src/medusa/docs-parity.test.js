const fs = require('fs');
const path = require('path');
const MedusaClient = require('./client/MedusaClient');
const medusaServerPath = path.join(__dirname, 'medusa-server.js');

describe('Documentation Parity: WS_CONSUMER_CONTRACT.md', () => {
  let docContent;
  let serverContent;

  beforeAll(() => {
    const docPath = path.join(__dirname, '../../WS_CONSUMER_CONTRACT.md');
    if (!fs.existsSync(docPath)) {
      throw new Error('WS_CONSUMER_CONTRACT.md does not exist!');
    }
    docContent = fs.readFileSync(docPath, 'utf8');
    serverContent = fs.readFileSync(medusaServerPath, 'utf8');
  });

  test('Document mentions the correct WebSocket port (3101)', () => {
    expect(docContent).toMatch(/ws:\/\/127\.0\.0\.1:3101/);
  });

  test('Document mentions the correct API port (3100)', () => {
    expect(docContent).toMatch(/http:\/\/127\.0\.0\.1:3100/);
  });

  test('Document describes the register payload', () => {
    expect(docContent).toMatch(/"type":\s*"register"/);
    expect(docContent).toMatch(/"workspaceId":/);
  });

  test('Document describes the heartbeat payload', () => {
    expect(docContent).toMatch(/"type":\s*"listener_heartbeat"/);
    expect(docContent).toMatch(/"status":/);
  });

  test('Server implements the offline queue GET endpoint documented', () => {
    expect(docContent).toMatch(/\/messages\/workspace\/:id/);
    expect(serverContent).toMatch(/\/messages\/workspace\//);
  });

  test('Server implements the ACK endpoint documented', () => {
    expect(docContent).toMatch(/\/messages\/ack/);
    expect(serverContent).toMatch(/\/messages\/ack/);
  });

  test('MedusaClient implements ackMessages method documented', () => {
    expect(docContent).toMatch(/ackMessages/);
    const clientMethods = Object.getOwnPropertyNames(MedusaClient.prototype);
    expect(clientMethods).toContain('ackMessages');
  });

  test('Server implements the Peek endpoint documented', () => {
    expect(docContent).toMatch(/\/workspaces\/:workspaceId\/peek/);
    expect(serverContent).toMatch(/\\\/workspaces\\\/\[\^\\\/\]\+\\\/peek/);
  });

  test('Document and Server implement idempotent send and receipt lookup (Issue #67)', () => {
    expect(docContent).toMatch(/idempotencyKey/);
    expect(docContent).toMatch(/IDEMPOTENCY_KEY_CONFLICT/);
    expect(docContent).toMatch(/\/messages\/receipts\/:idempotencyKey/);
    expect(serverContent).toMatch(/IDEMPOTENCY_KEY_CONFLICT/);
    expect(serverContent).toMatch(/\/messages\/receipts/);
    const clientMethods = Object.getOwnPropertyNames(MedusaClient.prototype);
    expect(clientMethods).toContain('getMessageReceipt');
  });

  test('Document and Server implement the Hub version/capability manifest endpoint (Issue #70)', () => {
    expect(docContent).toMatch(/\/version/);
    expect(docContent).toMatch(/"gitSha":/);
    expect(docContent).toMatch(/"capabilities":/);
    expect(serverContent).toMatch(/pathname === '\/version'/);
    expect(serverContent).toMatch(/MEDUSA_GIT_SHA/);
    expect(serverContent).toMatch(/HUB_CAPABILITIES/);
  });

  test('Document and Server implement the hub.version_updated subscriber notification (Issue #70)', () => {
    expect(docContent).toMatch(/hub\.version_updated/);
    expect(docContent).toMatch(/previousVersion/);
    expect(serverContent).toMatch(/hub\.version_updated/);
    expect(serverContent).toMatch(/previousVersion/);
    expect(serverContent).toMatch(/detectVersionTransition/);
  });
});
