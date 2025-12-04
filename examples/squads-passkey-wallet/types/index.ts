export interface Multisig {
  multisigId: string;
  name: string;
  threshold: number;
  members: string[];
}

export interface CreateMultisigInput {
  name: string;
  threshold: number;
  members: string[];
  multisigId: string;
}

export interface Proposal {
  id: string;
  title: string;
  createdAt: string;
  required: number;
  approvals: number;
  status: 'Available' | 'Not Available';
}

export interface ProposalsResponse {
  available: Proposal[];
  unavailable: Proposal[];
}

export interface ValidationError {
  field: string;
  message: string;
}
