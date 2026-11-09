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

  test('Document and Server agree that GET /health also carries gitSha, startedAt, and capabilities (Issue #70 R-Gate)', () => {
    expect(docContent).toMatch(/GET \/health.*also includes the same `gitSha`, `startedAt`, and `capabilities`/);
    const healthHandlerMatch = serverContent.match(/pathname === '\/health'[\s\S]{0,700}/);
    expect(healthHandlerMatch).not.toBeNull();
    expect(healthHandlerMatch[0]).toMatch(/gitSha: MEDUSA_GIT_SHA/);
    expect(healthHandlerMatch[0]).toMatch(/startedAt: this\.serverMetadata\.startedAt/);
    expect(healthHandlerMatch[0]).toMatch(/capabilities: HUB_CAPABILITIES/);
  });

  test('Document and Server agree that the WS "registered" ack carries startedAt (Issue #70 R-Gate)', () => {
    expect(docContent).toMatch(/registered.*acknowledgement.*carries the same `version`, `gitSha`, `startedAt`, and `capabilities`/);
    const registeredFrameMatch = serverContent.match(/type: 'registered'[\s\S]{0,300}/);
    expect(registeredFrameMatch).not.toBeNull();
    expect(registeredFrameMatch[0]).toMatch(/startedAt: this\.serverMetadata\.startedAt/);
  });

  test('Document and Server implement the hub.version_updated subscriber notification (Issue #70)', () => {
    expect(docContent).toMatch(/hub\.version_updated/);
    expect(docContent).toMatch(/previousVersion/);
    expect(serverContent).toMatch(/hub\.version_updated/);
    expect(serverContent).toMatch(/previousVersion/);
    expect(serverContent).toMatch(/detectVersionTransition/);
  });

  test('Document and Server agree that a gitSha or capability change (not just version) triggers hub.version_updated (Issue #70 R-Gate)', () => {
    expect(docContent).toMatch(/a new release version, a new commit on an unchanged version, or a changed capability set/);
    expect(serverContent).toMatch(/gitShaChanged/);
    expect(serverContent).toMatch(/capabilitiesChanged/);
  });

  test('Document and Server agree on the capabilityDelta structure (Issue #70 R-Gate)', () => {
    expect(docContent).toMatch(/"capabilityDelta":/);
    expect(docContent).toMatch(/"added":/);
    expect(docContent).toMatch(/"removed":/);
    expect(docContent).toMatch(/"changed":/);
    expect(serverContent).toMatch(/computeCapabilityDelta/);
    expect(serverContent).toMatch(/capabilityDelta: MedusaServer\.computeCapabilityDelta/);
  });

  test('Document and Server implement opt-in codecEnvelope / canonicalMessage negotiation on POST /messages/direct (Issue #76)', () => {
    expect(docContent).toMatch(/"codecEnvelope":/);
    expect(docContent).toMatch(/"canonicalMessage":/);
    expect(serverContent).toMatch(/validateCodecEnvelope/);
    expect(serverContent).toMatch(/data\.codecEnvelope/);
    expect(serverContent).toMatch(/data\.canonicalMessage/);
  });

  test('Document and Server agree on UNSUPPORTED_CODEC and INVALID_CODEC_ENVELOPE rejection (Issue #76)', () => {
    expect(docContent).toMatch(/UNSUPPORTED_CODEC/);
    expect(docContent).toMatch(/INVALID_CODEC_ENVELOPE/);
    expect(serverContent).toMatch(/code: 'UNSUPPORTED_CODEC'/);
    expect(serverContent).toMatch(/code: 'INVALID_CODEC_ENVELOPE'/);
  });

  test('Document and Server agree that humanAuditText is the message fallback for a codec-only send (Issue #76)', () => {
    expect(docContent).toMatch(/humanAuditText/);
    expect(serverContent).toMatch(/data\.message = data\.codecEnvelope\.humanAuditText/);
  });

  test('Document and Server agree that supportedCodecs and experimental-codec-envelope-v1 are advertised (Issue #76)', () => {
    expect(docContent).toMatch(/supportedCodecs/);
    expect(docContent).toMatch(/experimental-codec-envelope-v1/);
    expect(serverContent).toMatch(/supportedCodecs: this\.codecRegistry\.listCapabilities/);
    expect(serverContent).toMatch(/'experimental-codec-envelope-v1'/);
  });

  test('Server exposes all 9 experimental codecs via createHubCodecRegistry() (Issue #76)', () => {
    expect(serverContent).toMatch(/function createHubCodecRegistry/);
    expect(serverContent).toMatch(/TupleTableCodec/);
    expect(serverContent).toMatch(/DictionaryInternCodec/);
    expect(serverContent).toMatch(/JsonPatchDeltaCodec/);
    expect(serverContent).toMatch(/BlackboardRefCodec/);

    // Verified at runtime rather than against CodecRegistry.js's own file content: PR #74
    // (#81) separately registers all 9 codecs directly in CodecRegistry.js, so a negative
    // file-content assertion here would break the instant both PRs merge together
    // (R-Gate Round 2, PR #82).
    const MedusaServer = require('./medusa-server');
    const server = new MedusaServer({ a2aSecret: 'docs-parity-probe-secret' });
    const ids = server.codecRegistry.listCapabilities().map((cap) => cap.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'nl-baseline-v1', 'compact-json-v1', 'graph-v1', 'graph-delta-v1', 'typed-cmd-v1',
        'tuple-table-v1', 'dict-intern-v1', 'json-patch-v1', 'blackboard-ref-v1'
      ])
    );
  });

  test('MedusaClient implements encodeWithCodec/decodeWithCodec and forwards codec/codecEnvelope/canonicalMessage (Issue #76)', () => {
    const clientMethods = Object.getOwnPropertyNames(MedusaClient.prototype);
    expect(clientMethods).toContain('encodeWithCodec');
    expect(clientMethods).toContain('decodeWithCodec');
    const clientPath = path.join(__dirname, 'client/MedusaClient.js');
    const clientContent = fs.readFileSync(clientPath, 'utf8');
    expect(clientContent).toMatch(/metadata\.codecEnvelope/);
    expect(clientContent).toMatch(/metadata\.canonicalMessage/);
  });

  test('Server and Client agree on wire-authoritative validation and blackboard-ref-v1 metadata hydration (Issue #76 R-Gate Round 2)', () => {
    expect(serverContent).toMatch(/decodeWithCodec/);
    expect(serverContent).toMatch(/buildCodecDecodeContext/);
    expect(serverContent).toMatch(/blackboardArtifacts/);
    expect(serverContent).toMatch(/codecEnvelope\.payload does not match decoded wireText/);

    const clientPath = path.join(__dirname, 'client/MedusaClient.js');
    const clientContent = fs.readFileSync(clientPath, 'utf8');
    expect(clientContent).toMatch(/decodeWithCodec/);
    expect(clientContent).toMatch(/blackboardArtifacts/);
  });

  test('Server and Client agree on multi-turn stateful codec snapshots and digest-safe blackboard hydration (Issue #76 R-Gate Round 3)', () => {
    expect(docContent).toMatch(/patchBaseSnapshot/);
    expect(docContent).toMatch(/graphBaseSnapshot/);
    expect(docContent).toMatch(/symbolTableSnapshot/);
    expect(docContent).toMatch(/re-hashed on hydration/);

    const clientPath = path.join(__dirname, 'client/MedusaClient.js');
    const clientContent = fs.readFileSync(clientPath, 'utf8');
    for (const content of [serverContent, clientContent]) {
      expect(content).toMatch(/patchBaseSnapshot/);
      expect(content).toMatch(/graphBaseSnapshot/);
      expect(content).toMatch(/symbolTableSnapshot/);
      expect(content).toMatch(/store\.put\(value\)/);
    }
  });

  test('Server and Client agree on per-recipient context scoping and safe handling of malformed metadata (Issue #76 R-Gate Round 4)', () => {
    expect(docContent).toMatch(/CROSS_RECIPIENT_CONTEXT_REUSE/);
    expect(docContent).toMatch(/scoped per-recipient/);
    expect(docContent).toMatch(/never crashes the Hub/);

    const clientPath = path.join(__dirname, 'client/MedusaClient.js');
    const clientContent = fs.readFileSync(clientPath, 'utf8');
    for (const content of [serverContent, clientContent]) {
      expect(content).toMatch(/bindStoreToRecipient/);
      expect(content).toMatch(/CROSS_RECIPIENT_CONTEXT_REUSE/);
      expect(content).toMatch(/_boundRecipient/);
    }
    expect(serverContent).toMatch(/Cross-recipient stateful snapshot rejected/);
  });

  test('Server and Client agree that an envelope\'s destination must match the request recipient for every codec (Issue #76 R-Gate Round 5)', () => {
    expect(docContent).toMatch(/boundRecipient/);
    expect(docContent).toMatch(/for every codec/);

    const clientPath = path.join(__dirname, 'client/MedusaClient.js');
    const clientContent = fs.readFileSync(clientPath, 'utf8');
    expect(serverContent).toMatch(/recipientsMatch/);
    expect(serverContent).toMatch(/boundRecipient/);
    expect(serverContent).toMatch(/decoded message\.to/);
    expect(clientContent).toMatch(/boundRecipient/);
  });

  test('Server and Client agree that alias-aware recipient matching is the Hub\'s job, not a client-side pre-check (Issue #76 R-Gate Round 6)', () => {
    expect(docContent).toMatch(/alias-aware/);
    expect(docContent).toMatch(/does \*\*not\*\* pre-check this client-side/);

    const clientPath = path.join(__dirname, 'client/MedusaClient.js');
    const clientContent = fs.readFileSync(clientPath, 'utf8');
    expect(clientContent).not.toMatch(/CROSS_RECIPIENT_ROUTING_MISMATCH/);
    expect(clientContent).toMatch(/no client-side cross-recipient pre-check/i);
  });

  test('Document and Server agree the Hub-side {codec, canonicalMessage} form enforces the same invariants as codecEnvelope (Issue #76 R-Gate Round 7)', () => {
    expect(docContent).toMatch(/enforces the exact same invariants/);
    expect(docContent).toMatch(/structurally valid before the Hub ever encodes it/);
    expect(serverContent).toMatch(/canonicalMessage is not a structurally valid canonical message/);
    expect(serverContent).toMatch(/Unknown codec takes priority over any canonicalMessage validation/);
  });
});
