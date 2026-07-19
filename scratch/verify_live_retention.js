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
  console.log('--- Registering workspace live-retention-test ---');
  const regRes = await postJSON('/workspaces/register', {
    name: 'live-retention-test',
    path: '/Users/jasonvaughan/Documents/Projects/live-retention-test',
    type: 'cursor'
  });
  const workspaceId = regRes.data.workspace.id;
  console.log(`Workspace registered: ${workspaceId}`);

  console.log('\n--- 1. Connect WS client 1 ---');
  const ws1 = new WebSocket('ws://localhost:3010');
  let msg1Id = null;

  await new Promise((resolve) => {
    ws1.on('open', () => {
      ws1.send(JSON.stringify({ type: 'register', workspaceId: workspaceId }));
    });
    ws1.on('message', async (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'registered') {
        console.log('<< WS 1 registered. Sending direct message via HTTP (live delivery)...');
        const sendRes = await postJSON('/messages/direct', {
          from: 'system-sender',
          to: workspaceId,
          message: 'Durable live message'
        });
        msg1Id = sendRes.data.id;
        console.log(`Send response status: ${sendRes.status}, Message ID: ${msg1Id}`);
      }
      if (msg.type === 'new_message') {
        console.log(`<< WS 1 RECEIVED LIVE: "${msg.message.message}" (id: ${msg.messageId})`);
        console.log('Closing WS 1 connection WITHOUT sending ACK...');
        ws1.close();
      }
    });
    ws1.on('close', resolve);
  });

  console.log('\n--- 2. Call GET workspace messages (should still show message since it was not ACKed) ---');
  const getRes = await getJSON(`/messages/workspace/${workspaceId}`);
  console.log(`GET messages count: ${getRes.data.messages.length}`);
  if (getRes.data.messages.length > 0) {
    console.log(`Message 1 exists in queue: ${getRes.data.messages[0].id === msg1Id}`);
  }

  console.log('\n--- 3. Connect WS client 2 (should receive redelivery and send ACK) ---');
  const ws2 = new WebSocket('ws://localhost:3010');
  await new Promise((resolve) => {
    ws2.on('open', () => {
      ws2.send(JSON.stringify({ type: 'register', workspaceId: workspaceId }));
    });
    ws2.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'new_message') {
        console.log(`<< WS 2 RECEIVED (Redelivery): "${msg.message.message}" (id: ${msg.messageId})`);
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

  console.log('\n--- 4. Connect WS client 3 (should be empty, wait 1s) ---');
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
