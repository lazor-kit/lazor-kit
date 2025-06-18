use anchor_lang::solana_program::hash::hash; // ✅ required import

use anchor_lang::{prelude::*, solana_program::sysvar::instructions::load_instruction_at_checked};

use crate::state::{Config, Message};
use crate::utils::{
    check_whitelist, execute_cpi, get_pda_signer, sighash, transfer_sol_from_pda,
    verify_secp256r1_instruction, PasskeyExt, PdaSigner,
};
use crate::{
    constants::{SMART_WALLET_SEED, SOL_TRANSFER_DISCRIMINATOR},
    error::LazorKitError,
    state::{SmartWalletAuthenticator, SmartWalletConfig, WhitelistRulePrograms},
    ID,
};
use anchor_lang::solana_program::sysvar::instructions::ID as IX_ID;
use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};

const MAX_TIMESTAMP_DRIFT_SECONDS: i64 = 30;

/// Enum for supported actions in the instruction
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub enum Action {
    #[default]
    ExecuteCpi,
    ChangeProgramRule,
    CheckAuthenticator,
    CallRuleProgram,
}

/// Arguments for the execute_instruction entrypoint
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ExecuteInstructionArgs {
    pub passkey_pubkey: [u8; 33],
    pub signature: Vec<u8>,
    pub client_data_json_raw: Vec<u8>, // Match field name used in SDK
    pub authenticator_data_raw: Vec<u8>,   // Added missing field
    pub verify_instruction_index: u8,
    pub rule_data: CpiData,
    pub cpi_data: Option<CpiData>,
    pub action: Action,
    pub create_new_authenticator: Option<[u8; 33]>, // Make sure this field name is consistent
}

/// Data for a CPI call (instruction data and account slice)
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CpiData {
    pub data: Vec<u8>,
    pub start_index: u8, // starting index in remaining accounts
    pub length: u8,      // number of accounts to take from remaining accounts
}

/// Entrypoint for executing smart wallet instructions
pub fn execute_instruction(
    mut ctx: Context<ExecuteInstruction>,
    args: ExecuteInstructionArgs,
) -> Result<()> {
    verify_passkey_and_signature(&ctx, &args, ctx.accounts.smart_wallet_config.last_nonce)?;

    // --- Action dispatch ---
    match args.action {
        Action::ExecuteCpi => handle_execute_cpi(&mut ctx, &args)?,
        Action::ChangeProgramRule => handle_change_program_rule(&mut ctx, &args)?,
        Action::CallRuleProgram => handle_call_rule_program(&mut ctx, &args)?,
        Action::CheckAuthenticator => {
            // --- No-op: used for checking authenticator existence ---
        }
    }

    // update last nonce
    ctx.accounts.smart_wallet_config.last_nonce = ctx
        .accounts
        .smart_wallet_config
        .last_nonce
        .checked_add(1)
        .ok_or(LazorKitError::NonceOverflow)?;

    Ok(())
}

fn verify_passkey_and_signature(
    ctx: &Context<ExecuteInstruction>,
    args: &ExecuteInstructionArgs,
    last_nonce: u64,
) -> Result<()> {
    let authenticator = &ctx.accounts.smart_wallet_authenticator;

    // --- Passkey validation ---
    require!(
        authenticator.passkey_pubkey == args.passkey_pubkey,
        LazorKitError::PasskeyMismatch
    );

    // --- Smart wallet validation ---
    require!(
        authenticator.smart_wallet == ctx.accounts.smart_wallet.key(),
        LazorKitError::SmartWalletMismatch
    );

    // --- Signature verification using secp256r1 ---
    let secp_ix = load_instruction_at_checked(
        args.verify_instruction_index as usize,
        &ctx.accounts.ix_sysvar,
    )?;

    let client_hash = hash(&args.client_data_json_raw);

    let mut message = Vec::with_capacity(args.authenticator_data_raw.len() + client_hash.as_ref().len());
    message.extend_from_slice(&args.authenticator_data_raw);
    message.extend_from_slice(client_hash.as_ref());

    let json_str = core::str::from_utf8(&args.client_data_json_raw)
        .map_err(|_| LazorKitError::ClientDataInvalidUtf8)?;
    let parsed: serde_json::Value =
        serde_json::from_str(json_str).map_err(|_| LazorKitError::ClientDataJsonParseError)?;
    let challenge = parsed["challenge"]
        .as_str()
        .ok_or(LazorKitError::ChallengeMissing)?;

    msg!("challenge: {:?}", challenge);

    // Remove surrounding quotes, slashes and whitespace from challenge
    let challenge_clean = challenge
        .trim_matches(|c| c == '"' || c == '\'' || c == '/' || c == ' ');
    let challenge_bytes = STANDARD_NO_PAD
        .decode(challenge_clean)
        .map_err(|_| LazorKitError::ChallengeBase64DecodeError)?;

    msg!("challenge_bytes: {:?}", challenge_bytes);
    msg!("As UTF-8: {}", String::from_utf8_lossy(&challenge_bytes));


    let msg = Message::try_from_slice(&challenge_bytes)
        .map_err(|_| LazorKitError::ChallengeDeserializationError)?;

    msg!("msg: {:?}", msg);

    let now = Clock::get()?.unix_timestamp;

    // check if timestamp is within the allowed drift
    if msg.timestamp < now.saturating_sub(MAX_TIMESTAMP_DRIFT_SECONDS) {
        return Err(LazorKitError::TimestampTooOld.into());
    }
    if msg.timestamp > now.saturating_add(MAX_TIMESTAMP_DRIFT_SECONDS) {
        return Err(LazorKitError::TimestampTooNew.into());
    }

    // check if nonce matches the expected nonce
    require!(msg.nonce == last_nonce, LazorKitError::NonceMismatch);

    verify_secp256r1_instruction(
        &secp_ix,
        authenticator.passkey_pubkey,
        message,
        args.signature.clone(),
    )
}

fn handle_execute_cpi(
    ctx: &mut Context<ExecuteInstruction>,
    args: &ExecuteInstructionArgs,
) -> Result<()> {
    // --- Rule program whitelist check ---
    let rule_program_key = ctx.accounts.authenticator_program.key();
    check_whitelist(&ctx.accounts.whitelist_rule_programs, &rule_program_key)?;

    // --- Prepare PDA signer for rule CPI ---
    let rule_signer = get_pda_signer(
        &args.passkey_pubkey,
        ctx.accounts.smart_wallet.key(),
        ctx.bumps.smart_wallet_authenticator,
    );
    let rule_accounts = &ctx.remaining_accounts[args.rule_data.start_index as usize
        ..(args.rule_data.start_index as usize + args.rule_data.length as usize)];

    // --- Rule instruction discriminator check ---
    require!(
        args.rule_data.data.get(0..8) == Some(&sighash("global", "check_rule")),
        LazorKitError::InvalidCheckRuleDiscriminator
    );

    // --- Execute rule CPI ---
    execute_cpi(
        rule_accounts,
        &args.rule_data.data,
        &ctx.accounts.authenticator_program,
        Some(rule_signer),
    )?;

    // --- CPI for main instruction ---
    let cpi_data = args
        .cpi_data
        .as_ref()
        .ok_or(LazorKitError::CpiDataMissing)?;
    let cpi_accounts = &ctx.remaining_accounts
        [cpi_data.start_index as usize..(cpi_data.start_index as usize + cpi_data.length as usize)];

    // --- Special handling for SOL transfer ---
    if cpi_data.data.get(0..4) == Some(&SOL_TRANSFER_DISCRIMINATOR)
        && ctx.accounts.cpi_program.key() == anchor_lang::solana_program::system_program::ID
    {
        require!(
            ctx.remaining_accounts.len() >= 2,
            LazorKitError::SolTransferInsufficientAccounts
        );
        let amount = u64::from_le_bytes(cpi_data.data[4..12].try_into().unwrap());
        transfer_sol_from_pda(
            &ctx.accounts.smart_wallet,
            &ctx.remaining_accounts[1].to_account_info(),
            amount,
        )?;
    } else {
        // --- Generic CPI with wallet signer ---
        let wallet_signer = PdaSigner {
            seeds: vec![
                SMART_WALLET_SEED.to_vec(),
                ctx.accounts.smart_wallet_config.id.to_le_bytes().to_vec(),
            ],
            bump: ctx.accounts.smart_wallet_config.bump,
        };
        execute_cpi(
            cpi_accounts,
            &cpi_data.data,
            &ctx.accounts.cpi_program,
            Some(wallet_signer),
        )?;
    }
    Ok(())
}

fn handle_change_program_rule(
    ctx: &mut Context<ExecuteInstruction>,
    args: &ExecuteInstructionArgs,
) -> Result<()> {
    // --- Change rule program logic ---
    let old_rule_program_key = ctx.accounts.authenticator_program.key();
    let new_rule_program_key = ctx.accounts.cpi_program.key();
    let whitelist = &ctx.accounts.whitelist_rule_programs;
    let cpi_data = args
        .cpi_data
        .as_ref()
        .ok_or(LazorKitError::CpiDataMissing)?;

    check_whitelist(whitelist, &old_rule_program_key)?;
    check_whitelist(whitelist, &new_rule_program_key)?;

    // --- Destroy/init discriminators check ---
    require!(
        args.rule_data.data.get(0..8) == Some(&sighash("global", "destroy")),
        LazorKitError::InvalidDestroyDiscriminator
    );
    require!(
        cpi_data.data.get(0..8) == Some(&sighash("global", "init_rule")),
        LazorKitError::InvalidInitRuleDiscriminator
    );

    // --- Ensure programs are different ---
    require!(
        old_rule_program_key != new_rule_program_key,
        LazorKitError::RuleProgramsIdentical
    );

    // --- Only one of the programs can be the default ---
    let default_rule_program = ctx.accounts.config.default_rule_program;
    require!(
        old_rule_program_key == default_rule_program
            || new_rule_program_key == default_rule_program,
        LazorKitError::NoDefaultRuleProgram
    );

    // --- Update rule program in config ---
    ctx.accounts.smart_wallet_config.rule_program = new_rule_program_key;

    // --- Destroy old rule program ---
    let rule_signer = get_pda_signer(
        &args.passkey_pubkey,
        ctx.accounts.smart_wallet.key(),
        ctx.bumps.smart_wallet_authenticator,
    );
    let rule_accounts = &ctx.remaining_accounts
        [args.rule_data.start_index as usize..(args.rule_data.start_index as usize + args.rule_data.length as usize)];

    execute_cpi(
        rule_accounts,
        &args.rule_data.data,
        &ctx.accounts.authenticator_program,
        Some(rule_signer.clone()),
    )?;

    // --- Init new rule program ---
    let cpi_accounts = &ctx.remaining_accounts
        [cpi_data.start_index as usize..(cpi_data.start_index as usize + cpi_data.length as usize)];
    execute_cpi(
        cpi_accounts,
        &cpi_data.data,
        &ctx.accounts.cpi_program,
        Some(rule_signer),
    )?;
    Ok(())
}

fn handle_call_rule_program(
    ctx: &mut Context<ExecuteInstruction>,
    args: &ExecuteInstructionArgs,
) -> Result<()> {
    // --- Call rule program logic ---
    let rule_program_key = ctx.accounts.authenticator_program.key();
    check_whitelist(&ctx.accounts.whitelist_rule_programs, &rule_program_key)?;

    // --- Optionally create a new smart wallet authenticator ---
    if let Some(new_authenticator_pubkey) = args.create_new_authenticator {
        let new_auth = ctx
            .accounts
            .new_smart_wallet_authenticator
            .as_mut()
            .ok_or(LazorKitError::NewAuthenticatorMissing)?;
        new_auth.smart_wallet = ctx.accounts.smart_wallet.key();
        new_auth.passkey_pubkey = new_authenticator_pubkey;
        new_auth.bump = ctx.bumps.new_smart_wallet_authenticator.unwrap_or_default();
    } else {
        return Err(LazorKitError::NewAuthenticatorPasskeyMissing.into());
    }

    let rule_signer = get_pda_signer(
        &args.passkey_pubkey,
        ctx.accounts.smart_wallet.key(),
        ctx.bumps.smart_wallet_authenticator,
    );
    let rule_accounts = &ctx.remaining_accounts
        [args.rule_data.start_index as usize..(args.rule_data.start_index as usize + args.rule_data.length as usize)];
    execute_cpi(
        rule_accounts,
        &args.rule_data.data,
        &ctx.accounts.authenticator_program,
        Some(rule_signer),
    )?;
    Ok(())
}

/// Accounts context for execute_instruction
#[derive(Accounts)]
#[instruction(args: ExecuteInstructionArgs)]
pub struct ExecuteInstruction<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [Config::PREFIX_SEED],
        bump,
        owner = ID
    )]
    pub config: Box<Account<'info, Config>>,

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
    pub smart_wallet_config: Box<Account<'info, SmartWalletConfig>>,

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

    #[account(
        seeds = [WhitelistRulePrograms::PREFIX_SEED],
        bump,
        owner = ID
    )]
    pub whitelist_rule_programs: Box<Account<'info, WhitelistRulePrograms>>,

    /// CHECK: Used for rule CPI.
    pub authenticator_program: UncheckedAccount<'info>,

    #[account(address = IX_ID)]
    /// CHECK: Sysvar for instructions.
    pub ix_sysvar: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,

    /// CHECK: Used for CPI, not deserialized.
    pub cpi_program: UncheckedAccount<'info>,

    #[account(
        init_if_needed, // Change to init_if_needed to handle both cases
        payer = payer,
        space = 8 + SmartWalletAuthenticator::INIT_SPACE,
        seeds = [
            SmartWalletAuthenticator::PREFIX_SEED,  // Add this constant seed
            smart_wallet.key().as_ref(), 
            args.create_new_authenticator.unwrap_or([0; 33]).to_hashed_bytes(smart_wallet.key()).as_ref()
        ],
        bump,
    )]
    pub new_smart_wallet_authenticator: Option<Account<'info, SmartWalletAuthenticator>>,
}
