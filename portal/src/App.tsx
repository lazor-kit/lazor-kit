import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { MessageHandler } from './core/messenger';
import ConnectPage from './routes/ConnectPage';
import SignPage from './routes/SignPage';
import Layout from './components/Layout';
import { useQueryParams } from './hooks/useQueryParams';

function App() {
  const { action } = useQueryParams();
  
  useEffect(() => {
    // Initialize message handler and expose it to the window object
    const messageHandler = new MessageHandler();
    (window as any).messageHandler = messageHandler;
    
    return () => {
      messageHandler.destroy();
      delete (window as any).messageHandler;
    };
  }, []);
  
  // Route based on action parameter
  const getRoute = () => {
    switch (action) {
      case 'connect':
        return <Navigate to="/connect" replace />;
      case 'sign':
        return <Navigate to="/sign" replace />;
      default:
        return <Navigate to="/connect" replace />;
    }
  };
  
  return (
    <Layout>
      <Routes>
        <Route path="/" element={getRoute()} />
        <Route path="/connect" element={<ConnectPage />} />
        <Route path="/sign" element={<SignPage />} />
      </Routes>
    </Layout>
  );
}

export default App;