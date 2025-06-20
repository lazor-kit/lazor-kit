/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/default_rule.json`.
 */
export type DefaultRule = {
  address: '7H16pVKG2stkkhQ6H9LyXvnHLpXjfB7LLShGjXhYmEWs';
  metadata: {
    name: 'defaultRule';
    version: '0.1.0';
    spec: '0.1.0';
    description: 'Created with Anchor';
  };
  instructions: [
    {
      name: 'checkRule';
      discriminator: [215, 90, 220, 175, 191, 212, 144, 147];
      accounts: [
        {
          name: 'smartWalletAuthenticator';
          signer: true;
        },
        {
          name: 'rule';
          writable: true;
        }
      ];
      args: [];
    },
    {
      name: 'destroy';
      discriminator: [157, 40, 96, 3, 135, 203, 143, 74];
      accounts: [
        {
          name: 'smartWallet';
          docs: ['CHECK'];
        },
        {
          name: 'smartWalletAuthenticator';
          docs: ['CHECK'];
          signer: true;
        },
        {
          name: 'rule';
          writable: true;
        }
      ];
      args: [];
    },
    {
      name: 'initRule';
      discriminator: [129, 224, 96, 169, 247, 125, 74, 118];
      accounts: [
        {
          name: 'payer';
          writable: true;
          signer: true;
        },
        {
          name: 'smartWallet';
        },
        {
          name: 'smartWalletAuthenticator';
          docs: ['CHECK'];
          signer: true;
        },
        {
          name: 'rule';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [114, 117, 108, 101];
              },
              {
                kind: 'account';
                path: 'smartWallet';
              }
            ];
          };
        },
        {
          name: 'lazorkit';
          address: '6Jh4kA4rkZquv9XofKqgbyrRcTDF19uM5HL4xyh6gaSo';
        },
        {
          name: 'systemProgram';
          address: '11111111111111111111111111111111';
        }
      ];
      args: [];
    }
  ];
  accounts: [
    {
      name: 'rule';
      discriminator: [82, 10, 53, 40, 250, 61, 143, 130];
    }
  ];
  errors: [
    {
      code: 6000;
      name: 'invalidPasskey';
    },
    {
      code: 6001;
      name: 'unAuthorize';
    }
  ];
  types: [
    {
      name: 'rule';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'smartWallet';
            type: 'pubkey';
          },
          {
            name: 'admin';
            type: 'pubkey';
          },
          {
            name: 'isInitialized';
            type: 'bool';
          }
        ];
      };
    }
  ];
};
