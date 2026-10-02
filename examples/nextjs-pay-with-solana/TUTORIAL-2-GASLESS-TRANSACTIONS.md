# Tutorial 2: Gasless USDC Transfer on Solana

Learn how to send transactions without paying gas fees using Lazorkit's Paymaster.

## What is Gasless?

Normally, Solana transactions require SOL for gas fees. With Lazorkit's Paymaster:
- Users don't need SOL
- Transaction fees are sponsored
- Works with any SPL token

## Prerequisites

- Completed Tutorial 1 (Passkey Wallet)
- Lazorkit SDK connected
- Devnet SOL (get from faucet)

## Step 1: Prepare the Transaction

```tsx
import { SystemProgram, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { useWallet } from '@lazorkit/wallet';

function TransferComponent() {
  const { signAndSendTransaction, smartWalletPubkey } = useWallet();

  const sendSOL = async (recipient: string, amount: number) => {
    const signature = await signAndSendTransaction({
      instructions: [
        SystemProgram.transfer({
          fromPubkey: smartWalletPubkey!,
          toPubkey: new PublicKey(recipient),
          lamports: LAMPORTS_PER_SOL * amount,
        }),
      ],
      transactionOptions: {
        feeToken: 'USDC', // Paymaster sponsors this
      },
    });

    return signature;
  };

  // Usage
  const handleClick = async () => {
    const sig = await sendSOL(
      '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
      0.1
    );
    console.log('Sent! Signature:', sig);
  };

  return <button onClick={handleClick}>Send 0.1 SOL</button>;
}
```

## Step 2: Understanding the Paymaster

The Paymaster is a smart contract that:
1. Receives your transaction
2. Validates it's eligible for sponsorship
3. Pays the gas fee
4. Executes your transaction

## Step 3: Transaction Options

Customize your transaction:

```tsx
await signAndSendTransaction({
  instructions: [...],
  transactionOptions: {
    feeToken: 'USDC',           // Token for gas payment
    computeUnitLimit: 300000,   // Increase if transaction is complex
    clusterSimulation: 'devnet' // Simulate before sending
  },
});
```

## Step 4: Error Handling

```tsx
try {
  const signature = await signAndSendTransaction({...});
  console.log('Success:', signature);
} catch (error) {
  if (error.message.includes('insufficient funds')) {
    alert('Not enough balance');
  } else if (error.message.includes('invalid address')) {
    alert('Check recipient address');
  } else {
    console.error('Transaction failed:', error);
  }
}
```

## Step 5: Verify on Explorer

After sending, view the transaction:

```tsx
const signature = await signAndSendTransaction({...});

// Open in Solana Explorer
window.open(
  `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
  '_blank'
);
```

## Complete Example

```tsx
export function GaslessTransfer() {
  const { isConnected, signAndSendTransaction, smartWalletPubkey } = useWallet();
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState('');

  const handleTransfer = async () => {
    setStatus('Sending...');
    
    try {
      const sig = await signAndSendTransaction({
        instructions: [
          SystemProgram.transfer({
            fromPubkey: smartWalletPubkey!,
            toPubkey: new PublicKey(recipient),
            lamports: LAMPORTS_PER_SOL * parseFloat(amount),
          }),
        ],
        transactionOptions: { feeToken: 'USDC' },
      });

      setStatus(`Sent! TX: ${sig.slice(0, 20)}...`);
    } catch (error: any) {
      setStatus(`Error: ${error.message}`);
    }
  };

  return (
    <div>
      <input
        placeholder="Recipient"
        value={recipient}
        onChange={(e) => setRecipient(e.target.value)}
      />
      <input
        placeholder="Amount (SOL)"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <button onClick={handleTransfer} disabled={!isConnected}>
        Send Gasless Transaction
      </button>
      <p>{status}</p>
    </div>
  );
}
```

## Testing

1. Connect your wallet
2. Enter a recipient address
3. Enter amount (e.g., 0.001)
4. Click "Send"
5. Authenticate with biometrics
6. Transaction sent without SOL for gas!

## How It Works

```
User Action → Smart Wallet → Paymaster → Solana Network
     ↓              ↓            ↓            ↓
  Biometric    Validates    Pays Gas    Transaction
   Auth         Request      Fee         Confirmed
```

## Next Steps

- Try different token types
- Implement batch transactions
- Add transaction history
- [Back to README](./README.md)
