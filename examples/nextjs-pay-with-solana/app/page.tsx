import { PayWidget } from '@/components/PayWidget';
import { WalletStatus } from '@/components/WalletStatus';

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-solana-purple via-solana-blue to-solana-green">
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="text-center mb-12">
            <h1 className="text-5xl font-bold text-white mb-4">
              Pay with Solana
            </h1>
            <p className="text-xl text-white/80">
              A Lazorkit SDK Integration Demo
            </p>
            <div className="mt-4 flex justify-center gap-4">
              <span className="px-3 py-1 bg-white/20 rounded-full text-white text-sm">
                🔑 Passkey Auth
              </span>
              <span className="px-3 py-1 bg-white/20 rounded-full text-white text-sm">
                ⛽ Gasless Transactions
              </span>
              <span className="px-3 py-1 bg-white/20 rounded-full text-white text-sm">
                🔒 Smart Wallet
              </span>
            </div>
          </div>

          {/* Main Content */}
          <div className="grid md:grid-cols-2 gap-8">
            {/* Wallet Status Card */}
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 border border-white/20">
              <h2 className="text-2xl font-semibold text-white mb-6">
                Wallet Status
              </h2>
              <WalletStatus />
            </div>

            {/* Pay Widget Card */}
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 border border-white/20">
              <h2 className="text-2xl font-semibold text-white mb-6">
                Send Payment
              </h2>
              <PayWidget />
            </div>
          </div>

          {/* Features Section */}
          <div className="mt-12 grid md:grid-cols-3 gap-6">
            <FeatureCard
              icon="🔐"
              title="Passkey Authentication"
              description="No seed phrases needed. Use FaceID, TouchID, or Windows Hello to authenticate."
            />
            <FeatureCard
              icon="⛽"
              title="Gasless Transactions"
              description="Transactions are sponsored by Paymaster. Users don't need SOL for gas fees."
            />
            <FeatureCard
              icon="🧠"
              title="Smart Wallet"
              description="Programmable account with PDA support for advanced use cases."
            />
          </div>
        </div>
      </div>
    </main>
  );
}

function FeatureCard({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div className="bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-white/10 hover:bg-white/10 transition-colors">
      <div className="text-4xl mb-4">{icon}</div>
      <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
      <p className="text-white/70 text-sm">{description}</p>
    </div>
  );
}
