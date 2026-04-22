import './App.css'
import { Client } from './client'
import { LazorkitProvider } from '../../packages/ts-sdk'
function App() {
  return (
    <LazorkitProvider
      rpcUrl="https://api.devnet.solana.com"
      portalUrl="https://portal.lazor.sh"
      paymasterConfig={{
        paymasterUrl: "https://kora.devnet.lazorkit.com",
      }}
    >
      <Client />
    </LazorkitProvider>
  )
}

export default App
