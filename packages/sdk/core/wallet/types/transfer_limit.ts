/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/transfer_limit.json`.
 */
export type TransferLimit = {
  "address": "5hr5cYAXKnnfTmxMSvqRgMJzjsHUSyPdvqWtU2kQqxPB",
  "metadata": {
    "name": "transferLimit",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "addMember",
      "discriminator": [
        13,
        116,
        123,
        130,
        126,
        198,
        57,
        34
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "smartWalletAuthenticator",
          "signer": true
        },
        {
          "name": "newSmartWalletAuthenticator"
        },
        {
          "name": "admin",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  109,
                  98,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "smart_wallet_authenticator.smart_wallet",
                "account": "smartWalletAuthenticator"
              },
              {
                "kind": "account",
                "path": "smartWalletAuthenticator"
              }
            ]
          }
        },
        {
          "name": "member",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  109,
                  98,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "smart_wallet_authenticator.smart_wallet",
                "account": "smartWalletAuthenticator"
              },
              {
                "kind": "account",
                "path": "newSmartWalletAuthenticator"
              }
            ]
          }
        },
        {
          "name": "lazorkit",
          "address": "B8borjSNa14VSvweUEQJPJDCYDCQ96u5p8jqf1Ho2txK"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "newPasskeyPubkey",
          "type": {
            "array": [
              "u8",
              33
            ]
          }
        },
        {
          "name": "bump",
          "type": "u8"
        }
      ]
    },
    {
      "name": "checkRule",
      "discriminator": [
        215,
        90,
        220,
        175,
        191,
        212,
        144,
        147
      ],
      "accounts": [
        {
          "name": "smartWalletAuthenticator",
          "signer": true
        },
        {
          "name": "member",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  109,
                  98,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "smart_wallet_authenticator.smart_wallet",
                "account": "smartWalletAuthenticator"
              },
              {
                "kind": "account",
                "path": "smartWalletAuthenticator"
              }
            ]
          }
        },
        {
          "name": "ruleData",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  108,
                  101,
                  95,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "smart_wallet_authenticator.smart_wallet",
                "account": "smartWalletAuthenticator"
              },
              {
                "kind": "arg",
                "path": "token"
              }
            ]
          }
        },
        {
          "name": "lazorkit",
          "address": "B8borjSNa14VSvweUEQJPJDCYDCQ96u5p8jqf1Ho2txK"
        }
      ],
      "args": [
        {
          "name": "token",
          "type": {
            "option": "pubkey"
          }
        },
        {
          "name": "cpiData",
          "type": "bytes"
        },
        {
          "name": "programId",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "initRule",
      "discriminator": [
        129,
        224,
        96,
        169,
        247,
        125,
        74,
        118
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "smartWallet",
          "docs": [
            "CHECK"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
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
                ]
              },
              {
                "kind": "account",
                "path": "smart_wallet_config.id",
                "account": "smartWalletConfig"
              }
            ],
            "program": {
              "kind": "account",
              "path": "lazorkit"
            }
          }
        },
        {
          "name": "member",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  109,
                  98,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "smartWallet"
              },
              {
                "kind": "account",
                "path": "smartWalletAuthenticator"
              }
            ]
          }
        },
        {
          "name": "ruleData",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  117,
                  108,
                  101,
                  95,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "smartWallet"
              },
              {
                "kind": "arg",
                "path": "args.token"
              }
            ]
          }
        },
        {
          "name": "smartWalletConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
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
                ]
              },
              {
                "kind": "account",
                "path": "smartWallet"
              }
            ],
            "program": {
              "kind": "account",
              "path": "lazorkit"
            }
          }
        },
        {
          "name": "smartWalletAuthenticator",
          "signer": true
        },
        {
          "name": "lazorkit",
          "address": "B8borjSNa14VSvweUEQJPJDCYDCQ96u5p8jqf1Ho2txK"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "initRuleArgs",
          "type": {
            "defined": {
              "name": "initRuleArgs"
            }
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "member",
      "discriminator": [
        54,
        19,
        162,
        21,
        29,
        166,
        17,
        198
      ]
    },
    {
      "name": "ruleData",
      "discriminator": [
        158,
        90,
        249,
        157,
        207,
        73,
        93,
        62
      ]
    },
    {
      "name": "smartWalletAuthenticator",
      "discriminator": [
        126,
        36,
        85,
        166,
        77,
        139,
        221,
        129
      ]
    },
    {
      "name": "smartWalletConfig",
      "discriminator": [
        138,
        211,
        3,
        80,
        65,
        100,
        207,
        142
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "memberNotAdmin"
    },
    {
      "code": 6001,
      "name": "invalidNewPasskey"
    },
    {
      "code": 6002,
      "name": "invalidTokenAccount"
    },
    {
      "code": 6003,
      "name": "invalidToken"
    },
    {
      "code": 6004,
      "name": "invalidBalance"
    },
    {
      "code": 6005,
      "name": "invalidTransferAmount"
    },
    {
      "code": 6006,
      "name": "ruleNotInitialized"
    },
    {
      "code": 6007,
      "name": "invalidRuleAccount"
    },
    {
      "code": 6008,
      "name": "invalidAccountInput"
    },
    {
      "code": 6009,
      "name": "unAuthorize"
    },
    {
      "code": 6010,
      "name": "invalidBump"
    },
    {
      "code": 6011,
      "name": "memberNotInitialized"
    },
    {
      "code": 6012,
      "name": "transferAmountExceedLimit"
    }
  ],
  "types": [
    {
      "name": "initRuleArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "passkeyPubkey",
            "type": {
              "array": [
                "u8",
                33
              ]
            }
          },
          {
            "name": "token",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "limitAmount",
            "type": "u64"
          },
          {
            "name": "limitPeriod",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "member",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "memberType",
            "type": {
              "defined": {
                "name": "memberType"
              }
            }
          },
          {
            "name": "smartWallet",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "isInitialized",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "memberType",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "admin"
          },
          {
            "name": "member"
          }
        ]
      }
    },
    {
      "name": "ruleData",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "token",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "limitAmount",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "isInitialized",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "smartWalletAuthenticator",
      "docs": [
        "Account that stores authentication data for a smart wallet"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "passkeyPubkey",
            "docs": [
              "The public key of the passkey that can authorize transactions"
            ],
            "type": {
              "array": [
                "u8",
                33
              ]
            }
          },
          {
            "name": "smartWallet",
            "docs": [
              "The smart wallet this authenticator belongs to"
            ],
            "type": "pubkey"
          },
          {
            "name": "credentialId",
            "docs": [
              "The credential ID this authenticator belongs to"
            ],
            "type": "bytes"
          },
          {
            "name": "bump",
            "docs": [
              "Bump seed for PDA derivation"
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "smartWalletConfig",
      "docs": [
        "Data account for a smart wallet"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "id",
            "docs": [
              "Unique identifier for this smart wallet"
            ],
            "type": "u64"
          },
          {
            "name": "ruleProgram",
            "docs": [
              "Optional rule program that governs this wallet's operations"
            ],
            "type": "pubkey"
          },
          {
            "name": "lastNonce",
            "type": "u64"
          },
          {
            "name": "bump",
            "docs": [
              "Bump seed for PDA derivation"
            ],
            "type": "u8"
          }
        ]
      }
    }
  ]
};
