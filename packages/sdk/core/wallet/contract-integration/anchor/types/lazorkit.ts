/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/lazorkit.json`.
 */
export type Lazorkit = {
  address: 'J6Big9w1VNeRZgDWH5qmNz2Nd6XFq5QeZbqC8caqSE5W';
  metadata: {
    name: 'lazorkit';
    version: '0.1.0';
    spec: '0.1.0';
    description: 'Created with Anchor';
  };
  docs: [
    'The Lazor Kit program provides smart wallet functionality with passkey authentication'
  ];
  instructions: [
    {
      name: 'createSmartWallet';
      docs: ['Create a new smart wallet with passkey authentication'];
      discriminator: [129, 39, 235, 18, 132, 68, 203, 19];
      accounts: [
        {
          name: 'payer';
          writable: true;
          signer: true;
        },
        {
          name: 'policyProgramRegistry';
          docs: ['Policy program registry'];
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121,
                  95,
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ];
              }
            ];
          };
        },
        {
          name: 'smartWallet';
          docs: ['The smart wallet PDA being created with random ID'];
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  115,
                  109,
                  97,
                  114,
                  116,
                  95,
                  119,
                  97,
                  108,
                  108,
                  101,
                  116
                ];
              },
              {
                kind: 'arg';
                path: 'args.wallet_id';
              }
            ];
          };
        },
        {
          name: 'smartWalletData';
          docs: ['Smart wallet data'];
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  115,
                  109,
                  97,
                  114,
                  116,
                  95,
                  119,
                  97,
                  108,
                  108,
                  101,
                  116,
                  95,
                  100,
                  97,
                  116,
                  97
                ];
              },
              {
                kind: 'account';
                path: 'smartWallet';
              }
            ];
          };
        },
        {
          name: 'walletDevice';
          docs: ['Wallet device for the passkey'];
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  119,
                  97,
                  108,
                  108,
                  101,
                  116,
                  95,
                  100,
                  101,
                  118,
                  105,
                  99,
                  101
                ];
              },
              {
                kind: 'account';
                path: 'smartWallet';
              },
              {
                kind: 'arg';
                path: 'args.passkey_pubkey.to_hashed_bytes(smart_wallet';
              }
            ];
          };
        },
        {
          name: 'config';
          docs: ['Program configuration'];
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [99, 111, 110, 102, 105, 103];
              }
            ];
          };
        },
        {
          name: 'defaultPolicyProgram';
          docs: ['Default policy program for the smart wallet'];
        },
        {
          name: 'systemProgram';
          address: '11111111111111111111111111111111';
        }
      ];
      args: [
        {
          name: 'args';
          type: {
            defined: {
              name: 'createSmartWalletArgs';
            };
          };
        }
      ];
    },
    {
      name: 'createTransactionSession';
      discriminator: [63, 173, 215, 71, 47, 219, 207, 197];
      accounts: [
        {
          name: 'payer';
          writable: true;
          signer: true;
        },
        {
          name: 'config';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [99, 111, 110, 102, 105, 103];
              }
            ];
          };
        },
        {
          name: 'smartWallet';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  115,
                  109,
                  97,
                  114,
                  116,
                  95,
                  119,
                  97,
                  108,
                  108,
                  101,
                  116
                ];
              },
              {
                kind: 'account';
                path: 'smart_wallet_data.id';
                account: 'smartWallet';
              }
            ];
          };
        },
        {
          name: 'smartWalletData';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  115,
                  109,
                  97,
                  114,
                  116,
                  95,
                  119,
                  97,
                  108,
                  108,
                  101,
                  116,
                  95,
                  100,
                  97,
                  116,
                  97
                ];
              },
              {
                kind: 'account';
                path: 'smartWallet';
              }
            ];
          };
        },
        {
          name: 'walletDevice';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  119,
                  97,
                  108,
                  108,
                  101,
                  116,
                  95,
                  100,
                  101,
                  118,
                  105,
                  99,
                  101
                ];
              },
              {
                kind: 'account';
                path: 'smartWallet';
              },
              {
                kind: 'arg';
                path: 'args.passkey_pubkey.to_hashed_bytes(smart_wallet';
              }
            ];
          };
        },
        {
          name: 'policyProgramRegistry';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121,
                  95,
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ];
              }
            ];
          };
        },
        {
          name: 'policyProgram';
          docs: [
            'Policy program for optional policy enforcement at session creation'
          ];
        },
        {
          name: 'transactionSession';
          docs: ['New transaction session account (rent payer: payer)'];
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  116,
                  114,
                  97,
                  110,
                  115,
                  97,
                  99,
                  116,
                  105,
                  111,
                  110,
                  95,
                  115,
                  101,
                  115,
                  115,
                  105,
                  111,
                  110
                ];
              },
              {
                kind: 'account';
                path: 'smartWallet';
              },
              {
                kind: 'account';
                path: 'smart_wallet_data.last_nonce';
                account: 'smartWallet';
              }
            ];
          };
        },
        {
          name: 'ixSysvar';
          address: 'Sysvar1nstructions1111111111111111111111111';
        },
        {
          name: 'systemProgram';
          address: '11111111111111111111111111111111';
        }
      ];
      args: [
        {
          name: 'args';
          type: {
            defined: {
              name: 'createSessionArgs';
            };
          };
        }
      ];
    },
    {
      name: 'executeSessionTransaction';
      discriminator: [38, 182, 163, 196, 170, 170, 115, 226];
      accounts: [
        {
          name: 'payer';
          writable: true;
          signer: true;
        },
        {
          name: 'config';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [99, 111, 110, 102, 105, 103];
              }
            ];
          };
        },
        {
          name: 'smartWallet';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  115,
                  109,
                  97,
                  114,
                  116,
                  95,
                  119,
                  97,
                  108,
                  108,
                  101,
                  116
                ];
              },
              {
                kind: 'account';
                path: 'smart_wallet_data.id';
                account: 'smartWallet';
              }
            ];
          };
        },
        {
          name: 'smartWalletData';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  115,
                  109,
                  97,
                  114,
                  116,
                  95,
                  119,
                  97,
                  108,
                  108,
                  101,
                  116,
                  95,
                  100,
                  97,
                  116,
                  97
                ];
              },
              {
                kind: 'account';
                path: 'smartWallet';
              }
            ];
          };
        },
        {
          name: 'cpiProgram';
        },
        {
          name: 'transactionSession';
          docs: [
            'Transaction session to execute. Closed on success to refund rent.'
          ];
          writable: true;
        },
        {
          name: 'sessionRefund';
          writable: true;
        }
      ];
      args: [
        {
          name: 'cpiData';
          type: 'bytes';
        }
      ];
    },
    {
      name: 'executeTransaction';
      discriminator: [231, 173, 49, 91, 235, 24, 68, 19];
      accounts: [
        {
          name: 'payer';
          writable: true;
          signer: true;
        },
        {
          name: 'smartWallet';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  115,
                  109,
                  97,
                  114,
                  116,
                  95,
                  119,
                  97,
                  108,
                  108,
                  101,
                  116
                ];
              },
              {
                kind: 'account';
                path: 'smart_wallet_data.id';
                account: 'smartWallet';
              }
            ];
          };
        },
        {
          name: 'smartWalletData';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  115,
                  109,
                  97,
                  114,
                  116,
                  95,
                  119,
                  97,
                  108,
                  108,
                  101,
                  116,
                  95,
                  100,
                  97,
                  116,
                  97
                ];
              },
              {
                kind: 'account';
                path: 'smartWallet';
              }
            ];
          };
        },
        {
          name: 'walletDevice';
        },
        {
          name: 'policyProgramRegistry';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121,
                  95,
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ];
              }
            ];
          };
        },
        {
          name: 'policyProgram';
        },
        {
          name: 'cpiProgram';
        },
        {
          name: 'config';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [99, 111, 110, 102, 105, 103];
              }
            ];
          };
        },
        {
          name: 'ixSysvar';
          address: 'Sysvar1nstructions1111111111111111111111111';
        }
      ];
      args: [
        {
          name: 'args';
          type: {
            defined: {
              name: 'executeTransactionArgs';
            };
          };
        }
      ];
    },
    {
      name: 'initialize';
      docs: ['Initialize the program by creating the sequence tracker'];
      discriminator: [175, 175, 109, 31, 13, 152, 155, 237];
      accounts: [
        {
          name: 'signer';
          docs: [
            'The signer of the transaction, who will be the initial authority.'
          ];
          writable: true;
          signer: true;
        },
        {
          name: 'config';
          docs: ["The program's configuration account."];
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [99, 111, 110, 102, 105, 103];
              }
            ];
          };
        },
        {
          name: 'policyProgramRegistry';
          docs: [
            'The registry of policy programs that can be used with smart wallets.'
          ];
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121,
                  95,
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ];
              }
            ];
          };
        },
        {
          name: 'defaultPolicyProgram';
          docs: [
            'The default policy program to be used for new smart wallets.'
          ];
        },
        {
          name: 'systemProgram';
          docs: ['The system program.'];
          address: '11111111111111111111111111111111';
        }
      ];
      args: [];
    },
    {
      name: 'invokePolicy';
      discriminator: [233, 117, 13, 198, 43, 169, 77, 87];
      accounts: [
        {
          name: 'payer';
          writable: true;
          signer: true;
        },
        {
          name: 'config';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [99, 111, 110, 102, 105, 103];
              }
            ];
          };
        },
        {
          name: 'smartWallet';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  115,
                  109,
                  97,
                  114,
                  116,
                  95,
                  119,
                  97,
                  108,
                  108,
                  101,
                  116
                ];
              },
              {
                kind: 'account';
                path: 'smart_wallet_data.id';
                account: 'smartWallet';
              }
            ];
          };
        },
        {
          name: 'smartWalletData';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  115,
                  109,
                  97,
                  114,
                  116,
                  95,
                  119,
                  97,
                  108,
                  108,
                  101,
                  116,
                  95,
                  100,
                  97,
                  116,
                  97
                ];
              },
              {
                kind: 'account';
                path: 'smartWallet';
              }
            ];
          };
        },
        {
          name: 'walletDevice';
        },
        {
          name: 'policyProgram';
        },
        {
          name: 'policyProgramRegistry';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121,
                  95,
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ];
              }
            ];
          };
        },
        {
          name: 'ixSysvar';
          address: 'Sysvar1nstructions1111111111111111111111111';
        },
        {
          name: 'systemProgram';
          address: '11111111111111111111111111111111';
        }
      ];
      args: [
        {
          name: 'args';
          type: {
            defined: {
              name: 'invokePolicyArgs';
            };
          };
        }
      ];
    },
    {
      name: 'registerPolicyProgram';
      docs: ['Add a program to the policy program registry'];
      discriminator: [15, 54, 85, 112, 89, 180, 121, 13];
      accounts: [
        {
          name: 'authority';
          writable: true;
          signer: true;
          relations: ['config'];
        },
        {
          name: 'config';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [99, 111, 110, 102, 105, 103];
              }
            ];
          };
        },
        {
          name: 'policyProgramRegistry';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121,
                  95,
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ];
              }
            ];
          };
        }
      ];
      args: [];
    },
    {
      name: 'updateConfig';
      docs: ['Update the program configuration'];
      discriminator: [29, 158, 252, 191, 10, 83, 219, 99];
      accounts: [
        {
          name: 'authority';
          docs: ['The current authority of the program.'];
          writable: true;
          signer: true;
          relations: ['config'];
        },
        {
          name: 'config';
          docs: ["The program's configuration account."];
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [99, 111, 110, 102, 105, 103];
              }
            ];
          };
        }
      ];
      args: [
        {
          name: 'param';
          type: {
            defined: {
              name: 'updateConfigType';
            };
          };
        },
        {
          name: 'value';
          type: 'u64';
        }
      ];
    },
    {
      name: 'updatePolicy';
      discriminator: [212, 245, 246, 7, 163, 151, 18, 57];
      accounts: [
        {
          name: 'payer';
          writable: true;
          signer: true;
        },
        {
          name: 'config';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [99, 111, 110, 102, 105, 103];
              }
            ];
          };
        },
        {
          name: 'smartWallet';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  115,
                  109,
                  97,
                  114,
                  116,
                  95,
                  119,
                  97,
                  108,
                  108,
                  101,
                  116
                ];
              },
              {
                kind: 'account';
                path: 'smart_wallet_data.id';
                account: 'smartWallet';
              }
            ];
          };
        },
        {
          name: 'smartWalletData';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  115,
                  109,
                  97,
                  114,
                  116,
                  95,
                  119,
                  97,
                  108,
                  108,
                  101,
                  116,
                  95,
                  100,
                  97,
                  116,
                  97
                ];
              },
              {
                kind: 'account';
                path: 'smartWallet';
              }
            ];
          };
        },
        {
          name: 'walletDevice';
        },
        {
          name: 'oldPolicyProgram';
        },
        {
          name: 'newPolicyProgram';
        },
        {
          name: 'policyProgramRegistry';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121,
                  95,
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ];
              }
            ];
          };
        },
        {
          name: 'ixSysvar';
          docs: ['CHECK'];
          address: 'Sysvar1nstructions1111111111111111111111111';
        },
        {
          name: 'systemProgram';
          address: '11111111111111111111111111111111';
        }
      ];
      args: [
        {
          name: 'args';
          type: {
            defined: {
              name: 'updatePolicyArgs';
            };
          };
        }
      ];
    }
  ];
  accounts: [
    {
      name: 'config';
      discriminator: [155, 12, 170, 224, 30, 250, 204, 130];
    },
    {
      name: 'policyProgramRegistry';
      discriminator: [158, 67, 114, 157, 27, 153, 86, 72];
    },
    {
      name: 'smartWallet';
      discriminator: [67, 59, 220, 179, 41, 10, 60, 177];
    },
    {
      name: 'transactionSession';
      discriminator: [169, 116, 227, 43, 10, 34, 251, 2];
    },
    {
      name: 'walletDevice';
      discriminator: [35, 85, 31, 31, 179, 48, 136, 123];
    }
  ];
  events: [
    {
      name: 'authenticatorAdded';
      discriminator: [213, 87, 171, 174, 101, 129, 32, 44];
    },
    {
      name: 'configUpdated';
      discriminator: [40, 241, 230, 122, 11, 19, 198, 194];
    },
    {
      name: 'errorEvent';
      discriminator: [163, 35, 212, 206, 66, 104, 234, 251];
    },
    {
      name: 'feeCollected';
      discriminator: [12, 28, 17, 248, 244, 36, 8, 73];
    },
    {
      name: 'policyProgramChanged';
      discriminator: [235, 88, 111, 162, 87, 195, 1, 141];
    },
    {
      name: 'policyProgramRegistered';
      discriminator: [204, 39, 171, 246, 52, 45, 103, 117];
    },
    {
      name: 'programInitialized';
      discriminator: [43, 70, 110, 241, 199, 218, 221, 245];
    },
    {
      name: 'programPausedStateChanged';
      discriminator: [148, 9, 117, 157, 18, 25, 122, 32];
    },
    {
      name: 'securityEvent';
      discriminator: [16, 175, 241, 170, 85, 9, 201, 100];
    },
    {
      name: 'smartWalletCreated';
      discriminator: [145, 37, 118, 21, 58, 251, 56, 128];
    },
    {
      name: 'solTransfer';
      discriminator: [0, 186, 79, 129, 194, 76, 94, 9];
    },
    {
      name: 'transactionExecuted';
      discriminator: [211, 227, 168, 14, 32, 111, 189, 210];
    }
  ];
  errors: [
    {
      code: 6000;
      name: 'passkeyMismatch';
      msg: 'Passkey public key mismatch with stored authenticator';
    },
    {
      code: 6001;
      name: 'smartWalletMismatch';
      msg: 'Smart wallet address mismatch with authenticator';
    },
    {
      code: 6002;
      name: 'authenticatorNotFound';
      msg: 'Smart wallet authenticator account not found or invalid';
    },
    {
      code: 6003;
      name: 'secp256r1InvalidLength';
      msg: 'Secp256r1 instruction has invalid data length';
    },
    {
      code: 6004;
      name: 'secp256r1HeaderMismatch';
      msg: 'Secp256r1 instruction header validation failed';
    },
    {
      code: 6005;
      name: 'secp256r1DataMismatch';
      msg: 'Secp256r1 signature data validation failed';
    },
    {
      code: 6006;
      name: 'secp256r1InstructionNotFound';
      msg: 'Secp256r1 instruction not found at specified index';
    },
    {
      code: 6007;
      name: 'invalidSignature';
      msg: 'Invalid signature provided for passkey verification';
    },
    {
      code: 6008;
      name: 'clientDataInvalidUtf8';
      msg: 'Client data JSON is not valid UTF-8';
    },
    {
      code: 6009;
      name: 'clientDataJsonParseError';
      msg: 'Client data JSON parsing failed';
    },
    {
      code: 6010;
      name: 'challengeMissing';
      msg: 'Challenge field missing from client data JSON';
    },
    {
      code: 6011;
      name: 'challengeBase64DecodeError';
      msg: 'Challenge base64 decoding failed';
    },
    {
      code: 6012;
      name: 'challengeDeserializationError';
      msg: 'Challenge message deserialization failed';
    },
    {
      code: 6013;
      name: 'timestampTooOld';
      msg: 'Message timestamp is too far in the past';
    },
    {
      code: 6014;
      name: 'timestampTooNew';
      msg: 'Message timestamp is too far in the future';
    },
    {
      code: 6015;
      name: 'nonceMismatch';
      msg: 'Nonce mismatch: expected different value';
    },
    {
      code: 6016;
      name: 'nonceOverflow';
      msg: 'Nonce overflow: cannot increment further';
    },
    {
      code: 6017;
      name: 'policyProgramNotRegistered';
      msg: 'Policy program not found in registry';
    },
    {
      code: 6018;
      name: 'whitelistFull';
      msg: 'The policy program registry is full.';
    },
    {
      code: 6019;
      name: 'policyDataRequired';
      msg: 'Policy data is required but not provided';
    },
    {
      code: 6020;
      name: 'invalidCheckPolicyDiscriminator';
      msg: 'Invalid instruction discriminator for check_policy';
    },
    {
      code: 6021;
      name: 'invalidDestroyDiscriminator';
      msg: 'Invalid instruction discriminator for destroy';
    },
    {
      code: 6022;
      name: 'invalidInitPolicyDiscriminator';
      msg: 'Invalid instruction discriminator for init_policy';
    },
    {
      code: 6023;
      name: 'policyProgramsIdentical';
      msg: 'Old and new policy programs are identical';
    },
    {
      code: 6024;
      name: 'noDefaultPolicyProgram';
      msg: 'Neither old nor new policy program is the default';
    },
    {
      code: 6025;
      name: 'invalidRemainingAccounts';
      msg: 'Invalid remaining accounts';
    },
    {
      code: 6026;
      name: 'cpiDataMissing';
      msg: 'CPI data is required but not provided';
    },
    {
      code: 6027;
      name: 'invalidCpiData';
      msg: 'CPI data is invalid or malformed';
    },
    {
      code: 6028;
      name: 'insufficientPolicyAccounts';
      msg: 'Insufficient remaining accounts for policy instruction';
    },
    {
      code: 6029;
      name: 'insufficientCpiAccounts';
      msg: 'Insufficient remaining accounts for CPI instruction';
    },
    {
      code: 6030;
      name: 'accountSliceOutOfBounds';
      msg: 'Account slice index out of bounds';
    },
    {
      code: 6031;
      name: 'solTransferInsufficientAccounts';
      msg: 'SOL transfer requires at least 2 remaining accounts';
    },
    {
      code: 6032;
      name: 'newWalletDeviceMissing';
      msg: 'New authenticator account is required but not provided';
    },
    {
      code: 6033;
      name: 'newWalletDevicePasskeyMissing';
      msg: 'New authenticator passkey is required but not provided';
    },
    {
      code: 6034;
      name: 'insufficientLamports';
      msg: 'Insufficient lamports for requested transfer';
    },
    {
      code: 6035;
      name: 'transferAmountOverflow';
      msg: 'Transfer amount would cause arithmetic overflow';
    },
    {
      code: 6036;
      name: 'invalidBumpSeed';
      msg: 'Invalid bump seed for PDA derivation';
    },
    {
      code: 6037;
      name: 'invalidAccountOwner';
      msg: 'Account owner verification failed';
    },
    {
      code: 6038;
      name: 'invalidAccountDiscriminator';
      msg: 'Account discriminator mismatch';
    },
    {
      code: 6039;
      name: 'invalidProgramId';
      msg: 'Invalid program ID';
    },
    {
      code: 6040;
      name: 'programNotExecutable';
      msg: 'Program not executable';
    },
    {
      code: 6041;
      name: 'walletDeviceAlreadyInitialized';
      msg: 'Wallet device already initialized';
    },
    {
      code: 6042;
      name: 'credentialIdTooLarge';
      msg: 'Credential ID exceeds maximum allowed size';
    },
    {
      code: 6043;
      name: 'credentialIdEmpty';
      msg: 'Credential ID cannot be empty';
    },
    {
      code: 6044;
      name: 'policyDataTooLarge';
      msg: 'Policy data exceeds maximum allowed size';
    },
    {
      code: 6045;
      name: 'cpiDataTooLarge';
      msg: 'CPI data exceeds maximum allowed size';
    },
    {
      code: 6046;
      name: 'tooManyRemainingAccounts';
      msg: 'Too many remaining accounts provided';
    },
    {
      code: 6047;
      name: 'invalidPdaDerivation';
      msg: 'Invalid PDA derivation';
    },
    {
      code: 6048;
      name: 'transactionTooOld';
      msg: 'Transaction is too old';
    },
    {
      code: 6049;
      name: 'rateLimitExceeded';
      msg: 'Rate limit exceeded';
    },
    {
      code: 6050;
      name: 'invalidAccountData';
      msg: 'Invalid account data';
    },
    {
      code: 6051;
      name: 'unauthorized';
      msg: 'Unauthorized access attempt';
    },
    {
      code: 6052;
      name: 'programPaused';
      msg: 'Program is paused';
    },
    {
      code: 6053;
      name: 'invalidInstructionData';
      msg: 'Invalid instruction data';
    },
    {
      code: 6054;
      name: 'accountAlreadyInitialized';
      msg: 'Account already initialized';
    },
    {
      code: 6055;
      name: 'accountNotInitialized';
      msg: 'Account not initialized';
    },
    {
      code: 6056;
      name: 'invalidAccountState';
      msg: 'Invalid account state';
    },
    {
      code: 6057;
      name: 'integerOverflow';
      msg: 'Operation would cause integer overflow';
    },
    {
      code: 6058;
      name: 'integerUnderflow';
      msg: 'Operation would cause integer underflow';
    },
    {
      code: 6059;
      name: 'invalidFeeAmount';
      msg: 'Invalid fee amount';
    },
    {
      code: 6060;
      name: 'insufficientBalanceForFee';
      msg: 'Insufficient balance for fee';
    },
    {
      code: 6061;
      name: 'invalidAuthority';
      msg: 'Invalid authority';
    },
    {
      code: 6062;
      name: 'authorityMismatch';
      msg: 'Authority mismatch';
    },
    {
      code: 6063;
      name: 'invalidSequenceNumber';
      msg: 'Invalid sequence number';
    },
    {
      code: 6064;
      name: 'duplicateTransaction';
      msg: 'Duplicate transaction detected';
    },
    {
      code: 6065;
      name: 'invalidTransactionOrdering';
      msg: 'Invalid transaction ordering';
    },
    {
      code: 6066;
      name: 'maxWalletLimitReached';
      msg: 'Maximum wallet limit reached';
    },
    {
      code: 6067;
      name: 'invalidWalletConfiguration';
      msg: 'Invalid wallet configuration';
    },
    {
      code: 6068;
      name: 'walletNotFound';
      msg: 'Wallet not found';
    },
    {
      code: 6069;
      name: 'invalidPasskeyFormat';
      msg: 'Invalid passkey format';
    },
    {
      code: 6070;
      name: 'passkeyAlreadyRegistered';
      msg: 'Passkey already registered';
    },
    {
      code: 6071;
      name: 'invalidMessageFormat';
      msg: 'Invalid message format';
    },
    {
      code: 6072;
      name: 'messageSizeExceedsLimit';
      msg: 'Message size exceeds limit';
    },
    {
      code: 6073;
      name: 'invalidSplitIndex';
      msg: 'Invalid split index';
    },
    {
      code: 6074;
      name: 'cpiExecutionFailed';
      msg: 'CPI execution failed';
    },
    {
      code: 6075;
      name: 'invalidProgramAddress';
      msg: 'Invalid program address';
    },
    {
      code: 6076;
      name: 'whitelistOperationFailed';
      msg: 'Whitelist operation failed';
    },
    {
      code: 6077;
      name: 'invalidWhitelistState';
      msg: 'Invalid whitelist state';
    },
    {
      code: 6078;
      name: 'emergencyShutdown';
      msg: 'Emergency shutdown activated';
    },
    {
      code: 6079;
      name: 'recoveryModeRequired';
      msg: 'Recovery mode required';
    },
    {
      code: 6080;
      name: 'invalidRecoveryAttempt';
      msg: 'Invalid recovery attempt';
    },
    {
      code: 6081;
      name: 'auditLogFull';
      msg: 'Audit log full';
    },
    {
      code: 6082;
      name: 'invalidAuditEntry';
      msg: 'Invalid audit entry';
    },
    {
      code: 6083;
      name: 'reentrancyDetected';
      msg: 'Reentrancy detected';
    },
    {
      code: 6084;
      name: 'invalidCallDepth';
      msg: 'Invalid call depth';
    },
    {
      code: 6085;
      name: 'stackOverflowProtection';
      msg: 'Stack overflow protection triggered';
    },
    {
      code: 6086;
      name: 'memoryLimitExceeded';
      msg: 'Memory limit exceeded';
    },
    {
      code: 6087;
      name: 'computationLimitExceeded';
      msg: 'Computation limit exceeded';
    },
    {
      code: 6088;
      name: 'invalidRentExemption';
      msg: 'Invalid rent exemption';
    },
    {
      code: 6089;
      name: 'accountClosureFailed';
      msg: 'Account closure failed';
    },
    {
      code: 6090;
      name: 'invalidAccountClosure';
      msg: 'Invalid account closure';
    },
    {
      code: 6091;
      name: 'refundFailed';
      msg: 'Refund failed';
    },
    {
      code: 6092;
      name: 'invalidRefundAmount';
      msg: 'Invalid refund amount';
    }
  ];
  types: [
    {
      name: 'authenticatorAdded';
      docs: ['Event emitted when a new authenticator is added'];
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'smartWallet';
            type: 'pubkey';
          },
          {
            name: 'newWalletDevice';
            type: 'pubkey';
          },
          {
            name: 'passkeyHash';
            type: {
              array: ['u8', 32];
            };
          },
          {
            name: 'addedBy';
            type: 'pubkey';
          },
          {
            name: 'timestamp';
            type: 'i64';
          }
        ];
      };
    },
    {
      name: 'config';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'authority';
            type: 'pubkey';
          },
          {
            name: 'createSmartWalletFee';
            type: 'u64';
          },
          {
            name: 'executeFee';
            type: 'u64';
          },
          {
            name: 'defaultPolicyProgram';
            type: 'pubkey';
          },
          {
            name: 'isPaused';
            type: 'bool';
          }
        ];
      };
    },
    {
      name: 'configUpdated';
      docs: ['Event emitted when program configuration is updated'];
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'authority';
            type: 'pubkey';
          },
          {
            name: 'updateType';
            type: 'string';
          },
          {
            name: 'oldValue';
            type: 'string';
          },
          {
            name: 'newValue';
            type: 'string';
          },
          {
            name: 'timestamp';
            type: 'i64';
          }
        ];
      };
    },
    {
      name: 'createSessionArgs';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'passkeyPubkey';
            type: {
              array: ['u8', 33];
            };
          },
          {
            name: 'signature';
            type: 'bytes';
          },
          {
            name: 'clientDataJsonRaw';
            type: 'bytes';
          },
          {
            name: 'authenticatorDataRaw';
            type: 'bytes';
          },
          {
            name: 'verifyInstructionIndex';
            type: 'u8';
          },
          {
            name: 'policyData';
            type: 'bytes';
          },
          {
            name: 'expiresAt';
            type: 'i64';
          }
        ];
      };
    },
    {
      name: 'createSmartWalletArgs';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'passkeyPubkey';
            type: {
              array: ['u8', 33];
            };
          },
          {
            name: 'credentialId';
            type: 'bytes';
          },
          {
            name: 'policyData';
            type: 'bytes';
          },
          {
            name: 'walletId';
            type: 'u64';
          },
          {
            name: 'isPayForUser';
            type: 'bool';
          }
        ];
      };
    },
    {
      name: 'errorEvent';
      docs: ['Event emitted for errors that are caught and handled'];
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'smartWallet';
            type: {
              option: 'pubkey';
            };
          },
          {
            name: 'errorCode';
            type: 'string';
          },
          {
            name: 'errorMessage';
            type: 'string';
          },
          {
            name: 'actionAttempted';
            type: 'string';
          },
          {
            name: 'timestamp';
            type: 'i64';
          }
        ];
      };
    },
    {
      name: 'executeTransactionArgs';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'passkeyPubkey';
            type: {
              array: ['u8', 33];
            };
          },
          {
            name: 'signature';
            type: 'bytes';
          },
          {
            name: 'clientDataJsonRaw';
            type: 'bytes';
          },
          {
            name: 'authenticatorDataRaw';
            type: 'bytes';
          },
          {
            name: 'verifyInstructionIndex';
            type: 'u8';
          },
          {
            name: 'splitIndex';
            type: 'u16';
          },
          {
            name: 'policyData';
            type: 'bytes';
          },
          {
            name: 'cpiData';
            type: 'bytes';
          }
        ];
      };
    },
    {
      name: 'feeCollected';
      docs: ['Event emitted when a fee is collected'];
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'smartWallet';
            type: 'pubkey';
          },
          {
            name: 'feeType';
            type: 'string';
          },
          {
            name: 'amount';
            type: 'u64';
          },
          {
            name: 'recipient';
            type: 'pubkey';
          },
          {
            name: 'timestamp';
            type: 'i64';
          }
        ];
      };
    },
    {
      name: 'invokePolicyArgs';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'passkeyPubkey';
            type: {
              array: ['u8', 33];
            };
          },
          {
            name: 'signature';
            type: 'bytes';
          },
          {
            name: 'clientDataJsonRaw';
            type: 'bytes';
          },
          {
            name: 'authenticatorDataRaw';
            type: 'bytes';
          },
          {
            name: 'verifyInstructionIndex';
            type: 'u8';
          },
          {
            name: 'policyData';
            type: 'bytes';
          },
          {
            name: 'newWalletDevice';
            type: {
              option: {
                defined: {
                  name: 'newWalletDeviceArgs';
                };
              };
            };
          }
        ];
      };
    },
    {
      name: 'newWalletDeviceArgs';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'passkeyPubkey';
            type: {
              array: ['u8', 33];
            };
          },
          {
            name: 'credentialId';
            type: 'bytes';
          }
        ];
      };
    },
    {
      name: 'policyProgramChanged';
      docs: ['Event emitted when a policy program is changed'];
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'smartWallet';
            type: 'pubkey';
          },
          {
            name: 'oldPolicyProgram';
            type: 'pubkey';
          },
          {
            name: 'newPolicyProgram';
            type: 'pubkey';
          },
          {
            name: 'nonce';
            type: 'u64';
          },
          {
            name: 'timestamp';
            type: 'i64';
          }
        ];
      };
    },
    {
      name: 'policyProgramRegistered';
      docs: ['Event emitted when a policy program is added to registry'];
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'authority';
            type: 'pubkey';
          },
          {
            name: 'policyProgram';
            type: 'pubkey';
          },
          {
            name: 'timestamp';
            type: 'i64';
          }
        ];
      };
    },
    {
      name: 'policyProgramRegistry';
      docs: [
        'Registry of approved policy programs that can govern smart wallet operations'
      ];
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'programs';
            docs: ['List of registered policy program addresses'];
            type: {
              vec: 'pubkey';
            };
          },
          {
            name: 'bump';
            docs: ['Bump seed for PDA derivation'];
            type: 'u8';
          }
        ];
      };
    },
    {
      name: 'programInitialized';
      docs: ['Event emitted when program is initialized'];
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'authority';
            type: 'pubkey';
          },
          {
            name: 'defaultPolicyProgram';
            type: 'pubkey';
          },
          {
            name: 'timestamp';
            type: 'i64';
          }
        ];
      };
    },
    {
      name: 'programPausedStateChanged';
      docs: ['Event emitted when program is paused/unpaused'];
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'authority';
            type: 'pubkey';
          },
          {
            name: 'isPaused';
            type: 'bool';
          },
          {
            name: 'timestamp';
            type: 'i64';
          }
        ];
      };
    },
    {
      name: 'securityEvent';
      docs: ['Event emitted for security-related events'];
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'eventType';
            type: 'string';
          },
          {
            name: 'smartWallet';
            type: {
              option: 'pubkey';
            };
          },
          {
            name: 'details';
            type: 'string';
          },
          {
            name: 'severity';
            type: 'string';
          },
          {
            name: 'timestamp';
            type: 'i64';
          }
        ];
      };
    },
    {
      name: 'smartWallet';
      docs: ['Data account for a smart wallet'];
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'id';
            docs: ['Unique identifier for this smart wallet'];
            type: 'u64';
          },
          {
            name: 'policyProgram';
            docs: ["Policy program that governs this wallet's operations"];
            type: 'pubkey';
          },
          {
            name: 'lastNonce';
            docs: ['Last nonce used for message verification'];
            type: 'u64';
          },
          {
            name: 'bump';
            docs: ['Bump seed for PDA derivation'];
            type: 'u8';
          }
        ];
      };
    },
    {
      name: 'smartWalletCreated';
      docs: ['Event emitted when a new smart wallet is created'];
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'smartWallet';
            type: 'pubkey';
          },
          {
            name: 'authenticator';
            type: 'pubkey';
          },
          {
            name: 'sequenceId';
            type: 'u64';
          },
          {
            name: 'policyProgram';
            type: 'pubkey';
          },
          {
            name: 'passkeyHash';
            type: {
              array: ['u8', 32];
            };
          },
          {
            name: 'timestamp';
            type: 'i64';
          }
        ];
      };
    },
    {
      name: 'solTransfer';
      docs: ['Event emitted when a SOL transfer occurs'];
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'smartWallet';
            type: 'pubkey';
          },
          {
            name: 'destination';
            type: 'pubkey';
          },
          {
            name: 'amount';
            type: 'u64';
          },
          {
            name: 'nonce';
            type: 'u64';
          },
          {
            name: 'timestamp';
            type: 'i64';
          }
        ];
      };
    },
    {
      name: 'transactionExecuted';
      docs: ['Event emitted when a transaction is executed'];
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'smartWallet';
            type: 'pubkey';
          },
          {
            name: 'authenticator';
            type: 'pubkey';
          },
          {
            name: 'nonce';
            type: 'u64';
          },
          {
            name: 'policyProgram';
            type: 'pubkey';
          },
          {
            name: 'cpiProgram';
            type: 'pubkey';
          },
          {
            name: 'success';
            type: 'bool';
          },
          {
            name: 'timestamp';
            type: 'i64';
          }
        ];
      };
    },
    {
      name: 'transactionSession';
      docs: [
        'Transaction session for deferred execution.',
        'Created after full passkey + policy verification. Contains all bindings',
        'necessary to execute the transaction later without re-verification.'
      ];
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'ownerWallet';
            docs: ['Smart wallet that authorized this session'];
            type: 'pubkey';
          },
          {
            name: 'dataHash';
            docs: ['sha256 of transaction instruction data'];
            type: {
              array: ['u8', 32];
            };
          },
          {
            name: 'accountsHash';
            docs: [
              'sha256 over ordered remaining account metas plus target program'
            ];
            type: {
              array: ['u8', 32];
            };
          },
          {
            name: 'authorizedNonce';
            docs: [
              'The nonce that was authorized at session creation (bound into data hash)'
            ];
            type: 'u64';
          },
          {
            name: 'expiresAt';
            docs: ['Unix expiration timestamp'];
            type: 'i64';
          },
          {
            name: 'rentRefundTo';
            docs: ['Where to refund rent when closing the session'];
            type: 'pubkey';
          }
        ];
      };
    },
    {
      name: 'updateConfigType';
      type: {
        kind: 'enum';
        variants: [
          {
            name: 'createWalletFee';
          },
          {
            name: 'executeFee';
          },
          {
            name: 'defaultPolicyProgram';
          },
          {
            name: 'admin';
          },
          {
            name: 'pauseProgram';
          },
          {
            name: 'unpauseProgram';
          }
        ];
      };
    },
    {
      name: 'updatePolicyArgs';
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'passkeyPubkey';
            type: {
              array: ['u8', 33];
            };
          },
          {
            name: 'signature';
            type: 'bytes';
          },
          {
            name: 'clientDataJsonRaw';
            type: 'bytes';
          },
          {
            name: 'authenticatorDataRaw';
            type: 'bytes';
          },
          {
            name: 'verifyInstructionIndex';
            type: 'u8';
          },
          {
            name: 'splitIndex';
            type: 'u16';
          },
          {
            name: 'destroyPolicyData';
            type: 'bytes';
          },
          {
            name: 'initPolicyData';
            type: 'bytes';
          },
          {
            name: 'newWalletDevice';
            type: {
              option: {
                defined: {
                  name: 'newWalletDeviceArgs';
                };
              };
            };
          }
        ];
      };
    },
    {
      name: 'walletDevice';
      docs: [
        'Account that stores a wallet_device (passkey) used to authenticate to a smart wallet'
      ];
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'passkeyPubkey';
            docs: [
              'The public key of the passkey for this wallet_device that can authorize transactions'
            ];
            type: {
              array: ['u8', 33];
            };
          },
          {
            name: 'smartWallet';
            docs: ['The smart wallet this wallet_device belongs to'];
            type: 'pubkey';
          },
          {
            name: 'credentialId';
            docs: ['The credential ID this wallet_device belongs to'];
            type: 'bytes';
          },
          {
            name: 'bump';
            docs: ['Bump seed for PDA derivation'];
            type: 'u8';
          }
        ];
      };
    }
  ];
};
