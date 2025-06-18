/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/lazorkit.json`.
 */
export type Lazorkit = {
  address: '6Jh4kA4rkZquv9XofKqgbyrRcTDF19uM5HL4xyh6gaSo';
  metadata: {
    name: 'lazorkit';
    version: '0.1.0';
    spec: '0.1.0';
    description: 'Created with Anchor';
  };
  docs: ['The Lazor Kit program provides smart wallet functionality with passkey authentication'];
  instructions: [
    {
      name: 'createSmartWallet';
      docs: ['Create a new smart wallet with passkey authentication'];
      discriminator: [129, 39, 235, 18, 132, 68, 203, 19];
      accounts: [
        {
          name: 'signer';
          writable: true;
          signer: true;
        },
        {
          name: 'smartWalletSeq';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [115, 109, 97, 114, 116, 95, 119, 97, 108, 108, 101, 116, 95, 115, 101, 113];
              }
            ];
          };
        },
        {
          name: 'whitelistRulePrograms';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  119,
                  104,
                  105,
                  116,
                  101,
                  108,
                  105,
                  115,
                  116,
                  95,
                  114,
                  117,
                  108,
                  101,
                  95,
                  112,
                  114,
                  111,
                  103,
                  114,
                  97,
                  109,
                  115
                ];
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
                value: [115, 109, 97, 114, 116, 95, 119, 97, 108, 108, 101, 116];
              },
              {
                kind: 'account';
                path: 'smart_wallet_seq.seq';
                account: 'smartWalletSeq';
              }
            ];
          };
        },
        {
          name: 'smartWalletConfig';
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
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
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
          name: 'smartWalletAuthenticator';
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
                  97,
                  117,
                  116,
                  104,
                  101,
                  110,
                  116,
                  105,
                  99,
                  97,
                  116,
                  111,
                  114
                ];
              },
              {
                kind: 'account';
                path: 'smartWallet';
              },
              {
                kind: 'arg';
                path: 'passkey_pubkey.to_hashed_bytes(smart_wallet';
              }
            ];
          };
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
          name: 'defaultRuleProgram';
        },
        {
          name: 'systemProgram';
          address: '11111111111111111111111111111111';
        }
      ];
      args: [
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
          name: 'ruleData';
          type: 'bytes';
        }
      ];
    },
    {
      name: 'executeInstruction';
      docs: ['Execute an instruction with passkey authentication'];
      discriminator: [48, 18, 40, 40, 75, 74, 147, 110];
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
                value: [115, 109, 97, 114, 116, 95, 119, 97, 108, 108, 101, 116];
              },
              {
                kind: 'account';
                path: 'smart_wallet_config.id';
                account: 'smartWalletConfig';
              }
            ];
          };
        },
        {
          name: 'smartWalletConfig';
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
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
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
          name: 'smartWalletAuthenticator';
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
                  97,
                  117,
                  116,
                  104,
                  101,
                  110,
                  116,
                  105,
                  99,
                  97,
                  116,
                  111,
                  114
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
          name: 'whitelistRulePrograms';
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  119,
                  104,
                  105,
                  116,
                  101,
                  108,
                  105,
                  115,
                  116,
                  95,
                  114,
                  117,
                  108,
                  101,
                  95,
                  112,
                  114,
                  111,
                  103,
                  114,
                  97,
                  109,
                  115
                ];
              }
            ];
          };
        },
        {
          name: 'authenticatorProgram';
        },
        {
          name: 'ixSysvar';
          address: 'Sysvar1nstructions1111111111111111111111111';
        },
        {
          name: 'systemProgram';
          address: '11111111111111111111111111111111';
        },
        {
          name: 'cpiProgram';
        },
        {
          name: 'newSmartWalletAuthenticator';
          writable: true;
          optional: true;
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
                  97,
                  117,
                  116,
                  104,
                  101,
                  110,
                  116,
                  105,
                  99,
                  97,
                  116,
                  111,
                  114
                ];
              },
              {
                kind: 'account';
                path: 'smartWallet';
              },
              {
                kind: 'arg';
                path: 'args.create_new_authenticator.unwrap_or([0;\n33]).to_hashed_bytes(smart_wallet';
              }
            ];
          };
        }
      ];
      args: [
        {
          name: 'args';
          type: {
            defined: {
              name: 'executeInstructionArgs';
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
          writable: true;
          signer: true;
        },
        {
          name: 'config';
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
          name: 'whitelistRulePrograms';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  119,
                  104,
                  105,
                  116,
                  101,
                  108,
                  105,
                  115,
                  116,
                  95,
                  114,
                  117,
                  108,
                  101,
                  95,
                  112,
                  114,
                  111,
                  103,
                  114,
                  97,
                  109,
                  115
                ];
              }
            ];
          };
        },
        {
          name: 'smartWalletSeq';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [115, 109, 97, 114, 116, 95, 119, 97, 108, 108, 101, 116, 95, 115, 101, 113];
              }
            ];
          };
        },
        {
          name: 'defaultRuleProgram';
        },
        {
          name: 'systemProgram';
          address: '11111111111111111111111111111111';
        }
      ];
      args: [];
    },
    {
      name: 'upsertWhitelistRulePrograms';
      docs: ['Update the list of whitelisted rule programs'];
      discriminator: [41, 238, 96, 66, 217, 254, 156, 163];
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
          name: 'whitelistRulePrograms';
          writable: true;
          pda: {
            seeds: [
              {
                kind: 'const';
                value: [
                  119,
                  104,
                  105,
                  116,
                  101,
                  108,
                  105,
                  115,
                  116,
                  95,
                  114,
                  117,
                  108,
                  101,
                  95,
                  112,
                  114,
                  111,
                  103,
                  114,
                  97,
                  109,
                  115
                ];
              }
            ];
          };
        }
      ];
      args: [
        {
          name: 'programId';
          type: 'pubkey';
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
      name: 'smartWalletAuthenticator';
      discriminator: [126, 36, 85, 166, 77, 139, 221, 129];
    },
    {
      name: 'smartWalletConfig';
      discriminator: [138, 211, 3, 80, 65, 100, 207, 142];
    },
    {
      name: 'smartWalletSeq';
      discriminator: [12, 192, 82, 50, 253, 49, 195, 84];
    },
    {
      name: 'whitelistRulePrograms';
      discriminator: [234, 147, 45, 188, 65, 212, 154, 241];
    }
  ];
  errors: [
    {
      code: 6000;
      name: 'invalidPasskey';
      msg: 'Invalid passkey provided';
    },
    {
      code: 6001;
      name: 'invalidAuthenticator';
      msg: 'Invalid authenticator for smart wallet';
    },
    {
      code: 6002;
      name: 'invalidRuleProgram';
      msg: 'Invalid rule program for operation';
    },
    {
      code: 6003;
      name: 'invalidLengthForVerification';
      msg: 'Invalid instruction length for signature verification';
    },
    {
      code: 6004;
      name: 'verifyHeaderMismatchError';
      msg: 'Signature header verification failed';
    },
    {
      code: 6005;
      name: 'verifyDataMismatchError';
      msg: 'Signature data verification failed';
    },
    {
      code: 6006;
      name: 'invalidBump';
      msg: 'Invalid bump seed provided';
    },
    {
      code: 6007;
      name: 'invalidAccountInput';
      msg: 'Invalid or missing required account';
    },
    {
      code: 6008;
      name: 'insufficientFunds';
    },
    {
      code: 6009;
      name: 'invalidRuleInstruction';
      msg: 'Invalid rule instruction provided';
    },
    {
      code: 6010;
      name: 'invalidTimestamp';
    },
    {
      code: 6011;
      name: 'invalidNonce';
    }
  ];
  types: [
    {
      name: 'action';
      docs: ['Enum for supported actions in the instruction'];
      type: {
        kind: 'enum';
        variants: [
          {
            name: 'executeCpi';
          },
          {
            name: 'changeProgramRule';
          },
          {
            name: 'checkAuthenticator';
          },
          {
            name: 'callRuleProgram';
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
            name: 'defaultRuleProgram';
            type: 'pubkey';
          }
        ];
      };
    },
    {
      name: 'cpiData';
      docs: ['Data for a CPI call (instruction data and account slice)'];
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'data';
            type: 'bytes';
          },
          {
            name: 'startIndex';
            type: 'u8';
          },
          {
            name: 'length';
            type: 'u8';
          }
        ];
      };
    },
    {
      name: 'executeInstructionArgs';
      docs: ['Arguments for the execute_instruction entrypoint'];
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
            name: 'ruleData';
            type: {
              defined: {
                name: 'cpiData';
              };
            };
          },
          {
            name: 'cpiData';
            type: {
              option: {
                defined: {
                  name: 'cpiData';
                };
              };
            };
          },
          {
            name: 'action';
            type: {
              defined: {
                name: 'action';
              };
            };
          },
          {
            name: 'createNewAuthenticator';
            type: {
              option: {
                array: ['u8', 33];
              };
            };
          }
        ];
      };
    },
    {
      name: 'smartWalletAuthenticator';
      docs: ['Account that stores authentication data for a smart wallet'];
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'passkeyPubkey';
            docs: ['The public key of the passkey that can authorize transactions'];
            type: {
              array: ['u8', 33];
            };
          },
          {
            name: 'smartWallet';
            docs: ['The smart wallet this authenticator belongs to'];
            type: 'pubkey';
          },
          {
            name: 'credentialId';
            docs: ['The credential ID this authenticator belongs to'];
            type: 'bytes';
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
      name: 'smartWalletConfig';
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
            name: 'ruleProgram';
            docs: ["Optional rule program that governs this wallet's operations"];
            type: 'pubkey';
          },
          {
            name: 'lastNonce';
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
      name: 'smartWalletSeq';
      docs: ['Account that maintains the sequence number for smart wallet creation'];
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'seq';
            docs: ['Current sequence number, incremented for each new smart wallet'];
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
      name: 'whitelistRulePrograms';
      docs: ['Account that stores whitelisted rule program addresses'];
      type: {
        kind: 'struct';
        fields: [
          {
            name: 'list';
            docs: ['List of whitelisted program addresses'];
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
    }
  ];
};