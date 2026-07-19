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
  console.log('--- Registering workspaces ---');
  const reg1 = await postJSON('/workspaces/register', {
    name: 'invite-init',
    path: '/Users/jasonvaughan/Documents/Projects/invite-init',
    type: 'cursor'
  });
  const initId = reg1.data.workspace.id;

  const reg2 = await postJSON('/workspaces/register', {
    name: 'invite-target',
    path: '/Users/jasonvaughan/Documents/Projects/invite-target',
    type: 'cursor'
  });
  const targetId = reg2.data.workspace.id;

  console.log(`Init workspace: ${initId}, Target workspace: ${targetId}`);

  console.log('\n--- 1. Opening a new loop ---');
  const openRes = await postJSON('/loops', {
    initiator: initId,
    target: targetId,
    task: 'Verification of issue 47 invite delivery',
    doneCriteria: 'Invite delivered successfully',
    guards: { maxRounds: 2, maxWallTimeSeconds: 60 }
  });
  console.log('Open loop status:', openRes.status, 'Loop ID:', openRes.data.id);
  const loopId = openRes.data.id;

  console.log('\n--- 2. Checking target\'s message queue ---');
  const getRes = await getJSON(`/messages/workspace/${targetId}`);
  console.log('GET /messages/workspace target status:', getRes.status, 'Count:', getRes.data.count);
  const inviteMsg = getRes.data.messages[0];
  console.log('Queued invite message details:');
  console.log(`  - ID: ${inviteMsg.id}`);
  console.log(`  - Type: ${inviteMsg.type}`);
  console.log(`  - Loop ID: ${inviteMsg.loopId}`);
  console.log(`  - loopInvite object exists: ${inviteMsg.loopInvite !== undefined}`);
  console.log(`  - Task in loopInvite: "${inviteMsg.loopInvite.task}"`);

  console.log('\n--- 3. Acknowledging the invitation message ---');
  const ackRes = await postJSON('/messages/ack', {
    workspaceId: targetId,
    messageIds: [inviteMsg.id]
  });
  console.log('ACK response:', JSON.stringify(ackRes.data));

  console.log('\n--- 4. Verify target reply transitions loop from initiated to responded ---');
  const replyRes = await postJSON(`/loops/${loopId}/message`, {
    from: targetId,
    message: 'I have received the invite'
  });
  console.log('Reply response status:', replyRes.status, 'data:', replyRes.data);
}

main().catch(console.error);
