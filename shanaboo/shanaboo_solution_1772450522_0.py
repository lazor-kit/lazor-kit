# Lazorkit Configuration
NEXT_PUBLIC_LAZORKIT_API_KEY=your_lazorkit_api_key_here
NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_NETWORK=devnet
# See https://help.github.com/articles/ignoring-files/ for more about ignoring files.

# dependencies
/node_modules
/.pnp
.pnp.js

# testing
/coverage

# next.js
/.next/
/out/

# production
/build

# misc
.DS_Store
*.pem

# debug
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# local env files
.env*.local
.env

# vercel
.vercel

# typescript
*.tsbuildinfo
next-env.d.ts
# Lazorkit Next.js Passkey & Gasless Example

A complete example demonstrating how to integrate Lazorkit SDK for passkey authentication and gasless transactions in a Next.js application.

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ 
- npm or yarn
- A Lazorkit API key (get one at [docs.lazorkit.com](https://docs.lazorkit.com))

### Installation

1. Clone this example:
