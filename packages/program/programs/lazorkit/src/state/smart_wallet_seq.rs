use anchor_lang::prelude::*;

/// Account that maintains the sequence number for smart wallet creation
#[account]
#[derive(Debug, InitSpace)]
pub struct SmartWalletSeq {
    /// Current sequence number, incremented for each new smart wallet
    pub seq: u64,
    /// Bump seed for PDA derivation
    pub bump: u8,
}

impl SmartWalletSeq {
    pub const PREFIX_SEED: &'static [u8] = b"smart_wallet_seq";
}
