
const WebSocket = require('ws');
const http = require('http');

async function test() {
  console.log('🚀 Starting reproduction for Issue #9');
  
  // 1. Check current workspaces
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

  // 3. Check workspaces again
  const afterOneRegister = await getWorkspaces();
  console.log(`Workspaces count after 1 register: ${afterOneRegister.count}`);
  const ws1Info = afterOneRegister.workspaces.find(ws => ws.id === 'test-workspace-1');
  if (ws1Info) {
    console.log(`Workspace 1 connectionCount: ${ws1Info.connection.connectionCount}`);
  } else {
    console.log('❌ Workspace 1 not found in list!');
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

  // 5. Check workspaces again (Expect 2 connections for test-workspace-1)
  const afterTwoRegisters = await getWorkspaces();
  console.log(`Workspaces count after 2 registers: ${afterTwoRegisters.count}`);
  const ws1Info2 = afterTwoRegisters.workspaces.find(ws => ws.id === 'test-workspace-1');
  if (ws1Info2) {
    console.log(`Workspace 1 connectionCount: ${ws1Info2.connection.connectionCount}`);
  }

  // 6. Disconnect one
  ws1.close();
  await new Promise(resolve => setTimeout(resolve, 500));

  const afterOneDisconnect = await getWorkspaces();
  console.log(`Workspaces count after 1 disconnect: ${afterOneDisconnect.count}`);
  const ws1Info3 = afterOneDisconnect.workspaces.find(ws => ws.id === 'test-workspace-1');
  if (ws1Info3) {
    console.log(`Workspace 1 connectionCount: ${ws1Info3.connection.connectionCount}`);
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
