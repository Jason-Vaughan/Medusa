const WebSocket = require('ws');
const http = require('http');

function postJSON(path, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const options = {
      hostname: 'localhost',
      port: 3009,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          data: body.trim() === '' ? {} : JSON.parse(body)
        });
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function getJSON(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3009,
      path: path,
      method: 'GET'
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          data: body.trim() === '' ? {} : JSON.parse(body)
        });
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function main() {
  console.log('--- Registering workspace ack-e2e-test ---');
  const regRes = await postJSON('/workspaces/register', {
    name: 'ack-e2e-test',
    path: '/Users/jasonvaughan/Documents/Projects/ack-e2e-test',
    type: 'cursor'
  });
  const workspaceId = regRes.data.workspace.id;
  console.log(`Workspace registered: ${workspaceId}`);

  console.log('\n--- 1. Send message to offline workspace ---');
  const sendRes1 = await postJSON('/messages/direct', {
    from: 'system-sender',
    to: workspaceId,
    message: 'Message 1: test non-destructive HTTP read'
  });
  console.log('Send 1 response status:', sendRes1.status, 'data:', sendRes1.data);
  const msg1Id = sendRes1.data.id;

  console.log('\n--- 2. Call GET workspace messages first time ---');
  const getRes1 = await getJSON(`/messages/workspace/${workspaceId}`);
  console.log(`First GET messages count: ${getRes1.data.messages.length}`);
  console.log('First message content:', getRes1.data.messages[0].message);

  console.log('\n--- 3. Call GET workspace messages second time (should still exist) ---');
  const getRes2 = await getJSON(`/messages/workspace/${workspaceId}`);
  console.log(`Second GET messages count: ${getRes2.data.messages.length}`);

  console.log('\n--- 4. POST /messages/ack to clear message 1 ---');
  const ackRes = await postJSON('/messages/ack', {
    workspaceId: workspaceId,
    messageIds: [msg1Id]
  });
  console.log('ACK Response:', JSON.stringify(ackRes.data));

  console.log('\n--- 5. Call GET workspace messages third time (should be empty) ---');
  const getRes3 = await getJSON(`/messages/workspace/${workspaceId}`);
  console.log(`Third GET messages count: ${getRes3.data.messages.length}`);

  console.log('\n--- 6. Send message 2 to offline workspace ---');
  const sendRes2 = await postJSON('/messages/direct', {
    from: 'system-sender',
    to: workspaceId,
    message: 'Message 2: test WS redelivery'
  });
  const msg2Id = sendRes2.data.id;
  console.log(`Message 2 queued: ${msg2Id}`);

  console.log('\n--- 7. Connect WS client first time (no ACK, then close) ---');
  const ws1 = new WebSocket('ws://localhost:3010');
  await new Promise((resolve) => {
    ws1.on('open', () => {
      ws1.send(JSON.stringify({ type: 'register', workspaceId: workspaceId }));
    });
    ws1.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'new_message') {
        console.log(`<< WS 1 RECEIVED: "${msg.message.message}" (id: ${msg.messageId})`);
        ws1.close();
      }
    });
    ws1.on('close', resolve);
  });

  console.log('\n--- 8. Connect WS client second time (should receive redelivery and send ACK) ---');
  const ws2 = new WebSocket('ws://localhost:3010');
  await new Promise((resolve) => {
    ws2.on('open', () => {
      ws2.send(JSON.stringify({ type: 'register', workspaceId: workspaceId }));
    });
    ws2.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'new_message') {
        console.log(`<< WS 2 RECEIVED (Redelivery): "${msg.message.message}" (id: ${msg.messageId})`);
        // Send ACK frame
        console.log('>> WS 2 SENDING ACK...');
        ws2.send(JSON.stringify({
          type: 'ack',
          messageIds: [msg.messageId]
        }));
      }
      if (msg.type === 'ack_response') {
        console.log('<< WS 2 RECEIVED ACK RESPONSE:', JSON.stringify(msg));
        ws2.close();
      }
    });
    ws2.on('close', resolve);
  });

  console.log('\n--- 9. Connect WS client third time (should be empty, wait 1s) ---');
  const ws3 = new WebSocket('ws://localhost:3010');
  let receivedMsgWs3 = false;
  ws3.on('open', () => {
    ws3.send(JSON.stringify({ type: 'register', workspaceId: workspaceId }));
  });
  ws3.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'new_message') {
      receivedMsgWs3 = true;
      console.log('<< WS 3 RECEIVED MESSAGE (Unexpected):', msg);
    }
  });

  await new Promise(r => setTimeout(r, 1000));
  ws3.close();
  console.log(`WS 3 complete. Received messages: ${receivedMsgWs3}`);
}

main().catch(console.error);
