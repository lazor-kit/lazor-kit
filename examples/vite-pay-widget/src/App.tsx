import { WalletConnect } from './components/WalletConnect';
import { WalletStatus } from './components/WalletStatus';
import { PaymentForm } from './components/PaymentForm';
import { useWallet } from '@lazorkit/wallet';

function App() {
  const { isConnected } = useWallet();

  return (
    <div className="app">
      <header className="app-header">
        <h1>Lazorkit Pay Widget</h1>
        <p className="subtitle">Gasless Solana Payments with Passkey Authentication</p>
      </header>

      <main className="app-main">
        <div className="container">
          {/* Wallet Connection Section */}
          <section className="card">
            <WalletConnect />
          </section>

          {/* Wallet Status - Only show when connected */}
          {isConnected && (
            <section className="card">
              <WalletStatus />
            </section>
          )}

          {/* Payment Form - Only show when connected */}
          {isConnected && (
            <section className="card">
              <PaymentForm />
            </section>
          )}

          {/* Info Section */}
          {!isConnected && (
            <section className="info-card">
              <h2>✨ Features</h2>
              <ul>
                <li>🔐 <strong>Passkey Authentication</strong> - No seed phrases needed</li>
                <li>🚀 <strong>Gasless Transactions</strong> - Send SOL without paying fees</li>
                <li>💎 <strong>Smart Wallet</strong> - Programmable account logic</li>
                <li>🔒 <strong>Secure</strong> - Hardware-bound credentials</li>
              </ul>
            </section>
          )}
        </div>
      </main>

      <footer className="app-footer">
        <p>
          Built with <a href="https://docs.lazorkit.com" target="_blank" rel="noopener noreferrer">Lazorkit SDK</a>
          {' • '}
          <a href="https://github.com/lazor-kit/lazor-kit" target="_blank" rel="noopener noreferrer">GitHub</a>
          {' • '}
          <a href="https://t.me/lazorkit" target="_blank" rel="noopener noreferrer">Telegram</a>
        </p>
      </footer>
    </div>
  );
}

export default App;
