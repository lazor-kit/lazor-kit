import { Routes, Route } from 'react-router-dom';
import WalletAction from './pages/WalletAction';

function App() {
  return (
    <Routes>
      <Route path="/" element={<WalletAction />} />
    </Routes>
  );
}

export default App;