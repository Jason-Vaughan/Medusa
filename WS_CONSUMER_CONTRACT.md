# Medusa WebSocket Consumer Contract

This document outlines the API contract for Medusa consumers connecting via WebSocket. This completes the requirements for issue #34.

## Connection

Consumers must establish a WebSocket connection to the Medusa Switchboard at `ws://127.0.0.1:3101`.

## Registration

Immediately upon connecting, the client must send a `register` payload:

```json
{
  "type": "register",
  "workspaceId": "your-workspace-name"
}
```

## Receiving Messages

Once registered, the server will forward any incoming direct or broadcast messages to the client. A typical message payload looks like:

```json
{
  "id": "uuid-here",
  "from": "sender-workspace",
  "to": "your-workspace-name",
  "message": "Hello from the swarm",
  "timestamp": "2026-07-11T12:00:00Z",
  "type": "direct" // or "broadcast"
}
```

## Non-Destructive Read & Acknowledgements

Medusa supports store-and-forward queueing. If your workspace is disconnected, messages will queue offline. Once connected, pending messages can be retrieved via:

`GET http://127.0.0.1:3100/messages/workspace/:id`

**Important**: Retrieving messages does NOT remove them from the offline queue. To prevent duplicate delivery, clients MUST explicitly acknowledge messages after processing them:

`POST http://127.0.0.1:3100/messages/ack`
```json
{
  "workspaceId": "your-workspace-name",
  "messageIds": ["uuid-1", "uuid-2"]
}
```

If using the official `MedusaClient.js` library, this is now handled via:
```javascript
await client.ackMessages(['uuid-1', 'uuid-2']);
```

## Idempotent Direct Send & Receipt Reconciliation

Senders that require exactly-once enqueue semantics across retries or crashes (such as check-watch wake notifications) can supply an `idempotencyKey` (in the JSON body or `Idempotency-Key` header) on `POST /messages/direct`:

`POST http://127.0.0.1:3100/messages/direct`
```json
{
  "from": "sender-workspace",
  "to": "your-workspace-name",
  "message": "Wake check result",
  "idempotencyKey": "check-watch-123"
}
```

- **Atomic Persistence**: The Hub persists the `idempotencyKey` record and the durable `offlineQueues` entry atomically to disk before returning. Both the queued message and its identity survive Hub restarts and hand off to the target session across session clear/relaunch when the session re-registers over WebSocket.
- **Idempotent Replay (`200 OK`)**: Replaying the same `idempotencyKey` with the identical recipient and payload returns the original Hub message `id` (`replayed: true`) and does NOT enqueue or deliver a duplicate message.
- **Conflict Detection (`409 Conflict`)**: Reusing an `idempotencyKey` with a different recipient or payload is refused with HTTP `409` and `code: "IDEMPOTENCY_KEY_CONFLICT"`.
- **Read-Only Receipt Lookup**: Senders can reconcile an unknown send outcome without creating another message via:

`GET http://127.0.0.1:3100/messages/receipts/:idempotencyKey`

The server responds with `200 OK` (or `404` with `code: "RECEIPT_NOT_FOUND"` if unknown):
```json
{
  "found": true,
  "idempotencyKey": "check-watch-123",
  "id": "uuid-here",
  "messageId": "uuid-here",
  "from": "sender-workspace",
  "to": "your-workspace-name",
  "status": "queued",
  "queued": true,
  "delivered": false,
  "acked": false,
  "timestamp": "2026-07-11T12:00:00Z",
  "deliveredAt": null,
  "ackedAt": null
}
```

If using `MedusaClient.js`, callers can pass `{ idempotencyKey }` to `sendMessage` and query receipts via `getMessageReceipt(idempotencyKey)`.

## Opt-in Experimental Codec Negotiation

`POST /messages/direct` can carry an **opt-in** encoded payload instead of (or alongside) a plain-text `message`, using any of the 9 experimental communication codecs benchmarked under `Medusa#71` (`nl-baseline-v1`, `compact-json-v1`, `graph-v1`, `graph-delta-v1`, `typed-cmd-v1`, `tuple-table-v1`, `dict-intern-v1`, `json-patch-v1`, `blackboard-ref-v1`). Default production behavior (a plain `message` string, no `codec`/`codecEnvelope`/`canonicalMessage`) is unchanged.

Two ways to send an encoded payload:

1. **Pre-encoded `codecEnvelope`** — encode client-side (e.g. via `MedusaClient.encodeWithCodec(codecId, canonicalMessage)`) and send the envelope as-is:
   ```json
   {
     "from": "sender-workspace",
     "to": "your-workspace-name",
     "codecEnvelope": { "codec": "compact-json-v1", "schemaVersion": "1.0.0", "payload": {}, "wireText": "...", "humanAuditText": "[task.assign] sender -> you", "metadata": {} }
   }
   ```
2. **`codec` + `canonicalMessage`** — let the Hub encode it server-side:
   ```json
   {
     "from": "sender-workspace",
     "to": "your-workspace-name",
     "codec": "json-patch-v1",
     "canonicalMessage": { "kind": "task.ack", "status": "working" }
   }
   ```

`message` may be omitted or empty in either form — the Hub falls back to the codec envelope's own `humanAuditText` so legacy clients that only read `message` still see something sensible.

- **Validation**: the Hub checks that `codecEnvelope.codec` names a codec registered in its `CodecRegistry`, that `wireText`/`humanAuditText` are non-empty strings, and that `wireText` — the actual wire bytes, always, regardless of whether `payload` is also present — decodes into a structurally valid canonical message. If `payload` is also supplied, it must agree with what `wireText` decodes to; a valid-looking `payload` can never paper over corrupt, mismatched, or tampered `wireText`. A caller-supplied `codec` must match `codecEnvelope.codec` when both are present. An unknown codec id is refused with `400` `{ "code": "UNSUPPORTED_CODEC" }`; anything else wrong with the envelope (malformed shape, undecodable wire, a payload/wireText mismatch, or a `codec`/`codecEnvelope.codec` mismatch) is `400` `{ "code": "INVALID_CODEC_ENVELOPE" }`.
- **Stateful codecs decode standalone, Turn 1 and Turn 2+**: `MedusaClient.encodeWithCodec` (and the Hub's own server-side encode) attach a metadata snapshot for each of the 4 stateful codecs, so a recipient with no access to the sender's live store — the Hub's own validation, or a different client entirely — can still decode the envelope:
  - `blackboard-ref-v1`: its wire format carries only `@art:<sha256_12>` pointers, never the referenced heavy-field values, on every turn. `codecEnvelope.metadata.blackboardArtifacts` carries the referenced values; each is re-hashed on hydration (never trusted at face value), so a forged `(hash, value)` pair can never be dereferenced under a hash it doesn't actually hash to.
  - `json-patch-v1` / `graph-delta-v1`: Turn 1 is self-contained (a full "add" diff from an empty base), but a Turn 2+ delta sent with a persistent `context.senderStore` has `baseVersion > 0` — undecodable without first resyncing to that base. `codecEnvelope.metadata.patchBaseSnapshot` / `graphBaseSnapshot` (the base state, captured before that turn's encode) lets a fresh store resync before decode applies the delta.
  - `dict-intern-v1`: Turn 1 is self-contained (new symbols are defined inline on first use), but a Turn 2+ message sent with a persistent `context.senderTable` may reference a symbol interned on an earlier turn and omit it from this turn's `newSymbols`. `codecEnvelope.metadata.symbolTableSnapshot` (every symbol known as of that turn) lets a fresh table resync before decode.
  - Use `MedusaClient.decodeWithCodec(codecEnvelope)` to decode a received message — it hydrates all of the above automatically from whichever metadata the envelope actually carries.
- **Stateful contexts are scoped per-recipient**: the `context` passed to `encodeWithCodec` (its `senderStore` / `senderTable` / `store`) must never be reused across two different recipients. `encodeWithCodec` binds a stateful context to the `to` of the first message encoded against it (`store._boundRecipient = canonicalMessage.to`); encoding against it again for a different recipient throws `CROSS_RECIPIENT_CONTEXT_REUSE` rather than silently leaking the first recipient's message content into the metadata snapshot of an envelope addressed to the second. Use a separate context per recipient. The Hub also rejects, as a defense-in-depth backstop, a `codecEnvelope.metadata.patchBaseSnapshot` whose captured state was addressed to a different recipient than the request's actual `to`.
- **Malformed `metadata` never crashes the Hub**: an untrusted or corrupted `patchBaseSnapshot` / `graphBaseSnapshot` / `symbolTableSnapshot` / `blackboardArtifacts` is always reported as `400` `{ "code": "INVALID_CODEC_ENVELOPE" }`, never an uncaught `500`.
- **Delivery**: the stored and delivered message (HTTP offline queue and the WS `new_message` frame) carries `codec` and the full `codecEnvelope` alongside `message`.
- **Idempotency parity (`Medusa#67`)**: replaying the same `idempotencyKey` with the identical recipient, `message`, `codec`, `codecEnvelope`, and `canonicalMessage` returns the original receipt (`200`, `replayed: true`); any difference in the codec payload is a `409 Conflict` `IDEMPOTENCY_KEY_CONFLICT`, exactly like a differing plain `message`.
- **Capability discovery**: `GET /version`, `GET /health`, and the WS `registered` ack all carry `supportedCodecs` (the list of registered codec ids) and `"experimental-codec-envelope-v1"` in `capabilities`.

## Heartbeats

To keep the connection alive and advertise autonomous mode status, clients should periodically send a `listener_heartbeat`:
```json
{
  "type": "listener_heartbeat",
  "status": "active" // or "inactive"
}
```
The server will respond with a `heartbeat_ack` confirming the status.

## Hub Version & Capability Manifest

Consumers that need to discover what commit/version/capabilities the running Hub is serving — or be notified when it upgrades — can query:

`GET http://127.0.0.1:3100/version`

The server responds with `200 OK`:
```json
{
  "version": "1.0.0-rc2",
  "gitSha": "9cc5b5e18a57f45525f6a68bdd3859ca4c0b61ac",
  "startedAt": "2026-07-11T12:00:00.000Z",
  "capabilities": ["durable-send-idempotency-v1", "iso8601-heartbeat-v1", "version-manifest-v1", "experimental-codecs-v1"]
}
```

`GET /health` also includes the same `gitSha`, `startedAt`, and `capabilities` fields alongside its existing fields.

The WebSocket `registered` acknowledgement (sent immediately after a `register` frame) carries the same `version`, `gitSha`, `startedAt`, and `capabilities` fields, so a reconnecting consumer always learns what it's talking to without a separate round trip.

### Subscriber Update Notification (`hub.version_updated`)

A Hub restart persists its `version`, `gitSha`, and `capabilities` to disk. On the next boot, if **any** of those three differ from what was persisted — a new release version, a new commit on an unchanged version, or a changed capability set — every workspace that registers over WebSocket after that restart receives an additional push notification:

```json
{
  "type": "hub.version_updated",
  "version": "1.0.0-rc2",
  "gitSha": "9cc5b5e18a57f45525f6a68bdd3859ca4c0b61ac",
  "previousVersion": "1.0.0-rc",
  "previousGitSha": "4d0edc67f6d705b1f4beaed80d0ab88ffaadf7e0",
  "capabilities": ["durable-send-idempotency-v1", "iso8601-heartbeat-v1", "version-manifest-v1", "experimental-codecs-v1"],
  "previousCapabilities": ["durable-send-idempotency-v1", "iso8601-heartbeat-v1"],
  "capabilityDelta": {
    "added": ["version-manifest-v1", "experimental-codecs-v1"],
    "removed": [],
    "changed": []
  },
  "timestamp": "2026-07-11T12:00:00.000Z"
}
```

`capabilityDelta.changed` is always empty — capabilities are flat identifier strings with no associated value, so a capability is only ever added or removed, never "changed" in place.

This is sent once per registration following an upgrade, in addition to (not instead of) the normal `registered` ack, so subscribers that were disconnected across the restart still learn what changed. No frame is sent when the Hub restarts with an unchanged version, gitSha, and capability set.

## Peek

Consumers can remotely check the state of another workspace without sending a message or altering its execution. This is useful before initiating a blocking request.

`GET http://127.0.0.1:3100/workspaces/:workspaceId/peek`

The server responds with:
```json
{
  "state": "busy",
  "reason": "at-dialog",
  "lastActivity": "2026-07-11T12:00:00Z",
  "paneTail": "Last few lines of terminal output..."
}
```
