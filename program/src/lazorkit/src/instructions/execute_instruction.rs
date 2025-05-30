use anchor_lang::{prelude::*, solana_program::sysvar::instructions::load_instruction_at_checked};

use crate::state::Config;
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
    pub message: Vec<u8>,
    pub verify_instruction_index: u8,
    pub rule_data: CpiData,
    pub cpi_data: Option<CpiData>,
    pub action: Action,
    pub create_new_authenticator: Option<[u8; 33]>,
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
    ctx: Context<ExecuteInstruction>,
    args: ExecuteInstructionArgs,
) -> Result<()> {
    // --- Account references ---
    let authenticator = &ctx.accounts.smart_wallet_authenticator;
    let payer = &ctx.accounts.payer;
    let payer_balance_before = payer.lamports();

    // --- Passkey and wallet validation ---
    require!(
        authenticator.passkey_pubkey == args.passkey_pubkey
            && authenticator.smart_wallet == ctx.accounts.smart_wallet.key(),
        LazorKitError::InvalidPasskey
    );

    // --- Signature verification using secp256r1 ---
    let secp_ix = load_instruction_at_checked(
        args.verify_instruction_index as usize,
        &ctx.accounts.ix_sysvar,
    )?;
    verify_secp256r1_instruction(
        &secp_ix,
        authenticator.passkey_pubkey,
        args.message,
        args.signature,
    )?;

    // --- Action dispatch ---
    match args.action {
        Action::ExecuteCpi => {
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
                LazorKitError::InvalidRuleInstruction
            );

            // --- Execute rule CPI ---
            execute_cpi(
                rule_accounts,
                args.rule_data.data.clone(),
                &ctx.accounts.authenticator_program,
                Some(rule_signer),
            )?;

            // --- CPI for main instruction ---
            let cpi_data = args
                .cpi_data
                .as_ref()
                .ok_or(LazorKitError::InvalidAccountInput)?;
            let cpi_accounts = &ctx.remaining_accounts[cpi_data.start_index as usize
                ..(cpi_data.start_index as usize + cpi_data.length as usize)];

            // --- Special handling for SOL transfer ---
            if cpi_data.data.get(0..4) == Some(&SOL_TRANSFER_DISCRIMINATOR)
                && ctx.accounts.cpi_program.key() == anchor_lang::solana_program::system_program::ID
            {
                require!(
                    ctx.remaining_accounts.len() >= 2,
                    LazorKitError::InvalidAccountInput
                );
                let amount = u64::from_le_bytes(cpi_data.data[4..12].try_into().unwrap());
                transfer_sol_from_pda(
                    &ctx.accounts.smart_wallet,
                    &ctx.remaining_accounts[1].to_account_info(),
                    amount,
                )?;
            } else {
                // --- Generic CPI with wallet signer ---
                let wallet = &ctx.accounts.smart_wallet_config;
                let wallet_signer = PdaSigner {
                    seeds: [SMART_WALLET_SEED, wallet.id.to_le_bytes().as_ref()].concat(),
                    bump: wallet.bump,
                };
                execute_cpi(
                    cpi_accounts,
                    cpi_data.data.clone(),
                    &ctx.accounts.cpi_program,
                    Some(wallet_signer),
                )?;
            }
        }
        Action::ChangeProgramRule => {
            // --- Change rule program logic ---
            let old_rule_program_key = ctx.accounts.authenticator_program.key();
            let new_rule_program_key = ctx.accounts.cpi_program.key();
            let whitelist = &ctx.accounts.whitelist_rule_programs;
            let wallet_config = &mut ctx.accounts.smart_wallet_config;
            let cpi_data = args
                .cpi_data
                .as_ref()
                .ok_or(LazorKitError::InvalidAccountInput)?;

            check_whitelist(whitelist, &old_rule_program_key)?;
            check_whitelist(whitelist, &new_rule_program_key)?;

            // --- Destroy/init discriminators check ---
            require!(
                args.rule_data.data.get(0..8) == Some(&sighash("global", "destroy")),
                LazorKitError::InvalidRuleInstruction
            );
            require!(
                cpi_data.data.get(0..8) == Some(&sighash("global", "init_rule")),
                LazorKitError::InvalidRuleInstruction
            );

            // --- Only one of the programs can be the default, and they must differ ---
            let default_rule_program = ctx.accounts.config.default_rule_program;
            require!(
                (old_rule_program_key == default_rule_program
                    || new_rule_program_key == default_rule_program)
                    && (old_rule_program_key != new_rule_program_key),
                LazorKitError::InvalidRuleProgram
            );

            // --- Update rule program in config ---
            wallet_config.rule_program = new_rule_program_key;

            // --- Destroy old rule program ---
            let rule_signer = get_pda_signer(
                &args.passkey_pubkey,
                ctx.accounts.smart_wallet.key(),
                ctx.bumps.smart_wallet_authenticator,
            );
            let rule_accounts = &ctx.remaining_accounts[args.rule_data.start_index as usize
                ..(args.rule_data.start_index as usize + args.rule_data.length as usize)];

            execute_cpi(
                rule_accounts,
                args.rule_data.data.clone(),
                &ctx.accounts.authenticator_program,
                Some(rule_signer.clone()),
            )?;

            // --- Init new rule program ---
            let cpi_accounts = &ctx.remaining_accounts[cpi_data.start_index as usize
                ..(cpi_data.start_index as usize + cpi_data.length as usize)];
            execute_cpi(
                cpi_accounts,
                cpi_data.data.clone(),
                &ctx.accounts.cpi_program,
                Some(rule_signer.clone()),
            )?;
        }
        Action::CallRuleProgram => {
            // --- Call rule program logic ---
            let rule_program_key = ctx.accounts.authenticator_program.key();
            check_whitelist(&ctx.accounts.whitelist_rule_programs, &rule_program_key)?;

            // --- Optionally create a new smart wallet authenticator ---
            if let Some(new_authenticator) = args.create_new_authenticator {
                let new_auth = ctx
                    .accounts
                    .new_smart_wallet_authenticator
                    .as_mut()
                    .unwrap();
                new_auth.smart_wallet = ctx.accounts.smart_wallet.key();
                new_auth.passkey_pubkey = new_authenticator;
                new_auth.bump = ctx.bumps.new_smart_wallet_authenticator.unwrap_or_default();
            } else {
                return Err(LazorKitError::InvalidAccountInput.into());
            }

            let rule_signer = get_pda_signer(
                &args.passkey_pubkey,
                ctx.accounts.smart_wallet.key(),
                ctx.bumps.smart_wallet_authenticator,
            );
            let rule_accounts = &ctx.remaining_accounts[args.rule_data.start_index as usize
                ..(args.rule_data.start_index as usize + args.rule_data.length as usize)];
            execute_cpi(
                rule_accounts,
                args.rule_data.data.clone(),
                &ctx.accounts.authenticator_program,
                Some(rule_signer),
            )?;
        }
        Action::CheckAuthenticator => {
            // --- No-op: used for checking authenticator existence ---
        }
    }

    // --- Reimburse payer if balance changed ---
    let payer_balance_after = payer.lamports().saturating_sub(10000);
    let reimbursement = payer_balance_before.saturating_sub(payer_balance_after);
    if reimbursement > 0 {
        transfer_sol_from_pda(
            &ctx.accounts.smart_wallet,
            &ctx.accounts.payer,
            reimbursement,
        )?;
    }

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
        seeds = [args.passkey_pubkey.to_hashed_bytes(smart_wallet.key()).as_ref()],
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
        init,
        payer = payer,
        space = 8 + SmartWalletAuthenticator::INIT_SPACE,
        seeds = [args.create_new_authenticator.unwrap_or([0; 33]).to_hashed_bytes(smart_wallet.key()).as_ref()],
        bump,
    )]
    pub new_smart_wallet_authenticator: Option<Account<'info, SmartWalletAuthenticator>>,
}
