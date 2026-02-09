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

  const validateAddress = (address: string): boolean => {
    try {
      new PublicKey(address);
      return true;
    } catch {
      return false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!isConnected || !publicKey) {
      setError('Please connect your wallet first');
      return;
    }

    // Reset states
    setError(null);
    setTxSignature(null);

    // Validate inputs
    if (!recipient.trim()) {
      setError('Please enter a recipient address');
      return;
    }

    if (!validateAddress(recipient)) {
      setError('Invalid Solana address');
      return;
    }

    const amountNum = parseFloat(amount);
    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      setError('Please enter a valid amount greater than 0');
      return;
    }

    setLoading(true);

    try {
      // Parse recipient address
      const recipientPubkey = new PublicKey(recipient);
      
      // Convert SOL to lamports
      const lamports = Math.floor(amountNum * LAMPORTS_PER_SOL);
      
      // Build transfer instruction
      const instruction = SystemProgram.transfer({
        fromPubkey: publicKey,
        toPubkey: recipientPubkey,
        lamports: lamports
      });

      console.log('Sending transaction...');
      
      // Send gasless transaction via Paymaster
      const signature = await signAndSendTransaction({
        instructions: [instruction],
        transactionOptions: {
          feeToken: 'USDC' // Pay gas fees with USDC (gasless for user)
        }
      });

      console.log('✅ Transaction successful:', signature);
      setTxSignature(signature);
      
      // Reset form
      setRecipient('');
      setAmount('');
    } catch (err) {
      console.error('Transaction failed:', err);
      
      const errorMessage = err instanceof Error ? err.message : 'Transaction failed';
      
      // User-friendly error messages
      if (errorMessage.includes('insufficient funds')) {
        setError('Insufficient balance to complete this transfer');
      } else if (errorMessage.includes('blockhash not found')) {
        setError('Network error. Please try again');
      } else if (errorMessage.includes('User rejected')) {
        setError('Transaction was cancelled');
      } else {
        setError(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  const cluster = import.meta.env.VITE_CLUSTER || 'devnet';

  return (
    <form onSubmit={handleSubmit} className="payment-form">
      <h2>Send SOL (Gasless)</h2>
      <p className="form-description">
        Send SOL without paying gas fees. The Paymaster covers the transaction cost.
      </p>
      
      <div className="form-group">
        <label htmlFor="recipient">
          Recipient Address
          <span className="required">*</span>
        </label>
        <input
          id="recipient"
          type="text"
          placeholder="Enter Solana address (e.g., 7xK...abc)"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          disabled={loading}
          className={error && !recipient ? 'error' : ''}
        />
      </div>

      <div className="form-group">
        <label htmlFor="amount">
          Amount (SOL)
          <span className="required">*</span>
        </label>
        <input
          id="amount"
          type="number"
          step="0.001"
          min="0"
          placeholder="0.0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={loading}
          className={error && !amount ? 'error' : ''}
        />
        <span className="input-hint">Minimum: 0.001 SOL</span>
      </div>

      <button 
        type="submit" 
        disabled={loading || !isConnected}
        className="btn btn-primary btn-submit"
      >
        {loading ? (
          <>
            <span className="spinner" />
            Sending Transaction...
          </>
        ) : (
          <>
            🚀 Send (No Gas Fee)
          </>
        )}
      </button>

      {error && (
        <div className="error-message">
          <span>⚠️</span>
          <p>{error}</p>
        </div>
      )}
      
      {txSignature && (
        <div className="success-message">
          <div className="success-header">
            <span>✅</span>
            <h3>Transaction Successful!</h3>
          </div>
          <p className="tx-signature">
            <strong>Signature:</strong>
            <br />
            <code>{txSignature.slice(0, 20)}...{txSignature.slice(-20)}</code>
          </p>
          <a 
            href={`https://explorer.solana.com/tx/${txSignature}?cluster=${cluster}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-link"
          >
            View on Solana Explorer →
          </a>
        </div>
      )}

      <div className="form-footer">
        <p className="info-text">
          💡 <strong>Gasless:</strong> You pay 0 SOL in transaction fees. 
          The Paymaster covers the cost for you!
        </p>
      </div>
    </form>
  );
}
