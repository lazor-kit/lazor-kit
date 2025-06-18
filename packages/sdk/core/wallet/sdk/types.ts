import * as anchor from '@coral-xyz/anchor';

import { Lazorkit } from '../types/lazorkit';

export type CpiData = anchor.IdlTypes<Lazorkit>['cpiData'];
export type SmartWalletSeq = anchor.IdlTypes<Lazorkit>['smartWalletSeq'];
export type SmartWalletConfig = anchor.IdlTypes<Lazorkit>['smartWalletConfig'];
export type SmartWalletAuthenticator = anchor.IdlTypes<Lazorkit>['smartWalletAuthenticator'];

export type SmartWallet = anchor.Idl;

export const ExecuteAction = {
  ['ExecuteCpi']: { executeCpi: {} },
  ['ChangeProgramRule']: { changeProgramRule: {} },
  ['CheckAuthenticator']: { checkAuthenticator: {} },
  ['CallRuleProgram']: { callRuleProgram: {} },
};