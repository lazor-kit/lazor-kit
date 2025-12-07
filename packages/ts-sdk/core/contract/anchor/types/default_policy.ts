/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/default_policy.json`.
 */
export type DefaultPolicy = {
  "address": "BiE9vSdz9MidUiyjVYsu3PG4C1fbPZ8CVPADA9jRfXw7",
  "metadata": {
    "name": "defaultPolicy",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "checkPolicy",
      "discriminator": [
        28,
        88,
        170,
        179,
        239,
        136,
        25,
        35
      ],
      "accounts": [
        {
          "name": "policySigner",
          "signer": true
        },
        {
          "name": "smartWallet"
        }
      ],
      "args": [
        {
          "name": "walletId",
          "type": "u64"
        },
        {
          "name": "passkeyPublicKey",
          "type": {
            "array": [
              "u8",
              33
            ]
          }
        },
        {
          "name": "credentialHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "policyData",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "initPolicy",
      "discriminator": [
        45,
        234,
        110,
        100,
        209,
        146,
        191,
        86
      ],
      "accounts": [
        {
          "name": "policySigner",
          "signer": true
        },
        {
          "name": "smartWallet",
          "writable": true
        },
        {
          "name": "walletState",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "walletId",
          "type": "u64"
        },
        {
          "name": "passkeyPublicKey",
          "type": {
            "array": [
              "u8",
              33
            ]
          }
        },
        {
          "name": "credentialHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ],
      "returns": {
        "defined": {
          "name": "policyStruct"
        }
      }
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidPasskey",
      "msg": "Invalid passkey format"
    },
    {
      "code": 6001,
      "name": "unauthorized",
      "msg": "Unauthorized to access smart wallet"
    }
  ],
  "types": [
    {
      "name": "deviceSlot",
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
            "name": "credentialHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "policyStruct",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "smartWallet",
            "type": "pubkey"
          },
          {
            "name": "deviceSlots",
            "type": {
              "vec": {
                "defined": {
                  "name": "deviceSlot"
                }
              }
            }
          }
        ]
      }
    }
  ]
};
