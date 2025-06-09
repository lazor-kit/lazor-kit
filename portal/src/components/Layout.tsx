import { ReactNode } from 'react';

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  return (
    <div className="container">
      <header className="app-header">
        <h1>Passkey Portal</h1>
      </header>
      
      <main className="app-content">
        <div className="card">
          {children}
        </div>
      </main>
      
      <footer className="app-footer">
        <p>Secured with passkey technology</p>
      </footer>
    </div>
  );
}