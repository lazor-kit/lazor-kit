const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch the linked SDK source so Metro picks up edits during development.
config.watchFolders = [
  path.resolve(monorepoRoot, 'packages/react-native'),
];

// Resolve modules from the example's node_modules first, then fall back
// to the monorepo root so peer deps installed at the root resolve too.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// Required for Metro to follow the `link:` symlink into packages/react-native.
config.resolver.unstable_enableSymlinks = true;
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
