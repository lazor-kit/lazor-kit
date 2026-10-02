'use client';

import { useWallet } from '@lazorkit/wallet';
import { SystemProgram, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { Send, Loader2, CheckCircle } from 'lucide-react';
import { useState } from 'react';

export function PayWidget() {
  const { isConnected, connect, signAndSendTransaction, smartWalletPubkey } = useWallet();
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setTxSignature(null);

    if (!isConnected) {
      try {
        await connect();
      } catch (err) {
        setError('Please connect your wallet first');
        return;
      }
    }

    if (!recipient || !amount) {
      setError('Please fill in all fields');
      return;
    }

    // Validate recipient address
    try {
      new PublicKey(recipient);
    } catch {
      setError('Invalid recipient address');
      return;
    }

    // Validate amount
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setError('Invalid amount');
      return;
    }

    setIsLoading(true);

    try {
      const signature = await signAndSendTransaction({
        instructions: [
          SystemProgram.transfer({
            fromPubkey: smartWalletPubkey!,
            toPubkey: new PublicKey(recipient),
            lamports: LAMPORTS_PER_SOL * parsedAmount,
          }),
        ],
        transactionOptions: {
          feeToken: 'USDC', // Use USDC for gas fees
        },
      });

      setTxSignature(signature);
      setRecipient('');
      setAmount('');
    } catch (err: any) {
      console.error('Transaction failed:', err);
      setError(err.message || 'Transaction failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Recipient Input */}
        <div>
          <label className="block text-white/80 text-sm mb-2">
            Recipient Address
          </label>
          <input
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="Enter Solana address (e.g., 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU)"
            className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:border-white/40 focus:ring-2 focus:ring-white/20 transition-all"
            disabled={isLoading}
          />
        </div>

        {/* Amount Input */}
        <div>
          <label className="block text-white/80 text-sm mb-2">
            Amount (SOL)
          </label>
          <div className="relative">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              step="0.001"
              min="0.001"
              className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:border-white/40 focus:ring-2 focus:ring-white/20 transition-all"
              disabled={isLoading}
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-white/60 font-medium">
              SOL
            </span>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
            <p className="text-red-300 text-sm">{error}</p>
          </div>
        )}

        {/* Success Message */}
        {txSignature && (
          <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-xl">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="w-5 h-5 text-green-400" />
              <p className="text-green-300 font-medium">Transaction Successful!</p>
            </div>
            <a
              href={`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-green-300 text-sm underline hover:text-green-200 break-all"
            >
              View on Explorer: {txSignature.slice(0, 20)}...{txSignature.slice(-20)}
            </a>
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-3 px-6 bg-gradient-to-r from-solana-green to-solana-blue text-white font-semibold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Sending...
            </>
          ) : (
            <>
              <Send className="w-5 h-5" />
              {isConnected ? 'Send Payment' : 'Connect & Send'}
            </>
          )}
        </button>
      </form>

      {/* Gasless Info */}
      <div className="p-4 bg-purple-500/10 border border-purple-500/20 rounded-xl">
        <p className="text-purple-300 text-sm">
          <strong>⛽ Gasless:</strong> This transaction is sponsored by Lazorkit Paymaster.
          You don&apos;t need SOL for gas fees!
        </p>
      </div>
    </div>
  );
}
