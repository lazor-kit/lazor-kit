/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/contract.json`.
 */
export type Contract = {
  "address": "2QksvXeAbUtk8JR4ZxKxLGoASphVS7A4RtnrUUzXgMVU",
  "metadata": {
    "name": "contract",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "addAuthenticator",
      "discriminator": [
        131,
        241,
        96,
        145,
        76,
        194,
        212,
        203
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "ixSysvar",
          "address": "Sysvar1nstructions1111111111111111111111111"
        },
        {
          "name": "smartWallet",
          "writable": true,
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
                "path": "smart_wallet_data.id",
                "account": "smartWalletData"
              }
            ]
          }
        },
        {
          "name": "smartWalletData",
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
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "smartWallet"
              }
            ]
          }
        },
        {
          "name": "smartWalletAuthority",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "arg",
                "path": "verify_param.pubkey.to_hashed_bytes(smart_wallet"
              }
            ]
          }
        },
        {
          "name": "newWalletAuthority",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "arg",
                "path": "new_passkey.to_hashed_bytes(smart_wallet"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "verifyParam",
          "type": {
            "defined": {
              "name": "verifyParam"
            }
          }
        },
        {
          "name": "newPasskeyPubkey",
          "type": {
            "defined": {
              "name": "passkeyPubkey"
            }
          }
        }
      ]
    },
    {
      "name": "executeInstruction",
      "discriminator": [
        48,
        18,
        40,
        40,
        75,
        74,
        147,
        110
      ],
      "accounts": [
        {
          "name": "ixSysvar",
          "docs": [
            "the supplied Sysvar could be anything else.",
            "The Instruction Sysvar has not been implemented",
            "in the Anchor framework yet, so this is the safe approach."
          ],
          "address": "Sysvar1nstructions1111111111111111111111111"
        },
        {
          "name": "smartWallet",
          "writable": true,
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
                "path": "smart_wallet_data.id",
                "account": "smartWalletData"
              }
            ]
          }
        },
        {
          "name": "smartWalletData",
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
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "smartWallet"
              }
            ]
          }
        },
        {
          "name": "smartWalletAuthority",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "arg",
                "path": "verify_param.pubkey.to_hashed_bytes(smart_wallet"
              }
            ]
          }
        },
        {
          "name": "cpiProgram"
        }
      ],
      "args": [
        {
          "name": "verifyParam",
          "type": {
            "defined": {
              "name": "verifyParam"
            }
          }
        },
        {
          "name": "instructionData",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "initSmartWallet",
      "discriminator": [
        229,
        38,
        158,
        24,
        6,
        73,
        94,
        101
      ],
      "accounts": [
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "smartWallet",
          "writable": true,
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
                "kind": "arg",
                "path": "id"
              }
            ]
          }
        },
        {
          "name": "smartWalletData",
          "writable": true,
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
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "smartWallet"
              }
            ]
          }
        },
        {
          "name": "smartWalletAuthority",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "arg",
                "path": "pubkey.to_hashed_bytes(smart_wallet"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "pubkey",
          "type": {
            "defined": {
              "name": "passkeyPubkey"
            }
          }
        },
        {
          "name": "id",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "smartWalletAuthority",
      "discriminator": [
        164,
        179,
        94,
        28,
        254,
        200,
        86,
        148
      ]
    },
    {
      "name": "smartWalletData",
      "discriminator": [
        124,
        86,
        202,
        243,
        63,
        150,
        66,
        22
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "sigVerificationFailed",
      "msg": "Signature verification failed."
    },
    {
      "code": 6001,
      "name": "tooManyPubkey",
      "msg": "Too many public keys."
    },
    {
      "code": 6002,
      "name": "invalidMessage",
      "msg": "Invalid message."
    },
    {
      "code": 6003,
      "name": "invalidPubkey",
      "msg": "Invalid pubkey."
    },
    {
      "code": 6004,
      "name": "signatureExpired",
      "msg": "Signature is expired."
    },
    {
      "code": 6005,
      "name": "invalidNonce",
      "msg": "Invalid Nonce"
    },
    {
      "code": 6006,
      "name": "invalidTimestamp",
      "msg": "Invalid Timestamp."
    }
  ],
  "types": [
    {
      "name": "message",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "passkeyPubkey",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "data",
            "type": {
              "array": [
                "u8",
                33
              ]
            }
          }
        ]
      }
    },
    {
      "name": "smartWalletAuthority",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pubkey",
            "type": {
              "defined": {
                "name": "passkeyPubkey"
              }
            }
          },
          {
            "name": "smartWalletPubkey",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "smartWalletData",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "id",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "verifyParam",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pubkey",
            "type": {
              "defined": {
                "name": "passkeyPubkey"
              }
            }
          },
          {
            "name": "msg",
            "type": {
              "defined": {
                "name": "message"
              }
            }
          },
          {
            "name": "sig",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          }
        ]
      }
    }
  ]
};
