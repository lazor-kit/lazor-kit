import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { LazorkitProvider } from '@/components/LazorkitProvider';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Pay with Solana - Lazorkit Demo',
  description: 'A demo application showing Lazorkit SDK integration with passkey authentication and gasless transactions',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <LazorkitProvider>
          {children}
        </LazorkitProvider>
      </body>
    </html>
  );
}
