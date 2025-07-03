use anchor_lang::prelude::*;

/// Data account for a smart wallet
#[account]
#[derive(Default, InitSpace)]
pub struct SmartWalletConfig {
    /// Unique identifier for this smart wallet
    pub id: u64,
    // last nonce used for message verification
    pub last_nonce: u64,
}

impl SmartWalletConfig {
    pub const PREFIX_SEED: &'static [u8] = b"smart_wallet_config";
}
