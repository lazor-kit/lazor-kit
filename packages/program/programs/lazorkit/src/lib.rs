use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;
pub mod utils;

use constants::PASSKEY_SIZE;
use instructions::*;

declare_id!("9gJ7jZaAvUafgTFPoqkCwbuvC9kpZCPtHfHjMkQ66wu9");

/// The Lazor Kit program provides smart wallet functionality with passkey authentication
#[program]
pub mod lazorkit {
    use super::*;

    /// Initialize the program by creating the sequence tracker
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize(ctx)
    }

    /// Create a new smart wallet with passkey authentication
    pub fn create_smart_wallet(
        ctx: Context<CreateSmartWallet>,
        passkey_pubkey: [u8; PASSKEY_SIZE],
        credential_id: Vec<u8>,
    ) -> Result<()> {
        instructions::create_smart_wallet(ctx, passkey_pubkey, credential_id)
    }

    /// Execute an instruction with passkey authentication
    pub fn execute_instruction(
        ctx: Context<ExecuteInstruction>,
        args: ExecuteInstructionArgs,
    ) -> Result<()> {
        instructions::execute_instruction(ctx, args)
    }
}
