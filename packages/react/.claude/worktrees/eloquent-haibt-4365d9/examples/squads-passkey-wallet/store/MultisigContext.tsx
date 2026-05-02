'use client';

import { createContext, useContext, useReducer, type ReactNode } from 'react';
import type { Multisig, Proposal, ProposalsResponse } from '../types';
import {
  createMultisig as apiCreateMultisig,
  fetchProposals as apiFetchProposals,
} from '../utils/api';

// State interface
interface MultisigState {
  currentMultisig: Multisig | null;
  proposals: {
    available: Proposal[];
    unavailable: Proposal[];
  };
  loading: {
    createMultisig: boolean;
    fetchProposals: boolean;
  };
  errors: {
    createMultisig: string | null;
    fetchProposals: string | null;
  };
}

// Action types
type MultisigAction =
  | { type: 'SET_CURRENT_MULTISIG'; payload: Multisig }
  | { type: 'SET_PROPOSALS'; payload: ProposalsResponse }
  | { type: 'SET_CREATE_LOADING'; payload: boolean }
  | { type: 'SET_FETCH_LOADING'; payload: boolean }
  | { type: 'SET_CREATE_ERROR'; payload: string | null }
  | { type: 'SET_FETCH_ERROR'; payload: string | null }
  | { type: 'CLEAR_ERRORS' };

// Initial state
const initialState: MultisigState = {
  currentMultisig: null,
  proposals: {
    available: [],
    unavailable: [],
  },
  loading: {
    createMultisig: false,
    fetchProposals: false,
  },
  errors: {
    createMultisig: null,
    fetchProposals: null,
  },
};

// Reducer
function multisigReducer(
  state: MultisigState,
  action: MultisigAction
): MultisigState {
  switch (action.type) {
    case 'SET_CURRENT_MULTISIG':
      return {
        ...state,
        currentMultisig: action.payload,
      };
    case 'SET_PROPOSALS':
      return {
        ...state,
        proposals: action.payload,
      };
    case 'SET_CREATE_LOADING':
      return {
        ...state,
        loading: {
          ...state.loading,
          createMultisig: action.payload,
        },
      };
    case 'SET_FETCH_LOADING':
      return {
        ...state,
        loading: {
          ...state.loading,
          fetchProposals: action.payload,
        },
      };
    case 'SET_CREATE_ERROR':
      return {
        ...state,
        errors: {
          ...state.errors,
          createMultisig: action.payload,
        },
      };
    case 'SET_FETCH_ERROR':
      return {
        ...state,
        errors: {
          ...state.errors,
          fetchProposals: action.payload,
        },
      };
    case 'CLEAR_ERRORS':
      return {
        ...state,
        errors: {
          createMultisig: null,
          fetchProposals: null,
        },
      };
    default:
      return state;
  }
}

// Context interface
interface MultisigContextType {
  state: MultisigState;
  actions: {
    createMultisig: (input: {
      name: string;
      threshold: number;
      members: string[];
      multisigId: string
    }) => Promise<Multisig>;
    fetchProposals: (multisigId: string) => Promise<void>;
    setCurrentMultisig: (multisig: Multisig) => void;
    clearErrors: () => void;
  };
}

// Create context
const MultisigContext = createContext<MultisigContextType | undefined>(
  undefined
);

// Provider component
export function MultisigProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(multisigReducer, initialState);

  // Action creators
  const actions = {
    createMultisig: async (input: {
      name: string;
      threshold: number;
      members: string[];
      multisigId: string;
    }): Promise<Multisig> => {
      dispatch({ type: 'SET_CREATE_LOADING', payload: true });
      dispatch({ type: 'SET_CREATE_ERROR', payload: null });

      try {
        const multisig = await apiCreateMultisig(input);
        dispatch({ type: 'SET_CURRENT_MULTISIG', payload: multisig });
        return multisig;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Failed to create multisig';
        dispatch({ type: 'SET_CREATE_ERROR', payload: errorMessage });
        throw error;
      } finally {
        dispatch({ type: 'SET_CREATE_LOADING', payload: false });
      }
    },

    fetchProposals: async (multisigId: string): Promise<void> => {
      dispatch({ type: 'SET_FETCH_LOADING', payload: true });
      dispatch({ type: 'SET_FETCH_ERROR', payload: null });

      try {
        const proposals = await apiFetchProposals(multisigId);
        dispatch({ type: 'SET_PROPOSALS', payload: proposals });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Failed to fetch proposals';
        dispatch({ type: 'SET_FETCH_ERROR', payload: errorMessage });
        throw error;
      } finally {
        dispatch({ type: 'SET_FETCH_LOADING', payload: false });
      }
    },

    setCurrentMultisig: (multisig: Multisig) => {
      dispatch({ type: 'SET_CURRENT_MULTISIG', payload: multisig });
    },

    clearErrors: () => {
      dispatch({ type: 'CLEAR_ERRORS' });
    },
  };

  const contextValue: MultisigContextType = {
    state,
    actions,
  };

  return (
    <MultisigContext.Provider value={contextValue}>
      {children}
    </MultisigContext.Provider>
  );
}

// Custom hook to use the context
export function useMultisig(): MultisigContextType {
  const context = useContext(MultisigContext);
  if (context === undefined) {
    throw new Error('useMultisig must be used within a MultisigProvider');
  }
  return context;
}

// Convenience hooks for specific parts of the state
export function useMultisigState() {
  const { state } = useMultisig();
  return state;
}

export function useMultisigActions() {
  const { actions } = useMultisig();
  return actions;
}
