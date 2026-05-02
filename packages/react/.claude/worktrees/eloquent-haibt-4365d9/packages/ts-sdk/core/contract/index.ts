// Polyfill for structuredClone if not available (for React Native/Expo)
if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = (obj: any) => JSON.parse(JSON.stringify(obj));
}

// ============================================================================
// Main SDK exports
// ============================================================================

// Core clients
export { LazorkitClient } from './client/lazorkit';
export { 
  DefaultPolicyClient,
  BuildInitPolicyIxParams,
  BuildCheckPolicyIxParams,
} from './client/defaultPolicy';

// All types and utilities
export * from './types';
export * from './auth';
export * from './transaction';
export * from './utils';
export * from './messages';
export * from './pda/lazorkit';
export * from './validation';
export * from './constants';
