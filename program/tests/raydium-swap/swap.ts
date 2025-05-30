import {
  ApiV3PoolInfoStandardItem,
  AmmV4Keys,
  AmmRpcData,
  parseTokenAccountResp,
  TxVersion,
} from '@raydium-io/raydium-sdk-v2';
import { initSdk } from './config';
import BN from 'bn.js';
import Decimal from 'decimal.js';
import { isValidAmm } from './util';
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
} from '@solana/web3.js';
import { createAmmPool } from './ setup';
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { AnchorProvider } from '@coral-xyz/anchor';

export const prepareSwapInstruction = async ({
  connection,
  smartWalletPubkey,
  creator,
  baseToken,
  quoteToken,
}: {
  connection: Connection;
  smartWalletPubkey: PublicKey;
  creator: Keypair;
  baseToken: PublicKey;
  quoteToken: PublicKey;
}): Promise<TransactionInstruction> => {
  const raydium = await initSdk({
    owner: creator,
    connection,
    cluster: 'devnet',
  });

  const amountIn = 1 * 10 ** 9;
  const inputMint = baseToken.toString();

  const poolId = await createAmmPool({
    baseToken,
    quoteToken,
    raydium,
  }); // SOL-USDC pool

  raydium.setOwner(smartWalletPubkey);

  raydium.account.updateTokenAccount(
    await fetchTokenAccountData({
      owner: smartWalletPubkey,
      connection,
    })
  );

  connection.onAccountChange(smartWalletPubkey, async () => {
    raydium!.account.updateTokenAccount(
      await fetchTokenAccountData({
        owner: smartWalletPubkey,
        connection,
      })
    );
  });

  let poolInfo: ApiV3PoolInfoStandardItem | undefined;
  let poolKeys: AmmV4Keys | undefined;
  let rpcData: AmmRpcData;

  if (raydium.cluster === 'mainnet') {
    // note: api doesn't support get devnet pool info, so in devnet else we go rpc method
    // if you wish to get pool info from rpc, also can modify logic to go rpc method directly
    const data = await raydium.api.fetchPoolById({ ids: poolId });

    poolInfo = data[0] as ApiV3PoolInfoStandardItem;

    if (!isValidAmm(poolInfo.programId))
      throw new Error('target pool is not AMM pool');
    poolKeys = await raydium.liquidity.getAmmPoolKeys(poolId);
    rpcData = await raydium.liquidity.getRpcPoolInfo(poolId);
  } else {
    // note: getPoolInfoFromRpc method only return required pool data for computing not all detail pool info
    const data = await raydium.liquidity.getPoolInfoFromRpc({ poolId });
    poolInfo = data.poolInfo;
    poolKeys = data.poolKeys;
    rpcData = data.poolRpcData;
  }
  const [baseReserve, quoteReserve, status] = [
    rpcData.baseReserve,
    rpcData.quoteReserve,
    rpcData.status.toNumber(),
  ];

  if (
    poolInfo.mintA.address !== inputMint &&
    poolInfo.mintB.address !== inputMint
  )
    throw new Error('input mint does not match pool');

  const baseIn = inputMint === poolInfo.mintA.address;
  const [mintIn, mintOut] = baseIn
    ? [poolInfo.mintA, poolInfo.mintB]
    : [poolInfo.mintB, poolInfo.mintA];

  const out = raydium.liquidity.computeAmountOut({
    poolInfo: {
      ...poolInfo,
      baseReserve,
      quoteReserve,
      status,
      version: 4,
    },
    amountIn: new BN(amountIn),
    mintIn: mintIn.address,
    mintOut: mintOut.address,
    slippage: 0.01, // range: 1 ~ 0.0001, means 100% ~ 0.01%
  });

  console.log(
    `computed swap ${new Decimal(amountIn)
      .div(10 ** mintIn.decimals)
      .toDecimalPlaces(mintIn.decimals)
      .toString()} ${mintIn.symbol || mintIn.address} to ${new Decimal(
      out.amountOut.toString()
    )
      .div(10 ** mintOut.decimals)
      .toDecimalPlaces(mintOut.decimals)
      .toString()} ${
      mintOut.symbol || mintOut.address
    }, minimum amount out ${new Decimal(out.minAmountOut.toString())
      .div(10 ** mintOut.decimals)
      .toDecimalPlaces(mintOut.decimals)} ${mintOut.symbol || mintOut.address}`
  );

  const { transaction } = await raydium.liquidity.swap({
    poolInfo,
    poolKeys,
    amountIn: new BN(amountIn),
    amountOut: out.minAmountOut, // out.amountOut means amount 'without' slippage
    fixedSide: 'in',
    inputMint: mintIn.address,
    txVersion: TxVersion.LEGACY,

    // optional: set up token account
    // config: {
    //   inputUseSolBalance: true, // default: true, if you want to use existed wsol token account to pay token in, pass false
    //   outputUseSolBalance: true, // default: true, if you want to use existed wsol token account to receive token out, pass false
    //   associatedOnly: true, // default: true, if you want to use ata only, pass true
    // },

    // optional: set up priority fee here
    // computeBudgetConfig: {
    //   units: 600000,
    //   microLamports: 46591500,
    // },

    // optional: add transfer sol to tip account instruction. e.g sent tip to jito
    // txTipConfig: {
    //   address: new PublicKey('96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5'),
    //   amount: new BN(10000000), // 0.01 sol
    // },
  });

  //   printSimulateInfo();
  //   // don't want to wait confirm, set sendAndConfirm to false or don't pass any params to execute
  //   const { txId } = await execute({ sendAndConfirm: true });
  //   console.log(`swap successfully in amm pool:`, {
  //     txId: `https://explorer.solana.com/tx/${txId}?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899`,
  //   });

  return transaction.instructions[0];
};

export const setup = async ({
  smartWalletPubkey,
  wallet,
  anchorProvider,
}: {
  smartWalletPubkey: PublicKey;
  wallet: Keypair;
  anchorProvider: AnchorProvider;
}): Promise<TransactionInstruction> => {
  const baseToken = await createMint(
    anchorProvider.connection,
    wallet,
    wallet.publicKey,
    wallet.publicKey,
    9
  );

  console.log('Base token mint:', baseToken.toBase58());

  // create ata base token for smart wallet
  const smartWalletBaseAta = await getOrCreateAssociatedTokenAccount(
    anchorProvider.connection,
    wallet,
    baseToken,
    smartWalletPubkey,
    true
  );

  // mint base token to smart wallet
  mintTo(
    anchorProvider.connection,
    wallet,
    baseToken,
    smartWalletBaseAta.address,
    wallet.publicKey,
    1_000_000 * 10 ** 9
  );

  // create base token ata for wallet
  const walletBaseAta = await getOrCreateAssociatedTokenAccount(
    anchorProvider.connection,
    wallet,
    baseToken,
    wallet.publicKey,
    false
  );

  // mint base token to wallet
  mintTo(
    anchorProvider.connection,
    wallet,
    baseToken,
    walletBaseAta.address,
    wallet.publicKey,
    1_000_000 * 10 ** 9
  );

  const quoteToken = await createMint(
    anchorProvider.connection,
    wallet,
    wallet.publicKey,
    wallet.publicKey,
    9
  );

  console.log('Quote token mint:', quoteToken.toBase58());

  // create ata quote token for smart wallet
  const smartWalletQuoteAta = await getOrCreateAssociatedTokenAccount(
    anchorProvider.connection,
    wallet,
    quoteToken,
    smartWalletPubkey,
    true
  );

  // mint quote token to smart wallet
  mintTo(
    anchorProvider.connection,
    wallet,
    quoteToken,
    smartWalletQuoteAta.address,
    wallet.publicKey,
    1_000_000 * 10 ** 9
  );

  // create quote token ata for wallet
  const walletQuoteAta = await getOrCreateAssociatedTokenAccount(
    anchorProvider.connection,
    wallet,
    quoteToken,
    wallet.publicKey,
    false
  );

  // mint quote token to wallet
  mintTo(
    anchorProvider.connection,
    wallet,
    quoteToken,
    walletQuoteAta.address,
    wallet.publicKey,
    1_000_000 * 10 ** 9
  );

  return await prepareSwapInstruction({
    connection: anchorProvider.connection,
    smartWalletPubkey,
    creator: wallet,
    baseToken,
    quoteToken,
  });
};
export const fetchTokenAccountData = async ({
  owner,
  connection,
}: {
  owner: PublicKey;
  connection: Connection;
}) => {
  const solAccountResp = await connection.getAccountInfo(owner);
  const tokenAccountResp = await connection.getTokenAccountsByOwner(owner, {
    programId: TOKEN_PROGRAM_ID,
  });
  const token2022Req = await connection.getTokenAccountsByOwner(owner, {
    programId: TOKEN_2022_PROGRAM_ID,
  });
  const tokenAccountData = parseTokenAccountResp({
    owner: owner,
    solAccountResp,
    tokenAccountResp: {
      context: tokenAccountResp.context,
      value: [...tokenAccountResp.value, ...token2022Req.value],
    },
  });
  return tokenAccountData;
};
