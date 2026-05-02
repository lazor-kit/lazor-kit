import type { VaultTransactionLike } from '@/components/VisualizeTxn';
import VaultTxnSummary from '@/components/VisualizeTxn'; // your VaultTxnSummary
import { SmartWalletAction } from '@lazorkit/wallet-mobile-adapter';
import { Keypair, PublicKey } from '@solana/web3.js';
import * as multisigSdk from '@sqds/multisig';
import base58 from 'bs58';
import React, { useMemo } from 'react';
import {
    Platform,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import Toast from 'react-native-toast-message';

// ---- Types shaped to your Proposal class ----
export type ProposalStatusRecord =
  | { kind: 'Draft'; timestamp: bigint }
  | { kind: 'Active'; timestamp: bigint }
  | { kind: 'Rejected'; timestamp: bigint }
  | { kind: 'Approved'; timestamp: bigint }
  | { kind: 'Executing' }
  | { kind: 'Executed'; timestamp: bigint }
  | { kind: 'Cancelled'; timestamp: bigint };

export type ProposalLike = {
  multisig: PublicKey;
  transactionIndex: bigint; // beet.bignum compatible
  status: ProposalStatusRecord; // normalized shape for RN
  bump: number;
  approved: PublicKey[];
  rejected: PublicKey[];
  cancelled: PublicKey[];
};

export type Pair = { proposal: ProposalLike; txn: VaultTransactionLike };

// ---- Helpers ----
function bnToNum(bn: bigint | number | string): number {
  if (typeof bn === 'bigint') return Number(bn);
  if (typeof bn === 'number') return bn;
  return Number(bn);
}

function timeLabel(ts?: bigint) {
  if (!ts) return '';
  const ms = Number(ts) * 1000; // if your beet timestamp is seconds; adjust if ms
  const d = new Date(ms);
  return d.toLocaleString();
}

function statusBadge(s: ProposalStatusRecord) {
  switch (s.kind) {
    case 'Active':
      return { text: 'Active', color: '#10B981' };
    case 'Approved':
      return { text: 'Approved', color: '#3B82F6' };
    case 'Rejected':
      return { text: 'Rejected', color: '#EF4444' };
    case 'Executed':
      return { text: 'Executed', color: '#6B7280' };
    case 'Executing':
      return { text: 'Executing', color: '#A78BFA' };
    case 'Cancelled':
      return { text: 'Cancelled', color: '#F59E0B' };
    case 'Draft':
    default:
      return { text: 'Draft', color: '#9CA3AF' };
  }
}

// ---- Card Component ----
export function ProposalCard({
  pair,
  currentMember,
  connection,
  signMessage,
}: {
  pair: Pair;
  currentMember: PublicKey | null;
  connection: any;
  signMessage: (action: any, opts: any) => Promise<string>;
}) {
  const { proposal, txn } = pair;
  const st = statusBadge(proposal.status);

  // Determine whether current wallet has already participated
  const alreadyApproved = currentMember
    ? proposal.approved.some((p) => p.equals?.(currentMember) || String(p) === String(currentMember))
    : false;
  const alreadyRejected = currentMember
    ? proposal.rejected.some((p) => p.equals?.(currentMember) || String(p) === String(currentMember))
    : false;
  const alreadyCancelled = currentMember
    ? proposal.cancelled.some((p) => p.equals?.(currentMember) || String(p) === String(currentMember))
    : false;

  const hasVoted = alreadyApproved || alreadyRejected || alreadyCancelled;

  // Only show vote actions when status is Active and user hasn't voted
  const showVoteActions = proposal.status.kind === 'Active' && !hasVoted;
  // Only show Cancel when status is Draft
  const showCancel = proposal.status.kind === 'Draft';

  const counts = useMemo(
    () => ({
      approved: proposal.approved.length,
      rejected: proposal.rejected.length,
      cancelled: proposal.cancelled.length,
    }),
    [proposal]
  );

  async function sendIx(ix: any) {
    // LazorWallet flow identical to your usage
    const action = {
      type: SmartWalletAction.ExecuteTx,
      args: { cpiInstruction: ix, ruleInstruction: null },
    };
    await signMessage(action, {
      onSuccess: async (txns: any) => {
        try {
          const payer = Keypair.fromSecretKey(
            base58.decode(process.env.EXPO_PUBLIC_PRIVATE_KEY!)
          );
          for (const txn of txns) {
            // check if versioned txn
            if (txn.version === 0) {
              txn.sign([payer]);
              const txnHash = await connection.sendTransaction(txn, {
                skipPreflight: true,
              });

              console.log('Transaction signed successfully:', txnHash);
            } else {
              txn.partialSign(payer);

              const txnHash = await connection.sendRawTransaction(
                txn.serialize(),
                {
                  skipPreflight: true,
                }
              );

              console.log('Transaction signed successfully:', txnHash);
            }
          }
          Toast.show({ type: 'success', text1: 'Success', text2: 'Submitted' });
        } catch (e: any) {
          console.error(e);
          Toast.show({
            type: 'error',
            text1: 'Error',
            text2: e?.message || 'Failed to submit',
          });
        }
      },
      onFail: (err: any) => {
        Toast.show({
          type: 'error',
          text1: 'Sign failed',
          text2: String(err?.message || err),
        });
      },
      redirectUrl: 'exp://localhost:8081',
    });
  }

  async function onApprove() {
    try {
      const ix = multisigSdk.instructions.proposalApprove({
        multisigPda: proposal.multisig,
        transactionIndex: proposal.transactionIndex,
        member: currentMember!,
      });
      await sendIx(ix);
    } catch (e) {
      console.error(e);
      Toast.show({ type: 'error', text1: 'Approve failed' });
    }
  }
  async function onReject() {
    try {
      const ix = multisigSdk.instructions.proposalReject({
        multisigPda: proposal.multisig,
        transactionIndex: proposal.transactionIndex,
        member: currentMember!,
      });
      await sendIx(ix);
    } catch (e) {
      console.error(e);
      Toast.show({ type: 'error', text1: 'Reject failed' });
    }
  }
  async function onCancel() {
    try {
      const ix = multisigSdk.instructions.proposalCancel({
        multisigPda: proposal.multisig,
        transactionIndex: proposal.transactionIndex,
        member: currentMember!,
      });
      await sendIx(ix);
    } catch (e) {
      console.error(e);
      Toast.show({ type: 'error', text1: 'Cancel failed' });
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>
          Proposal #{bnToNum(proposal.transactionIndex)}
        </Text>
        <View style={[styles.badge, { backgroundColor: st.color }]}>
          <Text style={styles.badgeText}>{st.text}</Text>
        </View>
      </View>
      <Text style={styles.caption}>
        Updated {timeLabel((proposal.status as any).timestamp)}
      </Text>

      {/* Compact txn preview */}
      <View style={{ marginTop: 8 }}>
        <VaultTxnSummary tx={txn} />
      </View>

      {/* Vote counts */}
      <View style={[styles.rowWrap, { marginTop: 10 }]}>
        <CountPill label='Approved' value={counts.approved} />
        <CountPill label='Rejected' value={counts.rejected} />
        <CountPill label='Cancelled' value={counts.cancelled} />
      </View>

      {/* Actions */}
      {(showVoteActions || showCancel) ? (
        <View style={[styles.rowWrap, { marginTop: 12 }]}> 
          {showVoteActions ? (
            <>
              <OutlineButton label='Approve' onPress={onApprove} />
              <OutlineButton label='Reject' onPress={onReject} />
            </>
          ) : null}
          {showCancel ? (
            <OutlineButton label='Cancel' onPress={onCancel} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export function ProposalWithTxnList({
  pairs,
  currentMember,
  connection,
  signMessage,
}: {
  pairs: Pair[];
  currentMember: PublicKey | null;
  connection: any;
  signMessage: (action: any, opts: any) => Promise<string>;
}) {
  return (
    <View style={{ gap: 12 }}>
      {pairs.map((p) => (
        <ProposalCard
          key={
            String(p.proposal.multisig.toBase58?.() || p.proposal.multisig) +
            ':' +
            String(p.proposal.transactionIndex)
          }
          pair={p}
          currentMember={currentMember}
          connection={connection}
          signMessage={signMessage}
        />
      ))}
    </View>
  );
}

const CountPill = ({ label, value }: { label: string; value: number }) => (
  <View style={styles.pill}>
    <Text style={styles.pillText}>
      {label}: {value}
    </Text>
  </View>
);
const OutlineButton = ({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) => (
  <TouchableOpacity onPress={onPress} style={styles.btn}>
    <Text style={styles.btnText}>{label}</Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontSize: 16, fontWeight: '700', color: '#111827' },
  caption: { color: '#6B7280', marginTop: 2 },
  rowWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  pill: {
    backgroundColor: '#F3F4F6',
    borderColor: '#E5E7EB',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pillText: { fontSize: 12, color: '#111827' },
  btn: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#F9FAFB',
  },
  btnText: { color: '#111827', fontWeight: '600' },
  mono: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }) as any,
  },
});
