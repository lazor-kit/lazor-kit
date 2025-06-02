// src/utils/logger.ts
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export class Logger {
  private context: string;
  private enabled: boolean;

  constructor(context: string) {
    this.context = context;
    this.enabled = process.env.NODE_ENV !== 'production';
  }

  debug(message: string, data?: any): void {
    if (!this.enabled) return;
    console.debug(`[${this.context}] ${message}`, data);
  }

  info(message: string, data?: any): void {
    console.info(`[${this.context}] ${message}`, data);
  }

  warn(message: string, data?: any): void {
    console.warn(`[${this.context}] ${message}`, data);
  }

  error(message: string, error?: any): void {
    console.error(`[${this.context}] ${message}`, error);
  }
}