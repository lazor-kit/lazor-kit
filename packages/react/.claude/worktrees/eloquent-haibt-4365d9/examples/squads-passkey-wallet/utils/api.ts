import type {
  CreateMultisigInput,
  Multisig,
  ProposalsResponse,
} from '../types';

/**
 * Utility function to simulate network delay
 */
export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Stub function to create a multisig
 * TODO: integrate @solana/web3.js or a multisig program (e.g., Squads)
 */
export async function createMultisig(
  input: CreateMultisigInput
): Promise<Multisig> {
  await delay(700);

  // Simulate potential API errors
  if (Math.random() < 0.1) {
    throw new Error('Failed to create multisig. Please try again.');
  }

  return {
    ...input,
  };
}

/**
 * Stub function to fetch proposals for a multisig
 * TODO: integrate @solana/web3.js or a multisig program (e.g., Squads)
 */
export async function fetchProposals(
  multisigId: string
): Promise<ProposalsResponse> {
  await delay(500);

  // Simulate potential API errors
  if (Math.random() < 0.05) {
    throw new Error('Failed to fetch proposals. Please try again.');
  }

  return {
    available: [
      {
        id: 'p1',
        title: 'Transfer 1 SOL to Treasury',
        createdAt: '2025-08-01',
        required: 2,
        approvals: 1,
        status: 'Available',
      },
      {
        id: 'p3',
        title: 'Update multisig threshold',
        createdAt: '2025-08-05',
        required: 3,
        approvals: 2,
        status: 'Available',
      },
    ],
    unavailable: [
      {
        id: 'p2',
        title: 'Add new member',
        createdAt: '2025-07-20',
        required: 3,
        approvals: 1,
        status: 'Not Available',
      },
      {
        id: 'p4',
        title: 'Remove inactive member',
        createdAt: '2025-07-15',
        required: 2,
        approvals: 0,
        status: 'Not Available',
      },
    ],
  };
}
