import * as anchor from '@coral-xyz/anchor';

import { Lazorkit } from '../target/types/lazorkit';

export type SmartWalletSeq = anchor.IdlTypes<Lazorkit>['smartWalletSeq'];
export type SmartWalletConfig = anchor.IdlTypes<Lazorkit>['smartWalletConfig'];
export type SmartWalletAuthenticator =
  anchor.IdlTypes<Lazorkit>['smartWalletAuthenticator'];