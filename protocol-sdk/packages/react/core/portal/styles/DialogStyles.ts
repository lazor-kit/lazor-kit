/**
 * Styling for dialog UI components
 */

/**
 * CSS style properties
 */
export interface CSSStyles {
    [key: string]: string | number;
}

export interface DialogStyles {
    overlay: CSSStyles;
    panel: CSSStyles;
    closeButton: CSSStyles;
    iframeContainer: CSSStyles;
    iframe: CSSStyles;
}

export const getDialogStyles = (isMobile: boolean): DialogStyles => ({
    overlay: {
        position: 'fixed',
        inset: 0,
        padding: 0,
        border: 'none',
        background: 'transparent',
        width: '100%',
        height: '100%',
        maxWidth: 'none',
        maxHeight: 'none',
        overflow: 'visible',
        zIndex: 2147483647,
        display: 'grid',
        placeItems: isMobile ? 'end center' : 'center',
    },

    panel: {
        width: isMobile ? '100%' : '360px',
        maxWidth: isMobile ? '100%' : '90vw',
        height: isMobile ? '55vh' : '650px',
        maxHeight: isMobile ? '55vh' : '90vh',
        background: 'white',
        borderRadius: isMobile ? '20px 20px 0 0' : '20px',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
        overflow: 'hidden',
        position: 'relative',
    },

    closeButton: { zIndex: 10 },

    iframeContainer: {
        position: 'relative',
        width: '100%',
        height: '100%',
        border: 'none',
        margin: 0,
        padding: 0,
        overflow: 'hidden',
        borderRadius: 'inherit',
        background: 'white',
    },

    iframe: {
        width: '100%',
        height: '100%',
        border: 0,
        borderRadius: 'inherit',
        display: 'block',
    },
});