import { defineConfig } from 'vocs'

export default defineConfig({
  title: 'LazorKit',
  description: 'Seamless Web3 authentication for the web with passkey integration',
  sidebar: [
    {
      text: 'Overview',
      collapsed: false,
      items: [
        {
          text: 'Introduction',
          link: '/',
        },
        {
          text: 'Architecture Overview',
          link: '/concepts/architecture',
        },
      ],
    },
    {
      text: 'Quickstart',
      collapsed: false,
      items: [
        {
          text: 'Getting Started',
          link: '/getting-started',
        },
        {
          text: 'Installation',
          link: '/installation',
        },
      ],
    },
    {
      text: 'Core Concepts',
      collapsed: false,
      items: [
        {
          text: 'Authentication Flow',
          link: '/guides/authentication',
        },
        {
          text: 'Transaction Lifecycle',
          link: '/guides/transactions',
        },
      ],
    },
    {
      text: 'How-to Guides',
      collapsed: false,
      items: [
        {
          text: 'Web Integration',
          link: '/guides/integration',
        },
      ],
    },
    {
      text: 'SDK Reference',
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
  ],
})
