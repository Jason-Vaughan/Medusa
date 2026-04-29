
const WebSocket = require('ws');
const http = require('http');

async function test() {
  console.log('🚀 Starting reproduction for Issue #9');
  
  // 1. Check current workspaces (should be 0)
  const initialWorkspaces = await getWorkspaces();
  console.log(`Initial workspaces count: ${initialWorkspaces.count}`);

  // 2. Connect and register a workspace via WebSocket
  const ws1 = new WebSocket('ws://localhost:3010');
  await new Promise((resolve) => ws1.on('open', resolve));
  
  ws1.send(JSON.stringify({
    type: 'register',
    workspaceId: 'test-workspace-1'
  }));

  await new Promise((resolve) => {
    ws1.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'registered') {
        console.log('✅ ws1 registered');
        resolve();
      }
    });
  });

  // 3. Check workspaces again (Expect 1, but currently might be 0)
  const afterOneRegister = await getWorkspaces();
  console.log(`Workspaces count after 1 register: ${afterOneRegister.count}`);
  if (afterOneRegister.workspaces.length > 0) {
    console.log(`Workspace 1 connectionCount: ${afterOneRegister.workspaces[0].connection.connectionCount}`);
  }

  // 4. Connect another client to same workspace
  const ws2 = new WebSocket('ws://localhost:3010');
  await new Promise((resolve) => ws2.on('open', resolve));
  
  ws2.send(JSON.stringify({
    type: 'register',
    workspaceId: 'test-workspace-1'
  }));

  await new Promise((resolve) => {
    ws2.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'registered') {
        console.log('✅ ws2 registered');
        resolve();
      }
    });
  });

  // 5. Check workspaces again (Expect 1 workspace, 2 connections)
  const afterTwoRegisters = await getWorkspaces();
  console.log(`Workspaces count after 2 registers: ${afterTwoRegisters.count}`);
  if (afterTwoRegisters.workspaces.length > 0) {
    console.log(`Workspace 1 connectionCount: ${afterTwoRegisters.workspaces[0].connection.connectionCount}`);
  }

  // 6. Disconnect one
  ws1.close();
  await new Promise(resolve => setTimeout(resolve, 500));

  const afterOneDisconnect = await getWorkspaces();
  console.log(`Workspaces count after 1 disconnect: ${afterOneDisconnect.count}`);
  if (afterOneDisconnect.workspaces.length > 0) {
    console.log(`Workspace 1 connectionCount: ${afterOneDisconnect.workspaces[0].connection.connectionCount}`);
  }

  // 7. Disconnect second
  ws2.close();
  await new Promise(resolve => setTimeout(resolve, 500));

  const afterTwoDisconnects = await getWorkspaces();
  console.log(`Workspaces count after 2 disconnects: ${afterTwoDisconnects.count}`);

  process.exit(0);
}

function getWorkspaces() {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:3009/workspaces', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

test().catch(console.error);
