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
