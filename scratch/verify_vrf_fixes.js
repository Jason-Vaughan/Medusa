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
        'Content-Length': Buffer.byteLength(data)
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
  console.log('--- Registering workspaces with human names ---');
  const reg1 = await postJSON('/workspaces/register', {
    name: 'initname',
    path: '/Users/jasonvaughan/Documents/Projects/initname',
    type: 'cursor'
  });
  const initId = reg1.data.workspace.id;

  const reg2 = await postJSON('/workspaces/register', {
    name: 'targetname',
    path: '/Users/jasonvaughan/Documents/Projects/targetname',
    type: 'cursor'
  });
  const targetId = reg2.data.workspace.id;

  console.log(`Init WS registered: ${initId} (name: initname)`);
  console.log(`Target WS registered: ${targetId} (name: targetname)`);

  console.log('\n--- 1. Testing send-by-name for direct message ---');
  const msgRes = await postJSON('/messages/direct', {
    from: initId,
    to: 'targetname', // Addressing by name instead of raw ID!
    message: 'hello send-by-name'
  });
  console.log('Direct message status:', msgRes.status, 'Body:', JSON.stringify(msgRes.data));

  // Check target's queue to verify message arrived
  const getMsgsRes = await getJSON(`/messages/workspace/${targetId}`);
  console.log('Messages count in target inbox:', getMsgsRes.data.count);
  console.log('First message destination resolved to ID:', getMsgsRes.data.messages[0].to);
  // ACK the message
  await postJSON('/messages/ack', {
    workspaceId: targetId,
    messageIds: [getMsgsRes.data.messages[0].id]
  });

  console.log('\n--- 2. Testing send-by-name in loop creation ---');
  const loopRes = await postJSON('/loops', {
    initiator: 'initname', // Addressing initiator by name!
    target: 'targetname',   // Addressing target by name!
    task: 'Verify switchboard VRF fixes',
    doneCriteria: 'All 3 fixes pass',
    guards: { maxRounds: 2, maxWallTimeSeconds: 1 } // short wall time
  });
  console.log('Open loop status:', loopRes.status, 'Loop ID:', loopRes.data.id);
  const loopId = loopRes.data.id;

  console.log('\n--- 3. Verifying loop invite message schema in target queue ---');
  const targetQueueRes = await getJSON(`/messages/workspace/${targetId}`);
  const inviteMsg = targetQueueRes.data.messages[0];
  console.log('Queued invite details:');
  console.log(`  - loopId: ${inviteMsg.loopId}`);
  console.log(`  - loopInvite.replyEndpoint: ${inviteMsg.loopInvite.replyEndpoint}`);
  console.log(`  - loopInvite.replyInstruction: "${inviteMsg.loopInvite.replyInstruction}"`);
  // ACK the invite message
  await postJSON('/messages/ack', {
    workspaceId: targetId,
    messageIds: [inviteMsg.id]
  });

  console.log('\n--- 4. Waiting 1.5s (should NOT trip wall-clock guard yet as loop is initiated) ---');
  await new Promise(r => setTimeout(r, 1500));
  const check1 = await getJSON(`/loops/${loopId}`);
  console.log(`Loop state after 1.5s idle wait: "${check1.data.state}" (Expected: "initiated")`);

  console.log('\n--- 5. Target replies (starts the clock) ---');
  const replyRes = await postJSON(`/loops/${loopId}/message`, {
    from: targetId,
    message: 'Target responds, starting the timer'
  });
  console.log('Reply response status:', replyRes.status, 'Loop state:', replyRes.data.loopState);

  console.log('\n--- 6. Waiting 1.5s (should trip wall-clock guard now) ---');
  await new Promise(r => setTimeout(r, 1500));
  const check2 = await getJSON(`/loops/${loopId}`);
  console.log(`Loop state after 1.5s active wait: "${check2.data.state}" (Expected: "halted")`);
}

main().catch(console.error);
