use anchor_lang::prelude::*;

mod errors;
mod instructions;
mod state;

use instructions::*;

declare_id!("HjgdxTNPqpL59KLRVDwQ28cqam2SxBirnNN5SFAFGHZ8");

#[program]
pub mod transfer_limit {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, lazorkit_author: Pubkey) -> Result<()> {
        instructions::initialize(ctx, lazorkit_author)
    }

    pub fn init_rule(ctx: Context<InitRule>, init_rule_args: InitRuleArgs) -> Result<()> {
        instructions::init_rule(ctx, init_rule_args)
    }

    pub fn add_member(
        ctx: Context<AddMember>,
        new_passkey_pubkey: [u8; 33],
        bump: u8,
    ) -> Result<()> {
        instructions::add_member(ctx, new_passkey_pubkey, bump)
    }

    pub fn check_rule(
        ctx: Context<CheckRule>,
        token: Option<Pubkey>,
        cpi_data: Vec<u8>,
        program_id: Pubkey,
    ) -> Result<()> {
        instructions::check_rule(ctx, token, cpi_data, program_id)
    }

    // pub fn execute_instruction<'c: 'info, 'info>(
    //     ctx: Context<'_, '_, 'c, 'info, ExecuteInstruction<'info>>,
    //     args: ExecuteInstructionArgs,
    // ) -> Result<()> {
    //     instructions::execute_instruction(ctx, args)
    // }
}
