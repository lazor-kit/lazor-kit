#!/usr/bin/env node

/**
 * Pre-publish checklist for @lazorkit/wallet-mobile-adapter
 * 
 * This script runs various checks to ensure the package is ready for publication:
 * - Build verification
 * - Type checking
 * - Security audit
 * - File size checks
 * - Documentation verification
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function check(description, testFn) {
  try {
    const result = testFn();
    log(`✅ ${description}`, colors.green);
    return { success: true, result };
  } catch (error) {
    log(`❌ ${description}: ${error.message}`, colors.red);
    return { success: false, error };
  }
}

function runCommand(command, description) {
  return check(description, () => {
    execSync(command, { stdio: 'pipe' });
  });
}

function checkFileExists(filePath, description) {
  return check(description, () => {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
  });
}

function checkFileSize(filePath, maxSizeKB, description) {
  return check(description, () => {
    const stats = fs.statSync(filePath);
    const sizeKB = stats.size / 1024;
    if (sizeKB > maxSizeKB) {
      throw new Error(`File too large: ${sizeKB.toFixed(2)}KB (max: ${maxSizeKB}KB)`);
    }
  });
}

function checkPackageJson() {
  return check('Package.json validation', () => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

    const requiredFields = [
      'name', 'version', 'main', 'module', 'types', 'files',
      'author', 'license', 'description', 'repository'
    ];

    for (const field of requiredFields) {
      if (!pkg[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    if (!pkg.name.startsWith('@lazorkit/')) {
      throw new Error('Package name must start with @lazorkit/');
    }

    if (pkg.license !== 'MIT') {
      throw new Error('License must be MIT');
    }
  });
}

function checkSecurity() {
  // Project uses yarn (yarn.lock, no package-lock.json). `yarn audit` exits with
  // a bitmask: 1=info, 2=low, 4=moderate, 8=high, 16=critical. Treat moderate+
  // (>=4) as failure to match the original `npm audit --audit-level=moderate`.
  const lockfile = fs.existsSync('yarn.lock') ? 'yarn' : 'npm';
  return check('Security audit (production deps only)', () => {
    if (lockfile === 'yarn') {
      try {
        execSync('yarn audit --groups dependencies --level moderate', { stdio: 'pipe' });
      } catch (err) {
        const code = err.status ?? 0;
        if (code >= 4) {
          throw new Error(`yarn audit reported moderate+ issues (exit ${code})`);
        }
      }
    } else {
      execSync('npm audit --audit-level=moderate --omit=dev', { stdio: 'pipe' });
    }
  });
}

function checkBuild() {
  return runCommand('npm run build', 'Build verification');
}

function checkTypes() {
  return runCommand('npx tsc --noEmit --skipLibCheck', 'Type checking');
}

function checkDistFiles() {
  const distFiles = [
    'dist/index.js',
    'dist/index.esm.js',
    'dist/index.d.ts'
  ];

  const results = [];
  for (const file of distFiles) {
    results.push(checkFileExists(file, `Dist file exists: ${file}`));
  }

  // Check file sizes
  results.push(checkFileSize('dist/index.js', 500, 'Main bundle size check'));
  results.push(checkFileSize('dist/index.esm.js', 500, 'ESM bundle size check'));
  results.push(checkFileSize('dist/index.d.ts', 200, 'Types file size check'));

  return results;
}

function checkDocumentation() {
  const docs = [
    'README.md',
    'SECURITY.md'
  ];

  const results = [];
  for (const doc of docs) {
    results.push(checkFileExists(doc, `Documentation exists: ${doc}`));
  }

  return results;
}

function checkExports() {
  return check('Export verification', () => {
    const distIndex = fs.readFileSync('dist/index.d.ts', 'utf8');

    const requiredExports = [
      'LazorKitProvider',
      'useWallet',
      'useWalletStore',
      'WalletInfo',
      'ConnectOptions',
      'SignOptions',
      'LazorKitError'
    ];

    for (const exportName of requiredExports) {
      if (!distIndex.includes(exportName)) {
        throw new Error(`Missing export: ${exportName}`);
      }
    }
  });
}

function main() {
  log('🚀 Starting pre-publish checks...', colors.bold + colors.blue);

  const checks = [
    checkPackageJson(),
    checkSecurity(),
    checkBuild(),
    checkTypes(),
    ...checkDistFiles(),
    ...checkDocumentation(),
    checkExports()
  ];

  const failed = checks.filter(check => !check.success);

  if (failed.length > 0) {
    log('\n❌ Pre-publish checks failed!', colors.bold + colors.red);
    log('Please fix the issues above before publishing.', colors.red);
    process.exit(1);
  } else {
    log('\n✅ All pre-publish checks passed!', colors.bold + colors.green);
    log('Package is ready for publication.', colors.green);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main, check, runCommand }; 