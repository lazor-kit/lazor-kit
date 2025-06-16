use anchor_lang::prelude::*;
use anchor_lang::system_program::ID as SYSTEM_ID;
use anchor_spl::token::ID as SPL_TOKEN;
use lazorkit::{
    constants::SOL_TRANSFER_DISCRIMINATOR, program::Lazorkit, state::SmartWalletAuthenticator,
};

use crate::{
    errors::TransferLimitError,
    state::{Member, MemberType, RuleData},
    ID,
};

pub fn check_rule(
    ctx: Context<CheckRule>,
    _token: Option<Pubkey>,
    cpi_data: Vec<u8>,
    program_id: Pubkey,
) -> Result<()> {
    let member = &ctx.accounts.member;
    let rule_data = &ctx.accounts.rule_data;

    // check if admin or not initialized
    require!(
        member.is_initialized,
        TransferLimitError::MemberNotInitialized
    );

    if member.member_type != MemberType::Admin && rule_data.is_initialized {
        // check program_id must equal system program, token program or token 2022 program
        if program_id != SYSTEM_ID && program_id != SPL_TOKEN {
            return Err(TransferLimitError::UnAuthorize.into());
        } else {
            if cpi_data.get(0..4) == Some(&SOL_TRANSFER_DISCRIMINATOR) && program_id == SYSTEM_ID {
                let amount = u64::from_le_bytes(cpi_data[4..12].try_into().unwrap());
                if amount > rule_data.limit_amount {
                    return Err(TransferLimitError::TransferAmountExceedLimit.into());
                }
            } else if cpi_data.get(0..4) == Some(&SOL_TRANSFER_DISCRIMINATOR)
                && program_id == SPL_TOKEN
            {
                let amount = u64::from_le_bytes(cpi_data[4..12].try_into().unwrap());
                if amount > rule_data.limit_amount {
                    return Err(TransferLimitError::TransferAmountExceedLimit.into());
                }
            } else {
                return Err(TransferLimitError::UnAuthorize.into());
            }
        }
    }
    Ok(())
}

#[derive(Accounts)]
#[instruction(token: Option<Pubkey>)]
pub struct CheckRule<'info> {
    #[account(
        owner = lazorkit.key(),
        signer,
    )]
    pub smart_wallet_authenticator: Account<'info, SmartWalletAuthenticator>,

    #[account(
        seeds = [Member::PREFIX_SEED, smart_wallet_authenticator.smart_wallet.key().as_ref(), smart_wallet_authenticator.key().as_ref()],
        bump,
        owner = ID,
    )]
    pub member: Account<'info, Member>,

    #[account(
        seeds = [RuleData::PREFIX_SEED, smart_wallet_authenticator.smart_wallet.key().as_ref(), token.as_ref().unwrap_or(&Pubkey::default()).as_ref()],
        bump,
        owner = ID,
    )]
    pub rule_data: Box<Account<'info, RuleData>>,

    pub lazorkit: Program<'info, Lazorkit>,
}
