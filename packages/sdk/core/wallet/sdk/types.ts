import * as anchor from "@coral-xyz/anchor";

import { type Lazorkit } from "../types/lazorkit";
import { type TransferLimit } from "../types/transfer_limit";

export type CpiData = anchor.IdlTypes<Lazorkit>['cpiData'];
export type SmartWalletSeq = anchor.IdlTypes<Lazorkit>['smartWalletSeq'];
export type SmartWalletConfig = anchor.IdlTypes<Lazorkit>['smartWalletConfig'];
export type SmartWalletAuthenticator =
  anchor.IdlTypes<Lazorkit>['smartWalletAuthenticator'];

export type SmartWallet = anchor.Idl;

export const ExecuteAction = {
  ['ExecuteCpi']: { executeCpi: {} },
  ['ChangeProgramRule']: { changeProgramRule: {} },
  ['CheckAuthenticator']: { checkAuthenticator: {} },
  ['CallRuleProgram']: { callRuleProgram: {} },
};

// TransferLimitType
export type InitRuleArgs = anchor.IdlTypes<TransferLimit>['initRuleArgs'];
