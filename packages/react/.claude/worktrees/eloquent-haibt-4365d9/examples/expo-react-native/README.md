# LazorExpo

A modern React Native application built with Expo, featuring wallet integration and secure authentication flows.

## Features

- 🔐 Secure wallet integration
- 🌐 WebView-based authentication
- 📱 Cross-platform support (iOS & Android)
- 🎯 Modern UI/UX design
- 🔄 Efficient state management
- 🛡️ Secure message signing

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- Expo CLI
- iOS Simulator (for Mac users) or Android Studio (for Android development)

## Installation

1. Clone the repository:
   ```bash
   git clone [your-repository-url]
   cd LazorExpo
   ```

2. Install dependencies:
   ```bash
   npm install
   # or
   yarn install
   ```

3. Start the development server:
   ```bash
   npx expo start
   ```

## Project Structure

```
LazorExpo/
├── app/                    # Main application code
│   ├── _layout.tsx        # Root layout configuration
│   ├── index.tsx          # Entry point
│   └── (tabs)/            # Tab-based navigation
├── sdk/                   # SDK and utilities
│   ├── components/        # Reusable components
│   ├── store/            # State management
│   └── types/            # TypeScript type definitions
└── assets/               # Static assets
```

## Development

The project uses Expo's file-based routing system. Key files and directories:

- `app/_layout.tsx`: Root layout configuration
- `app/index.tsx`: Main entry point and authentication flow
- `app/(tabs)/`: Tab-based navigation structure

## Authentication Flow

The application implements a secure authentication flow using WebView for wallet integration:

1. User initiates wallet connection
2. WebView modal handles authentication
3. Secure message signing
4. Session management and caching

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For support, please open an issue in the GitHub repository or contact the development team.
