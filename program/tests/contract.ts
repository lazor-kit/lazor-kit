import * as anchor from '@coral-xyz/anchor';
import ECDSA from 'ecdsa-secp256r1';
import {
  AddressLookupTableProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import dotenv from 'dotenv';
import bs58 from 'bs58';

import { setup } from './raydium-swap/swap';
import { SmartWalletContract } from '../sdk';
import { signAndSendVersionTxn } from '../relayer';

dotenv.config();

let cluster: String;

describe('contract', async () => {
  cluster = 'localnet';
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const anchorProvider = anchor.getProvider() as anchor.AnchorProvider;

  const wallet = Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY!));

  const program = new SmartWalletContract(anchorProvider.connection);

  if (cluster === 'localnet') {
    before(async () => {
      const currentSlot = await anchorProvider.connection.getSlot({
        commitment: 'confirmed',
      });

      const [lookupTableInst, lookupTableAddress] =
        AddressLookupTableProgram.createLookupTable({
          authority: wallet.publicKey,
          payer: wallet.publicKey,
          recentSlot: currentSlot - 1,
        });

      const extendInstruction = AddressLookupTableProgram.extendLookupTable({
        payer: wallet.publicKey,
        authority: wallet.publicKey,
        lookupTable: lookupTableAddress,
        addresses: [
          new PublicKey('3jq9oBWGCUWmBynC8TTBL9KWJdGegsChJ1c8ksybGhum'),
          new PublicKey('Secp256r1SigVerify1111111111111111111111111'),
          new PublicKey('Sysvar1nstructions1111111111111111111111111'),
          new PublicKey('HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8'),
          new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
          new PublicKey('hij78MKbJSSs15qvkHWTDCtnmba2c1W4r1V22g5sD8w'),
          SystemProgram.programId,
        ],
      });

      await anchorProvider.sendAndConfirm(
        new Transaction().add(lookupTableInst)
      );

      await anchorProvider.sendAndConfirm(
        new Transaction().add(extendInstruction)
      );

      program.setLookupTableAddress(lookupTableAddress);

      console.log('Lookup table address', lookupTableAddress.toBase58());
    });
  }

  xit('Init smart-wallet', async () => {
    const privateKey = ECDSA.generateKey();

    const publicKeyBase64 = privateKey.toCompressedPublicKey();

    const pubkey = Array.from(Buffer.from(publicKeyBase64, 'base64'));

    const txn = await program.createInitSmartWalletTransaction({
      secp256r1PubkeyBytes: pubkey,
      payer: wallet.publicKey,
    });

    const sig = await anchorProvider.sendAndConfirm(txn, [wallet]);

    console.log('Init smart-wallet', sig);
  });

  xit('Verify and execute transfer token instruction', async () => {
    // create smart wallet
    const privateKey = ECDSA.generateKey();
    const publicKeyBase64 = privateKey.toCompressedPublicKey();
    const pubkey = Buffer.from(publicKeyBase64, 'base64');

    const createWalletSig = await anchorProvider.sendAndConfirm(
      await program.createInitSmartWalletTransaction({
        secp256r1PubkeyBytes: Array.from(pubkey),
        payer: wallet.publicKey,
      }),
      [wallet]
    );

    console.log('Create smart wallet', createWalletSig);

    const listSmartWalletAuthority =
      await program.getListSmartWalletAuthorityByPasskeyPubkey({
        data: Array.from(pubkey),
      });

    const smartWalletAuthority = listSmartWalletAuthority[0];

    const smartWalletAuthorityData = await program.getSmartWalletAuthorityData(
      smartWalletAuthority
    );

    const smartWalletPubkey = smartWalletAuthorityData.smartWalletPubkey;

    console.log('Smart wallet pubkey', smartWalletPubkey.toBase58());

    const swapIns = await setup({
      smartWalletPubkey,
      wallet,
      anchorProvider,
    });

    const { message, messageBytes } = await program.getMessage(
      smartWalletAuthorityData
    );

    const signatureBase64 = privateKey.sign(messageBytes);

    let signature = Buffer.from(signatureBase64, 'base64');

    const txn = await program.createVerifyAndExecuteTransaction({
      arbitraryInstruction: swapIns,
      pubkey: pubkey,
      signature: signature,
      message,
      payer: wallet.publicKey,
      smartWalletPubkey,
      smartWalletAuthority,
    });

    txn.sign([wallet]);

    const result = await anchorProvider.connection.sendTransaction(txn, {
      preflightCommitment: 'confirmed',
    });

    // const result = await signAndSendVersionTxn({
    //   base58EncodedTransaction: bs58.encode(txn.serialize()),
    //   relayerUrl: process.env.RELAYER_URL!,
    // });

    console.log(result);
  });

  it('Add authenticators', async () => {
    // create smart wallet
    const privateKey = ECDSA.generateKey();
    const publicKeyBase64 = privateKey.toCompressedPublicKey();
    const pubkey = Buffer.from(publicKeyBase64, 'base64');

    const createWalletSig = await anchorProvider.sendAndConfirm(
      await program.createInitSmartWalletTransaction({
        secp256r1PubkeyBytes: Array.from(pubkey),
        payer: wallet.publicKey,
      }),
      [wallet]
    );

    console.log('Create smart wallet: ', createWalletSig);

    const listSmartWalletAuthority =
      await program.getListSmartWalletAuthorityByPasskeyPubkey({
        data: Array.from(pubkey),
      });

    const smartWalletAuthority = listSmartWalletAuthority[0];

    const smartWalletAuthorityData = await program.getSmartWalletAuthorityData(
      smartWalletAuthority
    );

    const smartWalletPubkey = smartWalletAuthorityData.smartWalletPubkey;

    console.log('Smart wallet pubkey', smartWalletPubkey.toBase58());

    const newPasskeyPubkey = Buffer.from(
      ECDSA.generateKey().toCompressedPublicKey(),
      'base64'
    );

    const { message, messageBytes } = await program.getMessage(
      smartWalletAuthorityData
    );

    const signatureBase64 = privateKey.sign(messageBytes);

    let signature = Buffer.from(signatureBase64, 'base64');

    const txn = await program.addAuthenticatorsTxn({
      pubkey: pubkey,
      signature: signature,
      message,
      newPasskey: { data: Array.from(newPasskeyPubkey) },
      payer: wallet.publicKey,
      smartWalletPubkey,
      smartWalletAuthority,
    });

    txn.sign([wallet]);
    const result = await anchorProvider.connection.sendTransaction(txn, {
      preflightCommitment: 'confirmed',
    });

    console.log('Add authenticators', result);

    // await signAndSendVersionedTransaction({
    //   serializedTransaction: txn.serialize(),
    //   connection: anchorProvider.connection,
    // });
  });
});
