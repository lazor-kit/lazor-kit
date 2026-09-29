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

/** The pnpm workspace root above this package, or null. */
function findPnpmWorkspaceRoot() {
  let dir = process.cwd();
  while (true) {
    if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const AUDIT_FAIL_LEVELS = new Set(['moderate', 'high', 'critical']);

/**
 * `pnpm audit` covers the whole workspace lockfile, so keep only the findings
 * whose path starts at this package's importer. A finding in one of this
 * package's own dependencies fails the check: raising our range fixes it. One
 * deeper down — mostly Expo and React Native build tooling — is reported but
 * does not fail it: the app's lockfile picks those versions, not ours, and
 * none of it is bundled into dist.
 */
function pnpmAudit(workspaceRoot) {
  const importer = path.relative(workspaceRoot, process.cwd()).split(path.sep).join('__');
  let raw;
  try {
    raw = execSync('pnpm audit --prod --json', { cwd: workspaceRoot, stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    // pnpm audit exits non-zero whenever it finds anything; the JSON is still on stdout.
    raw = err.stdout;
  }
  let report;
  try {
    report = JSON.parse(String(raw));
  } catch {
    throw new Error('pnpm audit did not return a report (is the registry reachable?)');
  }

  const direct = new Map();
  const transitive = new Map();
  for (const advisory of Object.values(report.advisories || {})) {
    for (const finding of advisory.findings || []) {
      for (const p of finding.paths || []) {
        const parts = p.split('>');
        if (parts[0] !== importer) continue;
        const bucket = parts.length === 2 ? direct : transitive;
        bucket.set(`${advisory.module_name}:${advisory.id}`, advisory);
      }
    }
  }

  const describe = (advisories) =>
    [...advisories.values()].map((a) => `${a.severity} ${a.module_name} (${a.url})`).join('\n    ');

  if (transitive.size > 0) {
    const bySeverity = {};
    for (const a of transitive.values()) bySeverity[a.severity] = (bySeverity[a.severity] || 0) + 1;
    log(`⚠️  ${transitive.size} advisories in transitive production dependencies ` +
      `(${JSON.stringify(bySeverity)}); not ours to pin, not bundled into dist`, colors.yellow);
  }
  const blocking = [...direct.values()].filter((a) => AUDIT_FAIL_LEVELS.has(a.severity));
  if (blocking.length > 0) {
    throw new Error(`moderate+ advisories in direct dependencies:\n    ${describe(new Map(blocking.map((a) => [a.id, a])))}`);
  }
}

function checkSecurity() {
  // The package lives in a pnpm workspace; outside one, fall back to yarn or
  // npm. `yarn audit` exits with a bitmask: 1=info, 2=low, 4=moderate, 8=high,
  // 16=critical, so moderate+ is >=4, matching `npm audit --audit-level=moderate`.
  const workspaceRoot = findPnpmWorkspaceRoot();
  const lockfile = workspaceRoot ? 'pnpm' : fs.existsSync('yarn.lock') ? 'yarn' : 'npm';
  return check('Security audit (production deps only)', () => {
    if (lockfile === 'pnpm') {
      pnpmAudit(workspaceRoot);
    } else if (lockfile === 'yarn') {
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