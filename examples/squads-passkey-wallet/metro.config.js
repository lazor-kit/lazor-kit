// Disable Watchman to prevent "too many open files" errors
// Metro will automatically fall back to node crawler
process.env.WATCHMAN_DISABLE = '1';

// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

const projectRoot = __dirname;

// Force single React instance to prevent hooks errors
config.resolver = {
  ...config.resolver,
  sourceExts: [...(config.resolver?.sourceExts || []), 'jsx', 'js', 'ts', 'tsx', 'json'],
  // Force all React imports to use the root React instance
  extraNodeModules: {
    ...config.resolver?.extraNodeModules,
    'react': path.resolve(projectRoot, 'node_modules/react'),
    'react-native': path.resolve(projectRoot, 'node_modules/react-native'),
    'react-dom': path.resolve(projectRoot, 'node_modules/react-dom'),
  },
};

// Watch folders configuration - limit to project root only
config.watchFolders = [__dirname];

module.exports = config;

