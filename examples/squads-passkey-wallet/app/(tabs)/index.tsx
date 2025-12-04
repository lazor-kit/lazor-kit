'use client';

import {
  SmartWalletActionArgs,
  SmartWalletAction,
  useLazorWallet,
} from '@lazorkit/wallet-mobile-adapter';
import { Keypair, PublicKey } from '@solana/web3.js';
import * as multisigSdk from '@sqds/multisig';
import * as bs58 from 'bs58';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
// import ProposalItem from '../../components/ProposalItem';
import {
  ProposalLike,
  ProposalStatusRecord,
  ProposalWithTxnList,
} from '@/components/VisualizeProposal';
import {
  VaultTransactionLike,
} from '@/components/VisualizeTxn';
import {
  useMultisigActions,
  useMultisigState,
} from '../../store/MultisigContext';
import { shortAddress } from '../../utils/solana';

const { Multisig } = multisigSdk.accounts;
const { Proposal } = multisigSdk.accounts;

export default function MultisigDashboardScreen() {
  const { currentMultisig, proposals, loading, errors } = useMultisigState();
  const { fetchProposals } = useMultisigActions();
  const { smartWalletPubkey, connection, signMessage } = useLazorWallet();

  const [activeTab, setActiveTab] = useState<'available' | 'unavailable'>(
    'available'
  );
  const [refreshing, setRefreshing] = useState(false);
  const [pairs, setPairs] = useState<
    Array<{ proposal: ProposalLike; txn: VaultTransactionLike }>
  >([]);

  // Fetch proposals on mount
  useEffect(() => {
    if (currentMultisig) {
      loadProposals();
      loadDataMultisig();
    }
  }, [currentMultisig]);

  const loadDataMultisig = async () => {
    if (!currentMultisig) return;
    try {
      const multisigPda = new PublicKey(currentMultisig.multisigId);
      const multisigAccount = await Multisig.fromAccountAddress(
        connection,
        multisigPda
      );
      const txnIndex = Number(multisigAccount.transactionIndex.toString());

      const tmp: Array<{ proposal: ProposalLike; txn: any }> = [];
      for (let i = 1; i <= txnIndex; i++) {
        const [proposalPda] = multisigSdk.getProposalPda({
          multisigPda,
          transactionIndex: BigInt(i),
        });
        const rawProposal = await Proposal.fromAccountAddress(
          connection,
          proposalPda
        );

        const [transactionPda] = multisigSdk.getTransactionPda({
          multisigPda,
          index: BigInt(i),
        });
        const rawTxn =
          await multisigSdk.accounts.VaultTransaction.fromAccountAddress(
            connection,
            transactionPda
          );

        // ✅ Normalize proposal.status → { kind, timestamp? }
        const status = normalizeStatus(rawProposal.status); // thêm func phía dưới

        tmp.push({
          proposal: {
            multisig: rawProposal.multisig,
            transactionIndex: BigInt(i),
            status,
            bump: rawProposal.bump,
            approved: rawProposal.approved,
            rejected: rawProposal.rejected,
            cancelled: rawProposal.cancelled,
          },
          txn: rawTxn, // rawTxn đã đúng shape mà VaultTxnSummary nhận
        });
      }

      console.log(tmp);

      setPairs(tmp);
    } catch (error) {
      console.log(error);
    }
  };

  function normalizeStatus(s: any): ProposalStatusRecord {
    // s có dạng { Active: { timestamp }, Approved: { timestamp }, Executing: {} ... }
    const key = Object.keys(s)[0];
    const val = (s as any)[key];

    const timestamp = (s as any)['timestamp'];

    switch (val) {
      case 'Active':
        return { kind: 'Active', timestamp: BigInt(timestamp) };
      case 'Approved':
        return { kind: 'Approved', timestamp: BigInt(timestamp) };
      case 'Rejected':
        return { kind: 'Rejected', timestamp: BigInt(timestamp) };
      case 'Executed':
        return { kind: 'Executed', timestamp: BigInt(timestamp) };
      case 'Cancelled':
        return { kind: 'Cancelled', timestamp: BigInt(timestamp) };
      case 'Draft':
        return { kind: 'Draft', timestamp: BigInt(timestamp) };
      case 'Executing':
        return { kind: 'Executing' };
      default:
        return { kind: 'Draft', timestamp: BigInt(0) };
    }
  }

  const loadProposals = async () => {
    if (!currentMultisig) return;

    try {
      await fetchProposals(currentMultisig.multisigId);
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: errors.fetchProposals || 'Failed to fetch proposals',
      });
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadProposals();
    setRefreshing(false);
  };

  const copyToClipboard = async (text: string) => {
    await Clipboard.setStringAsync(text);
    Toast.show({
      type: 'success',
      text1: 'Copied',
      text2: 'Address copied to clipboard',
    });
  };

  // Derive available/unavailable pairs by status
  const availablePairs = pairs.filter(
    (p) =>
      p.proposal.status.kind === 'Active' ||
      p.proposal.status.kind === 'Draft' ||
      p.proposal.status.kind === 'Executing'
  );
  const unavailablePairs = pairs.filter(
    (p) => !(
      p.proposal.status.kind === 'Active' ||
      p.proposal.status.kind === 'Draft' ||
      p.proposal.status.kind === 'Executing'
    )
  );
  const currentPairs = activeTab === 'available' ? availablePairs : unavailablePairs;

  // Show loading if no current multisig
  if (!currentMultisig) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size='large' color='#3B82F6' />
          <Text style={styles.loadingText}>Loading multisig data...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <Text style={styles.multisigName}>{currentMultisig?.name}</Text>
            <TouchableOpacity
              style={styles.createProposalButton}
              onPress={async () => {
                if (!smartWalletPubkey) {
                  Toast.show({
                    type: 'error',
                    text1: 'Error',
                    text2: 'Please connect your wallet first',
                  });
                  return;
                }

                try {
                  const payer = Keypair.fromSecretKey(
                    base58.decode(process.env.EXPO_PUBLIC_PRIVATE_KEY!)
                  );

                  // If you've saved your createKey, you can define it as a static PublicKey
                  const multisigPda = new PublicKey(currentMultisig.multisigId);
                  // Get deserialized multisig account info
                  const [vaultPda] = multisigSdk.getVaultPda({
                    multisigPda,
                    index: 0,
                  });

                  // Get deserialized multisig account info
                  const multisigInfo =
                    await multisigSdk.accounts.Multisig.fromAccountAddress(
                      connection,
                      multisigPda
                    );

                  // Get the updated transaction index
                  const currentTransactionIndex = Number(
                    multisigInfo.transactionIndex
                  );

                  const ix = multisigSdk.instructions.proposalCreate({
                    multisigPda,
                    transactionIndex: BigInt(currentTransactionIndex),
                    // Must have "Voter" permissions at minimum
                    creator: smartWalletPubkey,
                    rentPayer: payer.publicKey,
                  });

                  // const { instruction: ix } =
                  //   await multisigSdk.instructions.vaultTransactionExecute({
                  //     connection,
                  //     multisigPda,
                  //     transactionIndex: BigInt(currentTransactionIndex),
                  //     // Member must have "Executor" permissions
                  //     member: smartWalletPubkey,
                  //   });

                  // const newTransactionIndex = BigInt(
                  //   currentTransactionIndex + 1
                  // );

                  // const to = new PublicKey(
                  //   'hij78MKbJSSs15qvkHWTDCtnmba2c1W4r1V22g5sD8w'
                  // );

                  // const transferInstruction = SystemProgram.transfer({
                  //   // The transfer is being signed by the vault that's executing
                  //   fromPubkey: vaultPda,
                  //   toPubkey: to,
                  //   lamports: 0.001 * LAMPORTS_PER_SOL,
                  // });

                  // // Build a message with instructions we want to execute
                  // const testTransferMessage = new TransactionMessage({
                  //   payerKey: vaultPda,
                  //   recentBlockhash: (await connection.getLatestBlockhash())
                  //     .blockhash,
                  //   instructions: [transferInstruction],
                  // });

                  // const ix = multisigSdk.instructions.vaultTransactionCreate({
                  //   multisigPda,
                  //   transactionIndex: newTransactionIndex,
                  //   creator: smartWalletPubkey,
                  //   vaultIndex: 0,
                  //   ephemeralSigners: 0,
                  //   transactionMessage: testTransferMessage,
                  //   memo: 'Our first transfer!',
                  //   rentPayer: payer.publicKey,
                  // });

                  const action: SmartWalletActionArgs = {
                    type: SmartWalletAction.CreateChunk,
                    args: {
                      cpiInstruction: ix,
                      policyInstruction: null,
                    },
                  };

                  await signMessage(action, {
                    onSuccess: async (txns) => {
                      try {
                        for (const txn of txns) {
                          // check if versioned txn
                          if (txn.version === 0) {
                            txn.sign([payer]);
                            const txnHash = await connection.sendTransaction(
                              txn,
                              {
                                skipPreflight: true,
                              }
                            );

                            console.log(
                              'Transaction signed successfully:',
                              txnHash
                            );
                          } else {
                            txn.partialSign(payer);

                            const txnHash = await connection.sendRawTransaction(
                              txn.serialize(),
                              {
                                skipPreflight: true,
                              }
                            );

                            console.log(
                              'Transaction signed successfully:',
                              txnHash
                            );
                          }
                        }
                      } catch (error) {
                        console.error('Error sending transaction:', error);
                      }

                      // setTransactionHash(txnHash);
                      // setShowTransactionResult(true);
                    },
                    onFail: (error) => {
                      throw new Error(
                        `Failed to sign transaction: ${error.message}`
                      );
                    },
                    redirectUrl: 'exp://localhost:8081',
                  });

                  Toast.show({
                    type: 'success',
                    text1: 'Success',
                    text2: 'Proposal created successfully!',
                  });
                } catch (error) {
                  console.error('Error creating proposal:', error);
                  Toast.show({
                    type: 'error',
                    text1: 'Error',
                    text2: 'Failed to create proposal',
                  });
                }
              }}
              accessibilityLabel='Create proposal button'
              accessibilityRole='button'
            >
              <Text style={styles.createProposalButtonText}>
                Create Proposal
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.multisigId}>
            {currentMultisig ? shortAddress(currentMultisig.multisigId) : ''}
          </Text>
        </View>

        {/* Members Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Members</Text>
          <View style={styles.card}>
            {currentMultisig?.members.map((member: string, index: number) => (
              <TouchableOpacity
                key={index}
                style={[
                  styles.memberRow,
                  index < (currentMultisig?.members.length || 0) - 1 &&
                  styles.memberRowBorder,
                ]}
                onPress={() => copyToClipboard(member)}
                accessibilityLabel={`Copy member address ${shortAddress(
                  member
                )}`}
                accessibilityRole='button'
              >
                <Text style={styles.memberAddress}>{shortAddress(member)}</Text>
                <Text style={styles.copyIcon}>📋</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Config Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Configuration</Text>
          <View style={styles.card}>
            <View style={styles.configRow}>
              <Text style={styles.configLabel}>Threshold</Text>
              <Text style={styles.configValue}>
                {currentMultisig?.threshold} of{' '}
                {currentMultisig?.members.length}
              </Text>
            </View>
            <View style={styles.configRow}>
              <Text style={styles.configLabel}>Total Members</Text>
              <Text style={styles.configValue}>
                {currentMultisig?.members.length}
              </Text>
            </View>
          </View>
        </View>

        {/* Proposals Section */}
        <View style={styles.section}>
          <View style={styles.proposalsHeader}>
            <Text style={styles.sectionTitle}>Proposals</Text>
            <TouchableOpacity
              style={styles.refreshButton}
              onPress={handleRefresh}
              disabled={loading.fetchProposals}
              accessibilityLabel='Refresh proposals'
              accessibilityRole='button'
            >
              {loading.fetchProposals ? (
                <ActivityIndicator size='small' color='#3B82F6' />
              ) : (
                <Text style={styles.refreshIcon}>🔄</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Tabs */}
          <View style={styles.tabContainer}>
            <TouchableOpacity
              style={[
                styles.tab,
                activeTab === 'available' && styles.activeTab,
              ]}
              onPress={() => setActiveTab('available')}
              accessibilityLabel='Available proposals tab'
              accessibilityRole='tab'
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === 'available' && styles.activeTabText,
                ]}
              >
                Available ({availablePairs.length})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.tab,
                activeTab === 'unavailable' && styles.activeTab,
              ]}
              onPress={() => setActiveTab('unavailable')}
              accessibilityLabel='Not available proposals tab'
              accessibilityRole='tab'
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === 'unavailable' && styles.activeTabText,
                ]}
              >
                Not Available ({unavailablePairs.length})
              </Text>
            </TouchableOpacity>
          </View>

          {/* Proposals List */}
          <View style={styles.proposalsList}>
            {currentPairs.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateText}>No proposals yet</Text>
                <Text style={styles.emptyStateSubtext}>
                  {activeTab === 'available'
                    ? 'No available proposals to review'
                    : 'No unavailable proposals'}
                </Text>
              </View>
            ) : (
              <ProposalWithTxnList
                pairs={currentPairs}
                currentMember={smartWalletPubkey ?? null}
                connection={connection}
                signMessage={signMessage}
              />
            )}
          </View>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  scrollView: {
    flex: 1,
  },
  header: {
    padding: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  multisigName: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
    flex: 1,
  },
  createProposalButton: {
    backgroundColor: '#3B82F6',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  createProposalButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  multisigId: {
    fontSize: 14,
    color: '#6B7280',
    fontFamily: 'monospace',
  },
  section: {
    marginTop: 20,
    paddingHorizontal: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 12,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  memberRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    minHeight: 44,
  },
  memberRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  memberAddress: {
    fontSize: 14,
    color: '#374151',
    fontFamily: 'monospace',
  },
  copyIcon: {
    fontSize: 16,
  },
  configRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  configLabel: {
    fontSize: 14,
    color: '#6B7280',
  },
  configValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  proposalsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  refreshButton: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshIcon: {
    fontSize: 16,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    padding: 4,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  activeTab: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6B7280',
  },
  activeTabText: {
    color: '#374151',
    fontWeight: '600',
  },
  proposalsList: {
    gap: 12,
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#6B7280',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  emptyStateText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#374151',
    marginBottom: 4,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
  },
});
