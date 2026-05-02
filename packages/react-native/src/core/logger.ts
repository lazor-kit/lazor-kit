/**
 * LazorKit Wallet Mobile Adapter - Logger
 *
 * Centralized lightweight logger shared by all layers (core, react, etc.).
 * Debug messages are only printed when `setDebugMode(true)` is called, but
 * warnings and errors are always surfaced.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LogArgs = any[];

class Logger {
  private isDebugMode: boolean;

  constructor() {
    // Use environment / global variables to set default debug mode
    // React-Native defines __DEV__ automatically; Node / bundlers may expose process.env
    // Fall back to false if neither flag is set.
    // Using double negation to ensure boolean casting.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const envDebug =
      (typeof process !== 'undefined' && (process as any).env?.LAZORKIT_DEBUG) === 'true';
    this.isDebugMode = envDebug || false;
  }

  getDebugMode() {
    return this.isDebugMode;
  }

  setDebugMode(isDebug: boolean) {
    this.isDebugMode = isDebug;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  log(message: string, ...args: LogArgs) {
    if (this.isDebugMode) {
      // tslint:disable-next-line:no-console
      console.log(`[LazorKit] ${message}`, ...args);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  info(message: string, ...args: LogArgs) {
    if (this.isDebugMode) {
      console.info(`[LazorKit] ${message}`, ...args);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  warn(message: string, ...args: LogArgs) {
    console.warn(`[LazorKit] ${message}`, ...args);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error(message: string, ...args: LogArgs) {
    console.error(`[LazorKit] ${message}`, ...args);
  }
}

export const logger = new Logger();
