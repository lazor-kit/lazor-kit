'use strict';
/**
 * Native-module stubs for running @lazorkit/wallet-mobile-adapter's real dist
 * in Node. Only the modules the dist loads
 * that cannot run in Node are replaced: react-native, expo-web-browser,
 * expo-crypto, @react-native-async-storage/async-storage and
 * react-native-get-random-values. The adapter, @lazorkit/sdk-legacy,
 * @solana/web3.js, zustand and react are the real code.
 */
const Module = require('module');
const { EventEmitter } = require('events');

const state = {
  os: 'ios',
  colorScheme: 'light',
  appState: 'active',
  /** The scripted system browser: { ios(url, redirectUrl), android(url) }. */
  browser: null,
  dismissCalls: 0,
};

const linking = new EventEmitter();
const appStateEmitter = new EventEmitter();
linking.setMaxListeners(50);
appStateEmitter.setMaxListeners(50);

const reactNative = {
  Platform: {
    get OS() {
      return state.os;
    },
    select(obj) {
      return state.os in obj ? obj[state.os] : obj.default;
    },
  },
  Linking: {
    addEventListener(type, fn) {
      linking.on(type, fn);
      return { remove: () => linking.off(type, fn) };
    },
    openURL: async () => {},
  },
  AppState: {
    get currentState() {
      return state.appState;
    },
    addEventListener(type, fn) {
      appStateEmitter.on(type, fn);
      return { remove: () => appStateEmitter.off(type, fn) };
    },
  },
  Modal: 'Modal',
  View: 'View',
  Text: 'Text',
  ScrollView: 'ScrollView',
  Pressable: 'Pressable',
  StyleSheet: { create: (s) => s },
  useColorScheme: () => state.colorScheme,
};

const expoWebBrowser = {
  async openAuthSessionAsync(url, redirectUrl) {
    if (!state.browser) throw new Error('no browser driver installed');
    return state.browser.ios(url, redirectUrl);
  },
  async openBrowserAsync(url) {
    if (!state.browser) throw new Error('no browser driver installed');
    return state.browser.android(url);
  },
  dismissBrowser() {
    state.dismissCalls += 1;
  },
};

const storageMap = new Map();
const asyncStorage = {
  getItem: async (k) => (storageMap.has(k) ? storageMap.get(k) : null),
  setItem: async (k, v) => {
    storageMap.set(k, v);
  },
  removeItem: async (k) => {
    storageMap.delete(k);
  },
};

const STUBS = {
  'react-native': reactNative,
  'expo-web-browser': expoWebBrowser,
  'expo-crypto': {},
  '@react-native-async-storage/async-storage': { __esModule: true, default: asyncStorage },
  'react-native-get-random-values': {},
};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  return origLoad.apply(this, arguments);
};

module.exports = { state, linking, appStateEmitter, storageMap };
