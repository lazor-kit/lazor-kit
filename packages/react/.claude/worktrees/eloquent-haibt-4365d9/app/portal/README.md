# Passkey Portal Template

## Overview

This is a simple, minimal passkey authentication portal template for web applications. It handles passkey authentication and signature requests using WebAuthn. The portal runs as either a popup window or iframe and communicates with the parent application using cross-origin message passing.

## Key Features

- **WebAuthn Passkey Integration**: Secure authentication and signing using WebAuthn passkeys
- **Cross-Origin Communication**: Robust message passing between different origins
- **Request Handling**: Processing of connect and sign requests from the parent application
- **Event-Based Architecture**: Custom events for UI components to react to application messages
- **Minimal Design**: Simple, clean UI with no external dependencies

## Project Structure

```
/src
  /components      # React UI components
  /core            # Core functionality
    /messenger     # Cross-origin message handling
    /passkey       # WebAuthn passkey integration
    /security      # Security utilities
    /utils         # Helper utilities
  /hooks           # React hooks
  /routes          # Application routes
  /types           # TypeScript type definitions
```

## Development Setup

### Prerequisites
- npm or yarn

### Installation

```bash
# Install dependencies
npm install

# Start the development server
npm run dev
```

### Cross-Origin Communication

The portal uses a wildcard origin ('*') approach for `postMessage` calls to ensure reliable communication between different origins. This is critical when the portal runs on a different port or domain than the parent application.

The `MessageHandler` class handles:
- Detecting the window context (popup vs iframe)
- Processing incoming messages from the parent window
- Sending responses back to the parent window
- Managing passkey request lifecycle

### Customization

This template is designed to be easy to customize:

1. Update branding in `Layout.tsx` and `style.css`
2. Modify message handling in `MessageHandler.ts` to match your application's protocol
3. Extend the passkey functionality in the core modules as needed
4. Add additional routes or components as required
- Using the appropriate message target (window.opener or window.parent)
- Managing message events and responses

## Building for Production

```bash
# Build for production
npm run build

# Preview production build
npm run preview
```

## Integration with Lazor Kit SDK

This portal is designed to work seamlessly with the Lazor Kit SDK. The SDK initiates connection and signing requests, which the portal processes and returns responses to.

The communication flow works as follows:

1. SDK opens the portal as a popup or iframe
2. Portal sends READY message to parent
3. Parent sends requests (connect, sign) to portal
4. Portal processes requests using WebAuthn
5. Portal sends responses back to parent

