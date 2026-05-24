# 🐍 Medusa Upgrade Path: v0.8.x -> v1.0-rc

## Overview
Medusa v1.0-rc introduces significant architectural hardening, moving from a multi-interface listening model to a loopback-only default. It also formalizes the autonomous scaling protocol and improves mesh stability.

## 🚨 Breaking Changes
1. **Network Binding:** Services now bind strictly to `127.0.0.1` by default. For multi-host setups, you must now use an overlay network (Tailscale) or a TLS wrapper.
2. **Environment Variables:** 
   - `PORT` for Medusa Server is now `MEDUSA_PROTOCOL_PORT`.
   - `A2A_HOST` and `MEDUSA_PROTOCOL_HOST` are now required for non-loopback binding.
3. **HMAC Window:** The HMAC replay window is now strictly 300 seconds (5 minutes). Ensure system clocks are synced.

## 🛠 Step-by-Step Upgrade

### 1. Pre-Upgrade Audit
Ensure all nodes in your swarm are currently running v0.8.2-beta or higher. Complete all in-flight tasks as the mesh will require a full restart.

### 2. Update Configuration
Update your environment variable names:
- Change `PORT` -> `MEDUSA_PROTOCOL_PORT` (for the Medusa Server process).
- (Optional) Set `A2A_SECRET` using `openssl rand -hex 32`.

### 3. Install New Version
If using the distribution package:
```bash
tar -xzf medusa-v1.0-rc.tar.gz
cd medusa-v1.0-rc
./INSTALL.sh
```

### 4. Migrate Database (if applicable)
v1.0-rc ledger schema is compatible with v0.8.2-beta. No manual migration is required for the SQLite ledgers.

### 5. Verify Connectivity
Start the seed node and Medusa server. Verify they are communicating via the dashboard at `http://localhost:8181`.

## 🧪 Testing the Upgrade
Run the new E2E validation script:
```bash
python3 scripts/test_e2e_spawn_integration.py
```

## 🔄 Rolling Back
To rollback to v0.8.x:
1. Revert `MEDUSA_PROTOCOL_PORT` back to `PORT`.
2. Downgrade the Medusa Server package.
3. Restart all nodes.
