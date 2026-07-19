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

async function main() {
  console.log('--- Registering tangleclaw-6c8adb6c ---');
  const regRes = await postJSON('/workspaces/register', {
    name: 'TangleClaw',
    path: '/Users/jasonvaughan/Documents/Projects/TangleClaw',
    type: 'cursor'
  });
  console.log('Register status:', regRes.status, 'data:', regRes.data);

  // Overwrite the workspace ID mapping to be exactly 'tangleclaw-6c8adb6c' if generated differently
  // Wait, the client registers with name 'TangleClaw'. When we registered above, it probably generated 'tangleclaw-xxxxxxxx'.
  // Let's manually inject 'tangleclaw-6c8adb6c' into workspaceRegistry of the running server by calling registering it, 
  // but wait! Can we register with a custom ID or name?
  // Let's check: POST /workspaces/register uses { name, path, type }. It generates id = name.toLowerCase() + '-' + crypto.randomBytes(4).toString('hex').
  // Oh! So we cannot pass custom ID via /workspaces/register.
  // But wait! Is there any other way?
  // Let's check how the registry works. The server saves registry to ~/.medusa/medusa-registry.json.
  // Can we just POST/register or insert it directly?
  // Wait, if a client connects to WS:
  // "ws.on('message', (rawData) => { ... if (message.type === 'register') { workspaceId = message.workspaceId; ... } })"
  // Yes! The WS connection just registers with the workspaceId directly!
  // So the WS client wsClients mapping uses whatever workspaceId is sent in the register frame.
  // But for POST /messages/direct, it checks if it is in workspaceRegistry.
  // Wait! Can we register it by adding it directly to ~/.medusa/medusa-registry.json?
  // Yes! ~/.medusa/medusa-registry.json is a JSON file.
  // Let's check where medusa-registry.json is located or read it.
  // In medusa-server.js:
  // this.workspaceRegistryFile = path.join(os.homedir(), '.medusa', 'medusa-registry.json');
  // Let's read this file and append the mapping for 'tangleclaw-6c8adb6c'!
  // Then we can trigger the server to reload registry or restart the server!
}

main().catch(console.error);
