import * as anchor from '@coral-xyz/anchor';
import { sha256 } from 'js-sha256';
import { instructionToAccountMetas } from './utils';
import { Buffer } from 'buffer';

const coder: anchor.BorshCoder = (() => {
  const idl: any = {
    version: '0.1.0',
    name: 'lazorkit_msgs',
    instructions: [],
    accounts: [],
    types: [
      {
        name: 'ExecuteMessage',
        type: {
          kind: 'struct',
          fields: [
            { name: 'nonce', type: 'u64' },
            { name: 'currentTimestamp', type: 'i64' },
            { name: 'policyDataHash', type: { array: ['u8', 32] } },
            { name: 'policyAccountsHash', type: { array: ['u8', 32] } },
            { name: 'cpiDataHash', type: { array: ['u8', 32] } },
            { name: 'cpiAccountsHash', type: { array: ['u8', 32] } },
          ],
        },
      },
      {
        name: 'InvokePolicyMessage',
        type: {
          kind: 'struct',
          fields: [
            { name: 'nonce', type: 'u64' },
            { name: 'currentTimestamp', type: 'i64' },
            { name: 'policyDataHash', type: { array: ['u8', 32] } },
            { name: 'policyAccountsHash', type: { array: ['u8', 32] } },
          ],
        },
      },
      {
        name: 'UpdatePolicyMessage',
        type: {
          kind: 'struct',
          fields: [
            { name: 'nonce', type: 'u64' },
            { name: 'currentTimestamp', type: 'i64' },
            { name: 'oldPolicyDataHash', type: { array: ['u8', 32] } },
            { name: 'oldPolicyAccountsHash', type: { array: ['u8', 32] } },
            { name: 'newPolicyDataHash', type: { array: ['u8', 32] } },
            { name: 'newPolicyAccountsHash', type: { array: ['u8', 32] } },
          ],
        },
      },
    ],
  };
  return new anchor.BorshCoder(idl);
})();

function computeAccountsHash(
  programId: anchor.web3.PublicKey,
  metas: anchor.web3.AccountMeta[],
  smartWallet: anchor.web3.PublicKey
): Uint8Array {
  const h = sha256.create();
  h.update(programId.toBytes());
  for (const m of metas) {
    h.update(m.pubkey.toBytes());
    h.update(Uint8Array.from([m.isSigner ? 1 : 0]));
    h.update(
      Uint8Array.from([
        m.pubkey.toString() === smartWallet.toString() || m.isWritable ? 1 : 0,
      ])
    );
  }
  return new Uint8Array(h.arrayBuffer());
}

export function buildExecuteMessage(
  payer: anchor.web3.PublicKey,
  smartWallet: anchor.web3.PublicKey,
  nonce: anchor.BN,
  now: anchor.BN,
  policyIns: anchor.web3.TransactionInstruction,
  cpiIns: anchor.web3.TransactionInstruction
): Buffer {
  const policyMetas = instructionToAccountMetas(policyIns, payer);
  const policyAccountsHash = computeAccountsHash(
    policyIns.programId,
    policyMetas,
    smartWallet
  );
  const policyDataHash = new Uint8Array(sha256.arrayBuffer(policyIns.data));

  const cpiMetas = instructionToAccountMetas(cpiIns, payer);
  const cpiAccountsHash = computeAccountsHash(
    cpiIns.programId,
    cpiMetas,
    smartWallet
  );
  const cpiDataHash = new Uint8Array(sha256.arrayBuffer(cpiIns.data));

  const encoded = coder.types.encode('ExecuteMessage', {
    nonce,
    currentTimestamp: now,
    policyDataHash: Array.from(policyDataHash),
    policyAccountsHash: Array.from(policyAccountsHash),
    cpiDataHash: Array.from(cpiDataHash),
    cpiAccountsHash: Array.from(cpiAccountsHash),
  });
  return Buffer.from(encoded);
}

export function buildInvokePolicyMessage(
  payer: anchor.web3.PublicKey,
  smartWallet: anchor.web3.PublicKey,
  nonce: anchor.BN,
  now: anchor.BN,
  policyIns: anchor.web3.TransactionInstruction
): Buffer {
  const policyMetas = instructionToAccountMetas(policyIns, payer);
  const policyAccountsHash = computeAccountsHash(
    policyIns.programId,
    policyMetas,
    smartWallet
  );
  const policyDataHash = new Uint8Array(sha256.arrayBuffer(policyIns.data));

  const encoded = coder.types.encode('InvokePolicyMessage', {
    nonce,
    currentTimestamp: now,
    policyDataHash: Array.from(policyDataHash),
    policyAccountsHash: Array.from(policyAccountsHash),
  });
  return Buffer.from(encoded);
}

export function buildUpdatePolicyMessage(
  payer: anchor.web3.PublicKey,
  smartWallet: anchor.web3.PublicKey,
  nonce: anchor.BN,
  now: anchor.BN,
  destroyPolicyIns: anchor.web3.TransactionInstruction,
  initPolicyIns: anchor.web3.TransactionInstruction
): Buffer {
  const oldMetas = instructionToAccountMetas(destroyPolicyIns, payer);
  const oldAccountsHash = computeAccountsHash(
    destroyPolicyIns.programId,
    oldMetas,
    smartWallet
  );
  const oldDataHash = new Uint8Array(sha256.arrayBuffer(destroyPolicyIns.data));

  const newMetas = instructionToAccountMetas(initPolicyIns, payer);
  const newAccountsHash = computeAccountsHash(
    initPolicyIns.programId,
    newMetas,
    smartWallet
  );
  const newDataHash = new Uint8Array(sha256.arrayBuffer(initPolicyIns.data));

  const encoded = coder.types.encode('UpdatePolicyMessage', {
    nonce,
    currentTimestamp: now,
    oldPolicyDataHash: Array.from(oldDataHash),
    oldPolicyAccountsHash: Array.from(oldAccountsHash),
    newPolicyDataHash: Array.from(newDataHash),
    newPolicyAccountsHash: Array.from(newAccountsHash),
  });
  return Buffer.from(encoded);
}
