// Polyfill for structuredClone if not available (for React Native/Expo)
if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = (obj: any) => JSON.parse(JSON.stringify(obj));
}

// ============================================================================
// Main SDK exports
// ============================================================================

// Client classes
export { LazorkitClient } from './client/lazorkit';
export { DefaultPolicyClient } from './client/defaultPolicy';

// Type definitions
export * from './types';

// Utility functions
export * from './auth';
export * from './transaction';
export * from './utils';
export * from './messages';

// PDA derivation functions (includes constants)
export * from './pda/lazorkit';
