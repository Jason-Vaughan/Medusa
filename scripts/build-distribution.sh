#!/bin/bash
# scripts/build-distribution.sh
# Automates the creation of the Medusa v1.0-rc distribution package.

set -e

VERSION="1.0.0"
DIST_DIR="dist/medusa-${VERSION}"
TAR_FILE="medusa-${VERSION}.tar.gz"

echo "🐍 Building Medusa ${VERSION} Distribution..."

# 1. Clean and Create Dist Directory
rm -rf dist
mkdir -p "${DIST_DIR}"
mkdir -p "${DIST_DIR}/bin"
mkdir -p "${DIST_DIR}/src/medusa"
mkdir -p "${DIST_DIR}/src/a2a_node"

# 2. Copy Core Components
echo "[*] Copying core components..."
cp bin/medusa.js "${DIST_DIR}/bin/"
cp bin/verify-version.js "${DIST_DIR}/bin/"
cp -r src/medusa/* "${DIST_DIR}/src/medusa/"
cp -r src/a2a_node/* "${DIST_DIR}/src/a2a_node/"

# Legacy Google bridge handling
if [ -d "Medusa Chat Protocol/mcp-server-distribution/mcp-server" ]; then
    echo "[*] Including legacy Google Bridge..."
    mkdir -p "${DIST_DIR}/bridges/google"
    cp -r "Medusa Chat Protocol/mcp-server-distribution/mcp-server/"* "${DIST_DIR}/bridges/google/"
fi

# Clean up ephemeral files and test artifacts
echo "[*] Cleaning ephemeral files..."
rm -rf "${DIST_DIR}/src/a2a_node/venv"
find "${DIST_DIR}" -name "*.db" -delete
find "${DIST_DIR}" -name "*.log" -delete
find "${DIST_DIR}" -name "__pycache__" -type d -exec rm -rf {} +
find "${DIST_DIR}" -name ".pytest_cache" -type d -exec rm -rf {} +
find "${DIST_DIR}" -name "*.test.js" -delete
find "${DIST_DIR}" -name "tests" -type d -exec rm -rf {} +

# 3. Create Distribution INSTALL.sh
echo "[*] Creating robust INSTALL.sh..."
cat > "${DIST_DIR}/INSTALL.sh" <<'EOF'
#!/bin/bash
set -e

VERSION="1.0.0"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}🐍 Medusa ${VERSION} Installer${NC}"

function fail() {
    echo -e "${RED}❌ $1${NC}"
    exit 1
}

# 1. Prerequisite Checks
echo "[*] Checking prerequisites..."
command -v node >/dev/null 2>&1 || fail "Node.js not found. Please install Node.js 18+."
command -v python3 >/dev/null 2>&1 || fail "Python 3 not found. Please install Python 3.10+."

NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VER" -lt 18 ]; then
    fail "Node.js version 18+ required (Found v$NODE_VER)."
fi

# 2. Node.js Dependencies
echo "[*] Installing Medusa Server dependencies..."
if [ -d "src/medusa" ]; then
    cd src/medusa
    npm install --production || fail "npm install failed in src/medusa."
    cd ../..
else
    fail "src/medusa directory missing."
fi

# 3. Python Virtual Environment
echo "[*] Setting up A2A Node virtual environment..."
if [ -d "src/a2a_node" ]; then
    cd src/a2a_node
    if [ ! -d "venv" ]; then
        python3 -m venv venv || fail "Failed to create virtual environment."
    fi
    source venv/bin/activate
    pip install --upgrade pip
    pip install -r requirements.txt || fail "pip install failed in src/a2a_node."
    deactivate
    cd ../..
else
    fail "src/a2a_node directory missing."
fi

# 4. Optional Bridges
if [ -d "bridges/google" ]; then
    echo "[*] Setting up Google Bridge (Optional)..."
    cd bridges/google
    if [ ! -d "venv" ]; then
        python3 -m venv venv || fail "Failed to create venv for Google Bridge."
    fi
    source venv/bin/activate
    pip install -r requirements.txt || echo -e "${YELLOW}⚠️  Google Bridge deps failed (skipping optional component).${NC}"
    deactivate
    cd ../..
fi

echo -e "${GREEN}✅ Medusa installation complete!${NC}"
echo ""
echo "Quick Start:"
echo "1. Start the Mesh:  node bin/medusa.js medusa start"
echo "2. Dashboard:      http://127.0.0.1:8181"
echo "3. MCP Integration: Use src/medusa/medusa-mcp-server.js in Cursor/Claude."
echo ""
echo "See UPGRADE_PATH.md if upgrading from v0.8.x."
EOF
chmod +x "${DIST_DIR}/INSTALL.sh"

# 4. Copy Documentation
cp README.md "${DIST_DIR}/"
cp SECURITY.md "${DIST_DIR}/"
cp UPGRADE_PATH.md "${DIST_DIR}/"

# 5. Create package.json for Dist
cat > "${DIST_DIR}/package.json" <<EOF
{
  "name": "medusa-mesh",
  "version": "${VERSION}",
  "description": "Professional workspace coordination mesh",
  "bin": {
    "medusa": "bin/medusa.js"
  }
}
EOF

# 6. Create Tarball
echo "[*] Packaging into ${TAR_FILE}..."
cd dist
tar -czf "../${TAR_FILE}" "medusa-${VERSION}"
cd ..

echo "🏁 Distribution built successfully: ${TAR_FILE}"
ls -lh "${TAR_FILE}"
