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

## Heartbeats

To keep the connection alive and advertise autonomous mode status, clients should periodically send a `listener_heartbeat`:
```json
{
  "type": "listener_heartbeat",
  "status": "active" // or "inactive"
}
```
The server will respond with a `heartbeat_ack` confirming the status.

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
