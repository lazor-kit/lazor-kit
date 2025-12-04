import { Ionicons } from '@expo/vector-icons';
import {
  SmartWalletActionArgs,
  SmartWalletAction,
  useLazorWallet,
} from '@lazorkit/wallet-mobile-adapter';
import { Keypair, PublicKey } from '@solana/web3.js';
import * as multisigSdk from '@sqds/multisig';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import MembersList from '../components/MemberList';
import ThresholdInput from '../components/ThresholdInput';
import { DEFAULT_THRESHOLD, TEST_MEMBERS } from '../constants/testData';
import { useMultisigActions, useMultisigState } from '../store/MultisigContext';
import { validateCreateMultisigForm } from '../utils/validation';
import * as bs58 from 'bs58';
import { Buffer } from 'buffer';

const { Permissions } = multisigSdk.types;
const { Multisig } = multisigSdk.accounts;

export default function CreateMultisigScreen() {
  const { createMultisig, setCurrentMultisig } = useMultisigActions();
  const { errors } = useMultisigState();
  const { isConnected, connect, smartWalletPubkey, connection, signMessage } =
    useLazorWallet();

  // Form state
  const [name, setName] = useState('Test multisig');
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [members, setMembers] = useState<string[]>(TEST_MEMBERS);

  // Validation state
  const [validationErrors, setValidationErrors] = useState<
    Record<string, string>
  >({});
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [pageLoading, setPageLoading] = useState<string | null>(null);

  const handleConnect = async () => {
    setPageLoading('Connecting to wallet...');
    try {
      await connect({
        redirectUrl: 'exp://localhost:8081',
      });
      Alert.alert(
        'Connection Successful',
        'You are now connected to your wallet',
        [
          {
            text: 'OK',
            onPress: () => {
              router.replace('/(tabs)');
            },
          },
        ]
      );
      setMembers([...members, smartWalletPubkey?.toString()!]);
    } catch (error) {
      Alert.alert('Connection Error', 'Failed to connect to wallet');
    }
    setPageLoading(null);
  };

  // Validate form on change if user has attempted submit
  useEffect(() => {
    if (hasAttemptedSubmit) {
      const validation = validateCreateMultisigForm(name, threshold, members);
      const errorMap: Record<string, string> = {};
      validation.errors.forEach((error) => {
        errorMap[error.field] = error.message;
      });
      setValidationErrors(errorMap);
    }
  }, [name, threshold, members, hasAttemptedSubmit]);

  useEffect(() => {
    const fetchAccountData = async () => {
      if (smartWalletPubkey) {
        const [multisigPda] = multisigSdk.getMultisigPda({
          createKey: smartWalletPubkey,
        });

        const multisigAccInfo = await connection.getAccountInfo(multisigPda);

        if (multisigAccInfo) {
          const multisigAccount = await Multisig.fromAccountAddress(
            connection,
            multisigPda
          );
          setCurrentMultisig(
            await createMultisig({
              name: name.trim(),
              threshold: multisigAccount.threshold,
              members: multisigAccount.members.map((member) =>
                member.key.toString()
              ),
              multisigId: multisigPda.toString(),
            })
          );

          router.replace('/(tabs)');
        }
      }
    };

    fetchAccountData();

    setPageLoading('Loading...');
  }, []);

  const handleCreateMultisig = async () => {
    setHasAttemptedSubmit(true);

    if (smartWalletPubkey) {
      try {
        setPageLoading('Create multisig...');

        const [multisigPda] = multisigSdk.getMultisigPda({
          createKey: smartWalletPubkey,
        });

        const payer = Keypair.fromSecretKey(
          bs58.decode(process.env.EXPO_PUBLIC_PRIVATE_KEY!)
        );

        const programConfigPda = multisigSdk.getProgramConfigPda({})[0];

        const programConfig =
          await multisigSdk.accounts.ProgramConfig.fromAccountAddress(
            connection,
            programConfigPda
          );

        const configTreasury = programConfig.treasury;

        const membersList = [...members, smartWalletPubkey.toString()];

        const createMultisigIns = multisigSdk.instructions.multisigCreateV2({
          // Must sign the transaction, unless the .rpc method is used.
          createKey: smartWalletPubkey,
          // The creator & fee payer
          creator: payer.publicKey,
          // The PDA of the multisig you are creating, derived by a random PublicKey
          multisigPda,
          // Here the config authority will be the system program
          configAuthority: null,
          // Create without any time-lock
          timeLock: 0,
          // List of the members to add to the multisig
          members: membersList.map((member) => {
            return {
              // Members Public Key
              key: new PublicKey(member),
              // Granted Proposer, Voter, and Executor permissions
              permissions: Permissions.all(),
            };
          }),
          // This means that there needs to be 2 votes for a transaction proposal to be approved
          threshold: 2,
          // This is for the program config treasury account
          treasury: configTreasury,
          // Rent reclaim account
          rentCollector: null,
        });

        const action: SmartWalletActionArgs = {
          type: SmartWalletAction.CreateChunk,
          args: {
            cpiInstructions: [createMultisigIns],
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
            } catch (error) {
              console.error('Error sending transaction:', error);
            }

            // setTransactionHash(txnHash);
            // setShowTransactionResult(true);
          },
          onFail: (error) => {
            throw new Error(`Failed to sign transaction: ${error.message}`);
          },
          redirectUrl: 'exp://localhost:8081',
        });

        const multisig = await createMultisig({
          name: name.trim(),
          threshold,
          members: members.filter((member) => member.trim()),
          multisigId: multisigPda.toString(),
        });

        // Lưu multisig vào global state
        setCurrentMultisig(multisig);

        Toast.show({
          type: 'success',
          text1: 'Success',
          text2: 'Multisig created successfully!',
        });

        // Chuyển trang
      } catch (error) {
        Toast.show({
          type: 'error',
          text1: 'Error',
          text2: errors.createMultisig || 'Failed to create multisig',
        });
      } finally {
        setPageLoading(null);
      }
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {pageLoading ? (
        <View style={styles.fullPageLoadingContainer}>
          <ActivityIndicator size='large' color='#6366f1' />
          <Text style={styles.pageLoadingText}>
            {pageLoading || 'Creating multisig...'}
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scrollView}
          showsVerticalScrollIndicator={true}
        >
          <View>
            {isConnected && smartWalletPubkey ? (
              <View style={styles.content}>
                {/* Multisig Name */}
                <View style={styles.fieldContainer}>
                  <Text style={styles.label}>Multisig Name *</Text>
                  <TextInput
                    style={[
                      styles.input,
                      validationErrors.name && styles.inputError,
                    ]}
                    value={name}
                    onChangeText={setName}
                    placeholder='Enter multisig name'
                    placeholderTextColor='#9CA3AF'
                    accessibilityLabel='Multisig name input'
                  />
                  {validationErrors.name && (
                    <Text style={styles.errorText}>
                      {validationErrors.name}
                    </Text>
                  )}
                </View>

                {/* Threshold */}
                <ThresholdInput
                  value={threshold}
                  onChange={setThreshold}
                  membersCount={
                    [...members, smartWalletPubkey.toString()].filter((m) =>
                      m.trim()
                    ).length
                  }
                  error={validationErrors.threshold}
                />

                {/* Members */}
                <MembersList
                  members={[...members, smartWalletPubkey.toString()]}
                  onChange={setMembers}
                  errors={validationErrors}
                />

                {/* Create Button */}
                <TouchableOpacity
                  style={styles.createButton}
                  onPress={handleCreateMultisig}
                  accessibilityLabel='Create multisig button'
                  accessibilityRole='button'
                >
                  <Text style={styles.createButtonText}>Create Multisig</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.connectContainer}>
                <TouchableOpacity
                  style={styles.connectButton}
                  onPress={handleConnect}
                >
                  <Text style={styles.connectButtonText}>Connect Wallet</Text>
                  <Ionicons name='wallet-outline' size={20} color='#fff' />
                </TouchableOpacity>
              </View>
            )}
          </View>
        </ScrollView>
      )}
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
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  fieldContainer: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#FFFFFF',
    color: '#111827',
  },
  inputError: {
    borderColor: '#EF4444',
  },
  errorText: {
    color: '#EF4444',
    fontSize: 14,
    marginTop: 4,
  },
  createButton: {
    backgroundColor: '#3B82F6',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginTop: 32,
    minHeight: 52,
    justifyContent: 'center',
  },
  connectButton: {
    backgroundColor: '#6366f1',
    borderRadius: 16,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    minWidth: 200,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  connectButtonText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  createButtonDisabled: {
    backgroundColor: '#9CA3AF',
  },
  createButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  fullPageLoadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
  },
  connectContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  pageLoadingContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  pageLoadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#64748b',
  },
});
