import { defineConfig } from 'vocs'

export default defineConfig({
  title: 'LazorKit',
  description: 'Seamless Web3 authentication for the web with passkey integration',
  sidebar: [
    {
      text: 'Introduction',
      link: '/',
    },
    {
      text: 'Getting Started',
      link: '/getting-started',
    },
    {
      text: 'Installation',
      link: '/installation',
    },
    {
      text: 'API Reference',
      collapsed: false,
      items: [
        {
          text: 'useWallet Hook',
          link: '/api/use-wallet',
        },
        {
          text: 'LazorkitProvider',
          link: '/api/provider',
        },
        {
          text: 'Types',
          link: '/api/types',
        },
      ],
    },
    {
      text: 'Guides',
      collapsed: false,
      items: [
        {
          text: 'Authentication',
          link: '/guides/authentication',
        },
        {
          text: 'Integration Guide',
          link: '/guides/integration',
        },
        {
          text: 'Transaction Handling',
          link: '/guides/transactions',
        },
        {
          text: 'Wallet Adapter Integration',
          link: '/guides/wallet-adapter',
        },
        {
          text: 'Kora Relayer',
          collapsed: false,
          items: [
            {
              text: 'Quick Reference',
              link: '/guides/kora-reference',
            },
            {
              text: 'Overview',
              link: '/guides/kora-integration',
            },
            {
              text: 'LazorKit + Kora',
              link: '/guides/kora-lazorkit',
            },
          ],
        },
      ],
    },
  ],
})
