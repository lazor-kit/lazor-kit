import { createDialog } from './Dialog';
import { DialogInstance, DialogConfig } from '../../types';
import { Logger } from '../../utils/logger';

export class DialogManager {
  private dialogs = new Map<string, DialogInstance>();
  private activeDialog: string | null = null;
  private config: DialogConfig;
  private logger = new Logger('DialogManager');

  constructor(config: any) {
    this.config = {
      url: config.dialogUrl,
      mode: config.dialogMode || 'auto',
      fallbackToPopup: true
    };
  }

  /**
   * Get or create a dialog instance
   */
  getOrCreate(name: string): DialogInstance {
    if (!this.dialogs.has(name)) {
      this.create(name);
    }
    return this.dialogs.get(name)!;
  }

  /**
   * Create a new dialog instance
   */
  private create(name: string): DialogInstance {
    const dialog = createDialog(this.config);
    
    // Debug logging
    this.logger.debug('Dialog config:', {
      url: this.config.url,
      expectedOrigin: new URL(this.config.url).origin
    });
    
    const instance = dialog.setup({
      url: this.config.url,
      origin: new URL(this.config.url).origin,
      onMessage: (msg) => this.handleMessage(name, msg),
      onClose: () => this.handleClose(name),
      onError: (error) => this.handleError(name, error)
    });
    
    this.dialogs.set(name, instance);
    this.logger.debug(`Created dialog: ${name}`);
    
    return instance;
  }

  /**
   * Open a dialog
   */
  open(name: string): void {
    const dialog = this.getOrCreate(name);
    
    // Close other dialogs
    if (this.activeDialog && this.activeDialog !== name) {
      const activeDialog = this.dialogs.get(this.activeDialog);
      if (activeDialog?.isOpen()) {
        activeDialog.close();
      }
    }
    
    dialog.open();
    this.activeDialog = name;
    this.logger.debug(`Opened dialog: ${name}`);
  }

  /**
   * Close a dialog
   */
  close(name: string): void {
    const dialog = this.dialogs.get(name);
    if (dialog?.isOpen()) {
      dialog.close();
      this.logger.debug(`Closed dialog: ${name}`);
    }
    
    if (this.activeDialog === name) {
      this.activeDialog = null;
    }
  }

  /**
   * Destroy a dialog
   */
  destroy(name: string): void {
    const dialog = this.dialogs.get(name);
    if (dialog) {
      dialog.destroy();
      this.dialogs.delete(name);
      this.logger.debug(`Destroyed dialog: ${name}`);
    }
    
    if (this.activeDialog === name) {
      this.activeDialog = null;
    }
  }

  /**
   * Destroy all dialogs
   */
  destroyAll(): void {
    for (const [name, dialog] of this.dialogs) {
      dialog.destroy();
    }
    this.dialogs.clear();
    this.activeDialog = null;
    this.logger.debug('Destroyed all dialogs');
  }

  /**
   * Get active dialog
   */
  getActiveDialog(): DialogInstance | null {
    if (!this.activeDialog) return null;
    return this.dialogs.get(this.activeDialog) || null;
  }

  private handleMessage(name: string, message: any): void {
    this.logger.debug(`Dialog ${name} message:`, message);
  }

  private handleClose(name: string): void {
    this.logger.debug(`Dialog ${name} closed`);
    if (this.activeDialog === name) {
      this.activeDialog = null;
    }
  }

  private handleError(name: string, error: Error): void {
    this.logger.error(`Dialog ${name} error:`, error);
  }
}