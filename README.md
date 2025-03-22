# @lazor-kit/react-sdk

Onchain Passkey Solution on Solana 

## Features

- 🔐 Passkey-based wallet connection
- 🌐 IPFS hub integration
- 💳 Smart wallet creation and management
- 📝 Message signing
- 🔑 Authenticator management
- 📱 React hooks for easy integration
- 📦 TypeScript support

## Installation

```bash
npm install @lazor-kit/react-sdk
# or
yarn add @lazor-kit/react-sdk
```

## Usage

### Basic Usage

```typescript
import { useLazorKit } from '@lazor-kit/react-sdk';

function App() {
  const { 
    connect, 
    sign, 
    disconnect, 
    walletState, 
    isLoading, 
    error,
    createSmartWallet,
    executeTransaction,
    addAuthenticator 
  } = useLazorKit({
    ipfsHubUrl: 'IPFS_LINK',
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    popupConfig: {
      width: 600,
      height: 400,
      title: 'WalletAction'
    },
    timeout: 60000
  });

  const handleConnect = async () => {
    try {
      const connectionData = await connect();
      console.log('Connected:', connectionData);
    } catch (err) {
      console.error('Connection failed:', err);
    }
  };

  const handleSign = async () => {
    try {
      const signatureData = await sign('Hello, World!');
      console.log('Signature:', signatureData);
    } catch (err) {
      console.error('Signing failed:', err);
    }
  };

  const handleCreateSmartWallet = async () => {
    try {
      const transaction = await createSmartWallet({
        secp256r1PubkeyBytes: [], // Your pubkey bytes
        payer: new PublicKey('your_payer_address')
      });
      console.log('Smart wallet transaction:', transaction);
    } catch (err) {
      console.error('Smart wallet creation failed:', err);
    }
  };

  return (
    <div>
      {!walletState.isConnected ? (
        <button onClick={handleConnect} disabled={isLoading}>
          Connect Wallet
        </button>
      ) : (
        <>
          <p>Connected as: {walletState.publicKey}</p>
          <button onClick={handleSign} disabled={isLoading}>
            Sign Message
          </button>
          <button onClick={handleCreateSmartWallet} disabled={isLoading}>
            Create Smart Wallet
          </button>
          <button onClick={disconnect}>Disconnect</button>
        </>
      )}
      {error && <p style={{ color: 'red' }}>{error.message}</p>}
    </div>
  );
}
```

### Advanced Usage

#### Creating a Smart Wallet

```typescript
const handleCreateSmartWallet = async () => {
  try {
    const transaction = await createSmartWallet({
      secp256r1PubkeyBytes: [], // Your pubkey bytes
      payer: new PublicKey('your_payer_address')
    });
    
    // Send the transaction
    const signature = await connection.sendTransaction(transaction);
    console.log('Smart wallet created:', signature);
  } catch (err) {
    console.error('Failed to create smart wallet:', err);
  }
};
```

#### Executing a Transaction

```typescript
const handleExecuteTransaction = async () => {
  try {
    const transaction = await executeTransaction({
      arbitraryInstruction: yourInstruction,
      pubkey: Buffer.from([]), // Your pubkey
      signature: Buffer.from([]), // Your signature
      message: {
        nonce: 1,
        timestamp: new anchor.BN(Date.now()),
        payload: Buffer.from([])
      },
      payer: new PublicKey('your_payer_address'),
      smartWalletPubkey: new PublicKey('your_smart_wallet_address'),
      smartWalletAuthority: new PublicKey('your_smart_wallet_authority')
    });
    
    // Send the transaction
    const signature = await connection.sendTransaction(transaction);
    console.log('Transaction executed:', signature);
  } catch (err) {
    console.error('Failed to execute transaction:', err);
  }
};
```

#### Adding an Authenticator

```typescript
const handleAddAuthenticator = async () => {
  try {
    const transaction = await addAuthenticator({
      pubkey: Buffer.from([]), // Your pubkey
      signature: Buffer.from([]), // Your signature
      message: {
        nonce: 1,
        timestamp: new anchor.BN(Date.now()),
        payload: Buffer.from([])
      },
      payer: new PublicKey('your_payer_address'),
      smartWalletPubkey: new PublicKey('your_smart_wallet_address'),
      smartWalletAuthority: new PublicKey('your_smart_wallet_authority')
    });
    
    // Send the transaction
    const signature = await connection.sendTransaction(transaction);
    console.log('Authenticator added:', signature);
  } catch (err) {
    console.error('Failed to add authenticator:', err);
  }
};
```

## API Reference

### LazorKitConfig

```typescript
interface LazorKitConfig {
  ipfsHubUrl: string;
  popupConfig?: {
    width?: number;
    height?: number;
    title?: string;
  };
  timeout?: number;
  rpcUrl?: string;
}
```

### UseLazorKitReturn

```typescript
interface UseLazorKitReturn {
  connect: () => Promise<WalletConnectionData>;
  sign: (message: string) => Promise<SignatureData>;
  disconnect: () => void;
  walletState: WalletState;
  isLoading: boolean;
  error: Error | null;
  createSmartWallet: (params: CreateSmartWalletParams) => Promise<Transaction>;
  executeTransaction: (params: ExecuteTransactionParams) => Promise<VersionedTransaction>;
  addAuthenticator: (params: AddAuthenticatorParams) => Promise<VersionedTransaction>;
}
```

## License

MIT
