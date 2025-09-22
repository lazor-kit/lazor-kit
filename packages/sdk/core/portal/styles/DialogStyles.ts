/**
 * Styling for dialog UI components
 */

/**
 * CSS style properties
 */
export interface CSSStyles {
    [key: string]: string | number;
  }
  
  /**
   * Dialog component style structure
   */
  export interface DialogStyles {
    container: CSSStyles;
    closeButton: CSSStyles;
    iframeContainer: CSSStyles;
    iframe: CSSStyles;
  }
  
  /**
   * Dimensions for different device types
   */
  export const DIALOG_DIMENSIONS = {
    mobile: {
      width: '100%',
      maxWidth: '100%',
      height: '50vh',
      maxHeight: '50vh',
      padding: '0',
      borderRadius: '20px 20px 0 0'
    },
    desktop: {
      width: '420px',
      maxWidth: '90vw',
      height: '600px',
      maxHeight: '85vh',
      padding: '0',
      borderRadius: '20px'
    }
  };
  
  /**
   * Generate dialog styles based on device type
   */
  export const getDialogStyles = (isMobile: boolean): DialogStyles => ({
    container: {
      position: 'fixed',
      top: isMobile ? 'auto' : '50%',
      left: isMobile ? 0 : '50%',
      right: isMobile ? 0 : 'auto',
      bottom: isMobile ? 0 : 'auto',
      transform: isMobile ? 'none' : 'translate(-50%, -50%)',
      display: 'flex',
      flexDirection: 'column',
      background: 'white',
      border: 'none',
      margin: isMobile ? 0 : 'auto',
      width: DIALOG_DIMENSIONS[isMobile ? 'mobile' : 'desktop'].width,
      maxWidth: DIALOG_DIMENSIONS[isMobile ? 'mobile' : 'desktop'].maxWidth,
      height: DIALOG_DIMENSIONS[isMobile ? 'mobile' : 'desktop'].height,
      maxHeight: DIALOG_DIMENSIONS[isMobile ? 'mobile' : 'desktop'].maxHeight,
      borderRadius: DIALOG_DIMENSIONS[isMobile ? 'mobile' : 'desktop'].borderRadius,
      padding: DIALOG_DIMENSIONS[isMobile ? 'mobile' : 'desktop'].padding,
      overflow: 'hidden',
      boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
      zIndex: 2147483647,
      willChange: 'transform',
      webkitBackfaceVisibility: 'hidden',
      backfaceVisibility: 'hidden',
      webkitOverflowScrolling: 'touch',
      overscrollBehavior: 'contain'
    },
  
    closeButton: {
      zIndex: 2147483648,
      position: 'absolute',
      top: '12px',
      right: '12px',
      background: 'transparent',
      border: 'none',
      borderRadius: '50%',
      width: '24px',
      height: '32px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      color: '#666',
      willChange: 'transform, opacity'
    },
    iframeContainer: {
      position: 'relative',
      width: '100%',
      height: '100%',
      border: 'none',
      padding: '0',
      margin: '0',
      overflow: 'hidden',
      borderRadius: 'inherit',
      background: 'white',
      display: 'flex',
      flexDirection: 'column',
      willChange: 'transform',
      webkitBackfaceVisibility: 'hidden',
      backfaceVisibility: 'hidden',
      webkitOverflowScrolling: 'touch',
      overscrollBehavior: 'contain'
    },
    iframe: {
      border: 'none',
      height: '100%',
      width: '100%',
      borderRadius: 'inherit',
      display: 'block',
      pointerEvents: 'auto',
      overflow: 'hidden',
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      margin: 0,
      padding: 0
    }
  });