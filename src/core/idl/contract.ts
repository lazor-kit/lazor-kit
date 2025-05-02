/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/contract.json`.
 */
export type Contract = {
  "address": "7A4H6t6GfKjQv5xHka66PDfnWAFuon62Jv6fceGcjQZc",
  "metadata": {
    "name": "contract",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
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
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "pubkey",
          "type": {
            "array": [
              "u8",
              33
            ]
          }
        },
        {
          "name": "id",
          "type": "u64"
        }
      ]
    },
    {
      "name": "verifyAndExecuteInstruction",
      "discriminator": [
        176,
        115,
        52,
        53,
        201,
        172,
        69,
        70
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
          "writable": true
        },
        {
          "name": "cpiProgram"
        }
      ],
      "args": [
        {
          "name": "pubkey",
          "type": {
            "array": [
              "u8",
              33
            ]
          }
        },
        {
          "name": "msg",
          "type": "bytes"
        },
        {
          "name": "sig",
          "type": {
            "array": [
              "u8",
              64
            ]
          }
        },
        {
          "name": "data",
          "type": "bytes"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "smartWallet",
      "discriminator": [
        67,
        59,
        220,
        179,
        41,
        10,
        60,
        177
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
      "name": "invalidPubkey",
      "msg": "Invalid pubkey."
    }
  ],
  "types": [
    {
      "name": "smartWallet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "creator",
            "type": {
              "array": [
                "u8",
                33
              ]
            }
          },
          {
            "name": "authority",
            "type": {
              "vec": {
                "array": [
                  "u8",
                  33
                ]
              }
            }
          },
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
