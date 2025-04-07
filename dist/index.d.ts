import { PublicKey, TransactionInstruction, Connection, Transaction, VersionedTransaction } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { Buffer as Buffer$1 } from 'buffer';
import React from 'react';

/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/contract.json`.
 */
type Contract = {
    "address": "9mpMEhW6GBEFbjiXgPCrC9TyG1BeUQaxJGQrrsQWSU4N";
    "metadata": {
        "name": "contract";
        "version": "0.1.0";
        "spec": "0.1.0";
        "description": "Created with Anchor";
    };
    "instructions": [
        {
            "name": "addAuthenticator";
            "discriminator": [
                131,
                241,
                96,
                145,
                76,
                194,
                212,
                203
            ];
            "accounts": [
                {
                    "name": "payer";
                    "writable": true;
                    "signer": true;
                },
                {
                    "name": "ixSysvar";
                    "address": "Sysvar1nstructions1111111111111111111111111";
                },
                {
                    "name": "smartWallet";
                    "writable": true;
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
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
                                ];
                            },
                            {
                                "kind": "account";
                                "path": "smart_wallet_data.id";
                                "account": "smartWalletData";
                            }
                        ];
                    };
                },
                {
                    "name": "smartWalletData";
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
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
                                ];
                            },
                            {
                                "kind": "account";
                                "path": "smartWallet";
                            }
                        ];
                    };
                },
                {
                    "name": "smartWalletAuthority";
                    "writable": true;
                    "pda": {
                        "seeds": [
                            {
                                "kind": "arg";
                                "path": "verify_param.pubkey.to_hashed_bytes(smart_wallet";
                            }
                        ];
                    };
                },
                {
                    "name": "newWalletAuthority";
                    "writable": true;
                    "pda": {
                        "seeds": [
                            {
                                "kind": "arg";
                                "path": "new_passkey.to_hashed_bytes(smart_wallet";
                            }
                        ];
                    };
                },
                {
                    "name": "systemProgram";
                    "address": "11111111111111111111111111111111";
                }
            ];
            "args": [
                {
                    "name": "verifyParam";
                    "type": {
                        "defined": {
                            "name": "verifyParam";
                        };
                    };
                },
                {
                    "name": "newPasskeyPubkey";
                    "type": {
                        "defined": {
                            "name": "passkeyPubkey";
                        };
                    };
                }
            ];
        },
        {
            "name": "executeInstruction";
            "discriminator": [
                48,
                18,
                40,
                40,
                75,
                74,
                147,
                110
            ];
            "accounts": [
                {
                    "name": "ixSysvar";
                    "docs": [
                        "the supplied Sysvar could be anything else.",
                        "The Instruction Sysvar has not been implemented",
                        "in the Anchor framework yet, so this is the safe approach."
                    ];
                    "address": "Sysvar1nstructions1111111111111111111111111";
                },
                {
                    "name": "smartWallet";
                    "writable": true;
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
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
                                ];
                            },
                            {
                                "kind": "account";
                                "path": "smart_wallet_data.id";
                                "account": "smartWalletData";
                            }
                        ];
                    };
                },
                {
                    "name": "smartWalletData";
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
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
                                ];
                            },
                            {
                                "kind": "account";
                                "path": "smartWallet";
                            }
                        ];
                    };
                },
                {
                    "name": "smartWalletAuthority";
                    "writable": true;
                    "pda": {
                        "seeds": [
                            {
                                "kind": "arg";
                                "path": "verify_param.pubkey.to_hashed_bytes(smart_wallet";
                            }
                        ];
                    };
                },
                {
                    "name": "cpiProgram";
                }
            ];
            "args": [
                {
                    "name": "verifyParam";
                    "type": {
                        "defined": {
                            "name": "verifyParam";
                        };
                    };
                },
                {
                    "name": "instructionData";
                    "type": "bytes";
                }
            ];
        },
        {
            "name": "initSmartWallet";
            "discriminator": [
                229,
                38,
                158,
                24,
                6,
                73,
                94,
                101
            ];
            "accounts": [
                {
                    "name": "signer";
                    "writable": true;
                    "signer": true;
                },
                {
                    "name": "smartWallet";
                    "writable": true;
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
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
                                ];
                            },
                            {
                                "kind": "arg";
                                "path": "id";
                            }
                        ];
                    };
                },
                {
                    "name": "smartWalletData";
                    "writable": true;
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
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
                                ];
                            },
                            {
                                "kind": "account";
                                "path": "smartWallet";
                            }
                        ];
                    };
                },
                {
                    "name": "smartWalletAuthority";
                    "writable": true;
                    "pda": {
                        "seeds": [
                            {
                                "kind": "arg";
                                "path": "pubkey.to_hashed_bytes(smart_wallet";
                            }
                        ];
                    };
                },
                {
                    "name": "systemProgram";
                    "address": "11111111111111111111111111111111";
                }
            ];
            "args": [
                {
                    "name": "pubkey";
                    "type": {
                        "defined": {
                            "name": "passkeyPubkey";
                        };
                    };
                },
                {
                    "name": "id";
                    "type": "u64";
                }
            ];
        }
    ];
    "accounts": [
        {
            "name": "smartWalletAuthority";
            "discriminator": [
                164,
                179,
                94,
                28,
                254,
                200,
                86,
                148
            ];
        },
        {
            "name": "smartWalletData";
            "discriminator": [
                124,
                86,
                202,
                243,
                63,
                150,
                66,
                22
            ];
        }
    ];
    "errors": [
        {
            "code": 6000;
            "name": "sigVerificationFailed";
            "msg": "Signature verification failed.";
        },
        {
            "code": 6001;
            "name": "tooManyPubkey";
            "msg": "Too many public keys.";
        },
        {
            "code": 6002;
            "name": "invalidMessage";
            "msg": "Invalid message.";
        },
        {
            "code": 6003;
            "name": "invalidPubkey";
            "msg": "Invalid pubkey.";
        },
        {
            "code": 6004;
            "name": "signatureExpired";
            "msg": "Signature is expired.";
        },
        {
            "code": 6005;
            "name": "invalidNonce";
            "msg": "Invalid Nonce";
        },
        {
            "code": 6006;
            "name": "invalidTimestamp";
            "msg": "Invalid Timestamp.";
        }
    ];
    "types": [
        {
            "name": "message";
            "type": {
                "kind": "struct";
                "fields": [
                    {
                        "name": "nonce";
                        "type": "u64";
                    },
                    {
                        "name": "timestamp";
                        "type": "i64";
                    }
                ];
            };
        },
        {
            "name": "passkeyPubkey";
            "type": {
                "kind": "struct";
                "fields": [
                    {
                        "name": "data";
                        "type": {
                            "array": [
                                "u8",
                                33
                            ];
                        };
                    }
                ];
            };
        },
        {
            "name": "smartWalletAuthority";
            "type": {
                "kind": "struct";
                "fields": [
                    {
                        "name": "pubkey";
                        "type": {
                            "defined": {
                                "name": "passkeyPubkey";
                            };
                        };
                    },
                    {
                        "name": "smartWalletPubkey";
                        "type": "pubkey";
                    },
                    {
                        "name": "nonce";
                        "type": "u64";
                    }
                ];
            };
        },
        {
            "name": "smartWalletData";
            "type": {
                "kind": "struct";
                "fields": [
                    {
                        "name": "bump";
                        "type": "u8";
                    },
                    {
                        "name": "id";
                        "type": "u64";
                    }
                ];
            };
        },
        {
            "name": "verifyParam";
            "type": {
                "kind": "struct";
                "fields": [
                    {
                        "name": "pubkey";
                        "type": {
                            "defined": {
                                "name": "passkeyPubkey";
                            };
                        };
                    },
                    {
                        "name": "msg";
                        "type": {
                            "defined": {
                                "name": "message";
                            };
                        };
                    },
                    {
                        "name": "sig";
                        "type": {
                            "array": [
                                "u8",
                                64
                            ];
                        };
                    }
                ];
            };
        }
    ];
};

type Message = anchor.IdlTypes<Contract>['message'];
type VerifyParam = anchor.IdlTypes<Contract>['verifyParam'];
type PasskeyPubkey = anchor.IdlTypes<Contract>['passkeyPubkey'];
type SmartWalletAuthority = anchor.IdlTypes<Contract>['smartWalletAuthority'];
type CreateVerifyAndExecuteTransactionParam = {
    arbitraryInstruction: TransactionInstruction;
    pubkey: Buffer<ArrayBuffer>;
    signature: Buffer<ArrayBuffer>;
    message: Message;
    payer: PublicKey;
    smartWalletPubkey: PublicKey;
    smartWalletAuthority: PublicKey;
};
type CreateInitSmartWalletTransactionParam = {
    secp256r1PubkeyBytes: number[];
    payer: PublicKey;
};
type AddAuthenticatorsParam = {
    pubkey: Buffer<ArrayBuffer>;
    signature: Buffer<ArrayBuffer>;
    message: Message;
    payer: PublicKey;
    newPasskey: PasskeyPubkey;
    smartWalletPubkey: PublicKey;
    smartWalletAuthority: PublicKey;
};

declare class SmartWalletContract {
    private readonly connection;
    constructor(connection: Connection);
    private lookupTableAddress;
    get program(): anchor.Program<Contract>;
    get programId(): PublicKey;
    getListSmartWalletAuthorityByPasskeyPubkey(authority: PasskeyPubkey): Promise<PublicKey[]>;
    getSmartWalletAuthorityData(smartWalletAuthorityPubkey: PublicKey): Promise<SmartWalletAuthority>;
    getMessage(smartWalletAuthorityData: SmartWalletAuthority): Promise<{
        message: Message;
        messageBytes: Buffer<ArrayBufferLike>;
    }>;
    createInitSmartWalletTransaction(param: CreateInitSmartWalletTransactionParam): Promise<Transaction>;
    createVerifyAndExecuteTransaction(params: CreateVerifyAndExecuteTransactionParam): Promise<VersionedTransaction>;
    addAuthenticatorsTxn(param: AddAuthenticatorsParam): Promise<VersionedTransaction>;
    setLookupTableAddress(lookupTableAddress: PublicKey): Promise<void>;
    hashSeeds(passkey: number[], smartWallet: PublicKey): Buffer;
}

declare const SMART_WALLET_SEED: Buffer$1<ArrayBuffer>;
declare const SECP256R1_NATIVE_PROGRAM: PublicKey;
declare const LOOKUP_TABLE_ADDRESS: PublicKey;

declare function createSecp256r1Instruction(message: Uint8Array, pubkey: Buffer<ArrayBuffer>, signature: Buffer<ArrayBuffer>): TransactionInstruction;
declare function getID(): number;

interface LazorConnectProps {
    onSignMessage?: (base64Tx: string) => Promise<void>;
}
declare const LazorConnect: React.FC<LazorConnectProps>;

declare const useWallet: () => {
    connect: () => Promise<void>;
    disconnect: () => void;
    signMessage: (base64Tx: string) => Promise<unknown>;
    credentialId: string | null;
    publicKey: PublicKey | null;
    isConnected: boolean;
    isLoading: boolean;
    error: string | null;
};

declare const useSmartWallet: () => {
    smartWalletAddress: string | null;
    isLoading: boolean;
    error: string | null;
    createSmartWallet: () => Promise<void>;
};

export { LOOKUP_TABLE_ADDRESS, LazorConnect, SECP256R1_NATIVE_PROGRAM, SMART_WALLET_SEED, SmartWalletContract, createSecp256r1Instruction, getID, useSmartWallet, useWallet };
export type { AddAuthenticatorsParam, CreateInitSmartWalletTransactionParam, CreateVerifyAndExecuteTransactionParam, Message, PasskeyPubkey, SmartWalletAuthority, VerifyParam };
