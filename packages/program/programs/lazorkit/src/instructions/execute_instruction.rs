use anchor_lang::solana_program::hash::hash;

use anchor_lang::{prelude::*, solana_program::sysvar::instructions::load_instruction_at_checked};

use crate::state::{Config, Message};
use crate::utils::{
    execute_cpi, transfer_sol_from_pda, verify_secp256r1_instruction, PasskeyExt, PdaSigner,
};
use crate::{
    constants::SMART_WALLET_SEED,
    error::LazorKitError,
    state::{SmartWalletAuthenticator, SmartWalletConfig},
    ID,
};
use anchor_lang::solana_program::sysvar::instructions::ID as IX_ID;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};

const MAX_SLOT_DRIFT: i64 = 30;

/// Arguments for the execute_instruction entrypoint
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ExecuteInstructionArgs {
    pub passkey_pubkey: [u8; 33],
    pub signature: Vec<u8>,
    pub client_data_json_raw: Vec<u8>,
    pub authenticator_data_raw: Vec<u8>,
    pub verify_instruction_index: u8,
}

/// Entrypoint for executing smart wallet instructions
pub fn execute_instruction(
    ctx: Context<ExecuteInstruction>,
    args: ExecuteInstructionArgs,
) -> Result<()> {
    // --- Passkey and signature verification ---
    let authenticator = &ctx.accounts.smart_wallet_authenticator;

    require!(
        authenticator.passkey_pubkey == args.passkey_pubkey,
        LazorKitError::PasskeyMismatch
    );
    require!(
        authenticator.smart_wallet == ctx.accounts.smart_wallet.key(),
        LazorKitError::SmartWalletMismatch
    );

    let secp_ix = load_instruction_at_checked(
        args.verify_instruction_index as usize,
        &ctx.accounts.ix_sysvar,
    )?;

    let client_hash = hash(&args.client_data_json_raw);
    let mut message =
        Vec::with_capacity(args.authenticator_data_raw.len() + client_hash.as_ref().len());
    message.extend_from_slice(&args.authenticator_data_raw);
    message.extend_from_slice(client_hash.as_ref());

    // DEPRECATION WARNING: On-chain JSON parsing is expensive.
    let json_str = core::str::from_utf8(&args.client_data_json_raw)
        .map_err(|_| LazorKitError::ClientDataInvalidUtf8)?;
    let parsed: serde_json::Value =
        serde_json::from_str(json_str).map_err(|_| LazorKitError::ClientDataJsonParseError)?;
    let challenge = parsed["challenge"]
        .as_str()
        .ok_or(LazorKitError::ChallengeMissing)?;
    let challenge_clean = challenge.trim_matches(|c| c == '"' || c == '\'' || c == '/' || c == ' ');
    let challenge_bytes = URL_SAFE_NO_PAD
        .decode(challenge_clean)
        .map_err(|_| LazorKitError::ChallengeBase64DecodeError)?;
    let msg = Message::try_from_slice(&challenge_bytes)
        .map_err(|_| LazorKitError::ChallengeDeserializationError)?;

    require!(
        msg.nonce == ctx.accounts.smart_wallet_config.last_nonce,
        LazorKitError::NonceMismatch
    );

    // Validate current slot to prevent replay attacks
    let current_slot = Clock::get()?.slot;
    let slot_diff = (current_slot as i64).saturating_sub(msg.current_slot);
    require!(slot_diff <= MAX_SLOT_DRIFT, LazorKitError::SlotTooOld);

    verify_secp256r1_instruction(
        &secp_ix,
        authenticator.passkey_pubkey,
        message,
        &args.signature,
    )?;

    // --- CPI Execution ---
    let id = ctx.accounts.smart_wallet_config.id;

    if ctx.accounts.cpi_program.key() == anchor_lang::solana_program::system_program::ID
        && msg.instruction_data.get(0..4) == Some(&[2, 0, 0, 0])
    {
        require!(
            ctx.remaining_accounts.len() >= 2,
            LazorKitError::SolTransferInsufficientAccounts
        );

        let amount_bytes: [u8; 8] = msg.instruction_data[4..12]
            .try_into()
            .map_err(|_| LazorKitError::CpiDataInvalid)?;

        let amount = u64::from_le_bytes(amount_bytes);

        transfer_sol_from_pda(
            &ctx.accounts.smart_wallet,
            &ctx.remaining_accounts[1].to_account_info(),
            amount,
        )?;
    } else {
        let wallet_signer = PdaSigner {
            seeds: vec![SMART_WALLET_SEED.to_vec(), id.to_le_bytes().to_vec()],
            bump: ctx.bumps.smart_wallet,
        };
        execute_cpi(
            ctx.remaining_accounts,
            &msg.instruction_data,
            &ctx.accounts.cpi_program,
            Some(wallet_signer),
        )?;
    }

    // --- Update state ---
    ctx.accounts.smart_wallet_config.last_nonce = ctx
        .accounts
        .smart_wallet_config
        .last_nonce
        .checked_add(1)
        .ok_or(LazorKitError::NonceOverflow)?;

    // transfer the fee from smart-wallet to payer
    transfer_sol_from_pda(
        &ctx.accounts.smart_wallet,
        &mut ctx.accounts.payer,
        ctx.accounts.config.execute_instruction_fee,
    )?;

    Ok(())
}

/// Accounts context for execute_instruction
#[derive(Accounts)]
#[instruction(args: ExecuteInstructionArgs)]
pub struct ExecuteInstruction<'info> {
    pub payer: Signer<'info>,

    #[account(
        seeds = [Config::PREFIX_SEED],
        bump,
        owner = ID
    )]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [SMART_WALLET_SEED, smart_wallet_config.id.to_le_bytes().as_ref()],
        bump,
        owner = ID,
    )]
    /// CHECK: Only used for key and seeds.
    pub smart_wallet: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [SmartWalletConfig::PREFIX_SEED, smart_wallet.key().as_ref()],
        bump,
        owner = ID,
    )]
    pub smart_wallet_config: Account<'info, SmartWalletConfig>,

    #[account(
        seeds = [
            SmartWalletAuthenticator::PREFIX_SEED,
            smart_wallet.key().as_ref(),
            args.passkey_pubkey.to_hashed_bytes(smart_wallet.key()).as_ref()
        ],
        bump,
        owner = ID,
    )]
    pub smart_wallet_authenticator: Box<Account<'info, SmartWalletAuthenticator>>,

    #[account(address = IX_ID)]
    /// CHECK: Sysvar for instructions.
    pub ix_sysvar: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,

    /// CHECK: Used for CPI, not deserialized.
    pub cpi_program: UncheckedAccount<'info>,
}
