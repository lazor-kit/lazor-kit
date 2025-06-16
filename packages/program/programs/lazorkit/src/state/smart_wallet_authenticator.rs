use crate::constants::PASSKEY_SIZE;
use anchor_lang::prelude::*;

/// Account that stores authentication data for a smart wallet
#[account]
#[derive(Debug, InitSpace)]
pub struct SmartWalletAuthenticator {
    /// The public key of the passkey that can authorize transactions
    pub passkey_pubkey: [u8; PASSKEY_SIZE],
    /// The smart wallet this authenticator belongs to
    pub smart_wallet: Pubkey,

    /// The credential ID this authenticator belongs to
    #[max_len(256)]
    pub credential_id: Vec<u8>,

    /// Bump seed for PDA derivation
    pub bump: u8,
}

impl SmartWalletAuthenticator {
    pub const PREFIX_SEED: &'static [u8] = b"smart_wallet_authenticator";
}
