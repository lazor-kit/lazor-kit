use anchor_lang::{prelude::*, system_program};

use crate::{
    constants::{PASSKEY_SIZE, SMART_WALLET_SEED},
    state::{Config, SmartWalletAuthenticator, SmartWalletConfig, SmartWalletSeq},
    utils::{transfer_sol_from_pda, PasskeyExt},
    ID,
};

pub fn create_smart_wallet(
    ctx: Context<CreateSmartWallet>,
    passkey_pubkey: [u8; PASSKEY_SIZE],
    credential_id: Vec<u8>,
) -> Result<()> {
    // Initialize the smart wallet config
    let smart_wallet_config = &mut ctx.accounts.smart_wallet_config;
    smart_wallet_config.id = ctx.accounts.smart_wallet_seq.seq;
    smart_wallet_config.last_nonce = 0;

    // Initialize the smart wallet authenticator
    let smart_wallet_authenticator = &mut ctx.accounts.smart_wallet_authenticator;
    smart_wallet_authenticator.passkey_pubkey = passkey_pubkey;
    smart_wallet_authenticator.smart_wallet = ctx.accounts.smart_wallet.key();
    smart_wallet_authenticator.credential_id = credential_id;
    smart_wallet_authenticator.bump = ctx.bumps.smart_wallet_authenticator;

    // Increment the sequence for the next smart wallet
    ctx.accounts.smart_wallet_seq.seq += 1;

    // Transfer fee from signer to the config account, if any
    let fee = ctx.accounts.config.create_smart_wallet_fee;
    if fee > 0 {
        let cpi_accounts = system_program::Transfer {
            from: ctx.accounts.signer.to_account_info(),
            to: ctx.accounts.config.to_account_info(),
        };
        let cpi_context =
            CpiContext::new(ctx.accounts.system_program.to_account_info(), cpi_accounts);
        system_program::transfer(cpi_context, fee)?;
    }

    transfer_sol_from_pda(
        &ctx.accounts.smart_wallet,
        &mut ctx.accounts.signer,
        ctx.accounts.config.create_smart_wallet_fee,
    )?;

    Ok(())
}

#[derive(Accounts)]
#[instruction(passkey_pubkey: [u8; PASSKEY_SIZE])]
pub struct CreateSmartWallet<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [SmartWalletSeq::PREFIX_SEED],
        bump,
    )]
    pub smart_wallet_seq: Account<'info, SmartWalletSeq>,

    #[account(
        init,
        payer = signer,
        space = 0,
        seeds = [SMART_WALLET_SEED, smart_wallet_seq.seq.to_le_bytes().as_ref()],
        bump
    )]
    /// CHECK: This PDA acts as a signer for the smart wallet.
    /// It is initialized with 0 space because its data is stored in SmartWalletConfig.
    pub smart_wallet: UncheckedAccount<'info>,

    #[account(
        init,
        payer = signer,
        space = 8 + SmartWalletConfig::INIT_SPACE,
        seeds = [SmartWalletConfig::PREFIX_SEED, smart_wallet.key().as_ref()],
        bump
    )]
    pub smart_wallet_config: Account<'info, SmartWalletConfig>,

    #[account(
        init,
        payer = signer,
        space = 8 + SmartWalletAuthenticator::INIT_SPACE,
        seeds = [
            SmartWalletAuthenticator::PREFIX_SEED,
            smart_wallet.key().as_ref(),
            passkey_pubkey.to_hashed_bytes(smart_wallet.key()).as_ref()
        ],
        bump
    )]
    pub smart_wallet_authenticator: Box<Account<'info, SmartWalletAuthenticator>>,

    #[account(
        mut,
        seeds = [Config::PREFIX_SEED],
        bump,
        owner = ID
    )]
    pub config: Account<'info, Config>,

    pub system_program: Program<'info, System>,
}
