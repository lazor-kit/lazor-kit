# Tutorial 2: Sending Gasless Transactions

This tutorial covers how to build and send gasless transactions using the Lazorkit Paymaster, allowing users to send SOL without paying gas fees.

## Table of Contents

1. [Understanding Gasless Transactions](#understanding-gasless-transactions)
2. [Building Payment Instructions](#building-payment-instructions)
3. [Sending Transactions](#sending-transactions)
4. [Transaction Confirmation](#transaction-confirmation)
5. [Advanced Options](#advanced-options)

## Understanding Gasless Transactions

### Traditional vs Gasless

**Traditional Solana Transactions:**
```
User sends 1 SOL → Pays 0.000005 SOL gas fee
Net cost: 1.000005 SOL
```

**Gasless with Lazorkit:**
```
User sends 1 SOL → Paymaster pays gas fee
Net cost: 1 SOL
```

### How It Works

1. User builds transaction (send SOL, swap tokens, etc.)
2. Transaction sent to Lazorkit Paymaster
3. Paymaster adds fee payment instruction
4. Paymaster signs and submits to Solana
5. User receives transaction signature

### Benefits

- **Better UX**: Users don't need SOL for gas
- **Onboarding**: New users can receive tokens immediately
- **Flexible Fees**: Pay with USDC or other tokens

## Building Payment Instructions

### Step 1: Create Payment Form Component

```tsx
// src/components/PaymentForm.tsx
import { useState } from 'react';
import { useWallet } from '@lazorkit/wallet';
import { 
  SystemProgram, 
  PublicKey, 
  LAMPORTS_PER_SOL 
} from '@solana/web3.js';

export function PaymentForm() {
  const { signAndSendTransaction, publicKey, isConnected } = useWallet();
  
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!isConnected || !publicKey) {
      setError('Please connect your wallet first');
      return;
    }

    // Validate inputs
    if (!recipient || !amount) {
      setError('Please fill in all fields');
      return;
    }

    setLoading(true);
    setError(null);
    setTxSignature(null);

    try {
      // Parse recipient address
      const recipientPubkey = new PublicKey(recipient);
      
      // Convert SOL to lamports
      const lamports = parseFloat(amount) * LAMPORTS_PER_SOL;
      
      // Build transfer instruction
      const instruction = SystemProgram.transfer({
        fromPubkey: publicKey,
        toPubkey: recipientPubkey,
        lamports: lamports
      });

      // Send gasless transaction
      const signature = await signAndSendTransaction({
        instructions: [instruction],
        transactionOptions: {
          feeToken: 'USDC' // Pay gas with USDC
        }
      });

      setTxSignature(signature);
      setRecipient('');
      setAmount('');
      
      console.log('✅ Transaction sent:', signature);
    } catch (err) {
      console.error('Transaction failed:', err);
      setError(err instanceof Error ? err.message : 'Transaction failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="payment-form">
      <h2>Send SOL (Gasless)</h2>
      
      <div className="form-group">
        <label htmlFor="recipient">Recipient Address</label>
        <input
          id="recipient"
          type="text"
          placeholder="Enter Solana address"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          disabled={loading}
        />
      </div>

      <div className="form-group">
        <label htmlFor="amount">Amount (SOL)</label>
        <input
          id="amount"
          type="number"
          step="0.001"
          min="0"
          placeholder="0.0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={loading}
        />
      </div>

      <button type="submit" disabled={loading || !isConnected}>
        {loading ? 'Sending...' : 'Send (No Gas Fee) 🚀'}
      </button>

      {error && <p className="error">❌ {error}</p>}
      
      {txSignature && (
        <div className="success">
          <p>✅ Transaction successful!</p>
          <a 
            href={`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`}
            target="_blank"
            rel="noopener noreferrer"
          >
            View on Explorer →
          </a>
        </div>
      )}
    </form>
  );
}
```

### Understanding the Code

**Key Components:**

1. **Validation**
   ```tsx
   const recipientPubkey = new PublicKey(recipient);
   ```
   - Validates Solana address format
   - Throws error if invalid

2. **Amount Conversion**
   ```tsx
   const lamports = parseFloat(amount) * LAMPORTS_PER_SOL;
   ```
   - Solana uses lamports (1 SOL = 1,000,000,000 lamports)
   - Always convert user input

3. **Transfer Instruction**
   ```tsx
   SystemProgram.transfer({
     fromPubkey: publicKey,
     toPubkey: recipientPubkey,
     lamports: lamports
   });
   ```
   - Creates basic SOL transfer
   - Can replace with any Solana instruction

## Sending Transactions

### Step 2: Using signAndSendTransaction

```tsx
const signature = await signAndSendTransaction({
  instructions: [instruction],  // Array of instructions
  transactionOptions: {
    feeToken: 'USDC',           // Optional: pay fees with USDC
    computeUnitLimit: 200000,   // Optional: compute budget
    clusterSimulation: 'devnet' // Optional: network for simulation
  }
});
```

### Transaction Options Explained

| Option | Type | Description | Default |
|--------|------|-------------|---------|
| `feeToken` | `string` | Token to pay gas (e.g., 'USDC') | SOL |
| `computeUnitLimit` | `number` | Max compute units | Auto |
| `clusterSimulation` | `'devnet' \| 'mainnet'` | Network for sim | Current network |
| `addressLookupTableAccounts` | `AddressLookupTableAccount[]` | For v0 txs | `[]` |

### Multiple Instructions Example

```tsx
// Send to multiple recipients in one transaction
const signature = await signAndSendTransaction({
  instructions: [
    SystemProgram.transfer({
      fromPubkey: publicKey,
      toPubkey: recipient1,
      lamports: amount1
    }),
    SystemProgram.transfer({
      fromPubkey: publicKey,
      toPubkey: recipient2,
      lamports: amount2
    })
  ],
  transactionOptions: {
    feeToken: 'USDC'
  }
});
```

## Transaction Confirmation

### Step 3: Handling Transaction Status

```tsx
// src/hooks/useTransactionStatus.ts
import { useEffect, useState } from 'react';
import { Connection } from '@solana/web3.js';

export function useTransactionStatus(signature: string | null) {
  const [status, setStatus] = useState<'pending' | 'confirmed' | 'failed'>('pending');

  useEffect(() => {
    if (!signature) return;

    const connection = new Connection(
      import.meta.env.VITE_RPC_URL,
      'confirmed'
    );

    const checkStatus = async () => {
      try {
        const result = await connection.confirmTransaction(signature, 'confirmed');
        
        if (result.value.err) {
          setStatus('failed');
        } else {
          setStatus('confirmed');
        }
      } catch (err) {
        setStatus('failed');
      }
    };

    checkStatus();
  }, [signature]);

  return status;
}
```

### Using the Hook

```tsx
function TransactionMonitor({ signature }: { signature: string }) {
  const status = useTransactionStatus(signature);

  return (
    <div className={`tx-status ${status}`}>
      {status === 'pending' && '⏳ Confirming...'}
      {status === 'confirmed' && '✅ Confirmed!'}
      {status === 'failed' && '❌ Failed'}
    </div>
  );
}
```

## Advanced Options

### Custom Compute Budget

For complex transactions, set compute unit limit:

```tsx
await signAndSendTransaction({
  instructions: [complexInstruction],
  transactionOptions: {
    computeUnitLimit: 400000  // Higher limit for complex operations
  }
});
```

### Priority Fees

Add priority fees for faster confirmation:

```tsx
import { ComputeBudgetProgram } from '@solana/web3.js';

const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
  microLamports: 1000  // Priority fee
});

await signAndSendTransaction({
  instructions: [
    priorityFeeIx,
    transferInstruction
  ]
});
```

### Transaction with Memo

Add a memo to your transaction:

```tsx
const memoInstruction = new TransactionInstruction({
  keys: [],
  programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
  data: Buffer.from('Payment for services', 'utf-8')
});

await signAndSendTransaction({
  instructions: [memoInstruction, transferInstruction]
});
```

## Error Handling

### Common Errors and Solutions

```tsx
try {
  await signAndSendTransaction({ ... });
} catch (err) {
  if (err.message.includes('insufficient funds')) {
    // User doesn't have enough SOL
    alert('Insufficient balance');
  } else if (err.message.includes('Transaction simulation failed')) {
    // Transaction would fail
    alert('Transaction cannot be executed');
  } else if (err.code === 'USER_REJECTED') {
    // User cancelled in wallet
    console.log('User cancelled transaction');
  } else {
    // Generic error
    alert('Transaction failed: ' + err.message);
  }
}
```

### Retry Logic

```tsx
async function sendWithRetry(
  txFn: () => Promise<string>,
  maxRetries = 3
): Promise<string> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await txFn();
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      console.log(`Retry ${i + 1}/${maxRetries}`);
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw new Error('Max retries reached');
}

// Usage
const signature = await sendWithRetry(async () => {
  return await signAndSendTransaction({ ... });
});
```

## Best Practices

### ✅ DO

1. **Validate Inputs**
   ```tsx
   if (!PublicKey.isOnCurve(recipient)) {
     throw new Error('Invalid recipient address');
   }
   ```

2. **Show Transaction Progress**
   - Loading state while sending
   - Confirmation status
   - Success/failure feedback

3. **Handle Network Errors**
   - Implement retry logic
   - Show user-friendly errors
   - Log errors for debugging

4. **Use Devnet for Testing**
   ```tsx
   const cluster = import.meta.env.VITE_CLUSTER || 'devnet';
   ```

### ❌ DON'T

1. **Don't Send Unvalidated Transactions** - Always validate addresses and amounts
2. **Don't Ignore Errors** - Handle all error cases gracefully
3. **Don't Block UI** - Use loading states, don't freeze interface
4. **Don't Skip Testing** - Test all edge cases thoroughly

## Testing Checklist

- [ ] Send small amount successfully
- [ ] Invalid address shows error
- [ ] Insufficient balance handled
- [ ] Transaction appears on explorer
- [ ] Recipient receives correct amount
- [ ] Gas fee is 0 for sender
- [ ] Error states display correctly
- [ ] Loading states work properly

## Production Considerations

### Security

- **Amount Limits**: Implement max transaction amounts
- **Address Whitelist**: For sensitive applications
- **Rate Limiting**: Prevent spam transactions

```tsx
const MAX_AMOUNT = 10 * LAMPORTS_PER_SOL; // 10 SOL max

if (lamports > MAX_AMOUNT) {
  throw new Error('Amount exceeds limit');
}
```

### Monitoring

```tsx
// Log transactions for analytics
await signAndSendTransaction({ ... })
  .then(sig => {
    analytics.track('transaction_success', { signature: sig });
  })
  .catch(err => {
    analytics.track('transaction_failed', { error: err.message });
  });
```

## Next Steps

You now know how to:
- ✅ Build transfer instructions
- ✅ Send gasless transactions
- ✅ Handle confirmations
- ✅ Implement error handling

### Further Learning

- **Token Transfers**: Send SPL tokens instead of SOL
- **NFT Transfers**: Transfer NFTs gaslessly
- **DeFi Integration**: Swap tokens, provide liquidity
- **Program Interactions**: Call custom Solana programs

## Resources

- [Solana Web3.js](https://solana.com/docs/clients/javascript)
- [Lazorkit Docs](https://docs.lazorkit.com)
- [Solana Explorer](https://explorer.solana.com)
- [Solana Cookbook](https://solanacookbook.com)

## Troubleshooting

### "Transaction simulation failed"
- Check instruction parameters
- Verify account has sufficient balance
- Ensure accounts exist on-chain

### "Blockhash not found"
- RPC node might be behind
- Try different RPC endpoint
- Implement retry logic

### "Transaction too large"
- Reduce number of instructions
- Use lookup tables for v0 transactions
- Split into multiple transactions

---

**Previous Tutorial**: [← Creating Passkey-Based Wallets](./TUTORIAL-1.md)

**You've completed both tutorials! 🎉**
