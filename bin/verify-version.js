#!/usr/bin/env node

/**
 * Medusa Version Verification Script
 * Prevents version tracking disasters by checking consistency across all sources
 */

const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

function verifyVersions() {
  console.log('🔍 Medusa Version Verification...\n');
  
  // Get package.json version
  const packagePath = path.join(__dirname, '../package.json');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const localVersion = packageJson.version;
  
  // Get NPM version
  let npmVersion;
  try {
    npmVersion = execSync('npm view medusa-mcp version', { encoding: 'utf8' }).trim();
  } catch (error) {
    console.log('❌ Could not fetch NPM version:', error.message);
    npmVersion = 'ERROR';
  }
  
  // Check RELEASE_TRACKER.md
  const trackerPath = path.join(__dirname, '../RELEASE_TRACKER.md');
  const trackerContent = fs.readFileSync(trackerPath, 'utf8');
  const trackerVersionMatch = trackerContent.match(/\*\*Current Version:\*\* v([0-9.]+)/);
  const trackerVersion = trackerVersionMatch ? trackerVersionMatch[1] : 'NOT FOUND';
  
  // Display results
  console.log(`📦 package.json:      v${localVersion}`);
  console.log(`🌐 NPM published:     v${npmVersion}`);
  console.log(`📋 RELEASE_TRACKER:   v${trackerVersion}`);
  
  // Check consistency
  const allMatch = localVersion === npmVersion && localVersion === trackerVersion;
  
  if (allMatch) {
    console.log('\n✅ ALL VERSIONS CONSISTENT! Safe to proceed with development.');
  } else {
    console.log('\n🚨 VERSION MISMATCH DETECTED!');
    console.log('❌ Update RELEASE_TRACKER.md and/or publish to NPM before development!');
    process.exit(1);
  }
}

verifyVersions(); 