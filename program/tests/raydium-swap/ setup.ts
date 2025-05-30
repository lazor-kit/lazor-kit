import { PublicKey } from '@solana/web3.js';
import { OPENBOOK_MARKET, AMM_PROGRAM_ID, FEE_DESTINATION } from './config';
import {
  MARKET_STATE_LAYOUT_V3,
  Raydium,
  TxVersion,
} from '@raydium-io/raydium-sdk-v2';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import BN from 'bn.js';

export const createMarket = async ({
  baseToken,
  quoteToken,
  raydium,
}: {
  baseToken: PublicKey;
  quoteToken: PublicKey;
  raydium: Raydium;
}): Promise<PublicKey> => {
  // check mint info here: https://api-v3.raydium.io/mint/list
  // or get mint info by api: await raydium.token.getTokenInfo('mint address')

  const { execute, extInfo, transactions } = await raydium.marketV2.create({
    baseInfo: {
      // create market doesn't support token 2022
      mint: baseToken,
      decimals: 9,
    },
    quoteInfo: {
      // create market doesn't support token 2022
      mint: quoteToken,
      decimals: 9,
    },
    lotSize: 1,
    tickSize: 0.01,
    dexProgramId: OPENBOOK_MARKET,
    // dexProgramId: DEVNET_PROGRAM_ID.OPENBOOK_MARKET, // devnet
    txVersion: TxVersion.LEGACY,
    // requestQueueSpace: 5120 + 12, // optional
    // eventQueueSpace: 262144 + 12, // optional
    // orderbookQueueSpace: 65536 + 12, // optional

    // optional: set up priority fee here
    // computeBudgetConfig: {
    //   units: 600000,
    //   microLamports: 46591500,
    // },
  });

  console.log(
    `create market total ${transactions.length} txs, market info: `,
    Object.keys(extInfo.address).reduce(
      (acc, cur) => ({
        ...acc,
        [cur]: extInfo.address[cur as keyof typeof extInfo.address].toBase58(),
      }),
      {}
    )
  );

  const txIds = await execute({
    // set sequentially to true means tx will be sent when previous one confirmed
    sequentially: true,
  });

  console.log(
    'note: create market does not support token 2022, if you need more detail error info, set txVersion to TxVersion.LEGACY'
  );
  console.log('create market txIds:', txIds);

  return extInfo.address.marketId;
};

export const createAmmPool = async ({
  baseToken,
  quoteToken,
  raydium,
}: {
  baseToken: PublicKey;
  quoteToken: PublicKey;
  raydium: Raydium;
}): Promise<string> => {
  const marketId = await createMarket({
    raydium,
    baseToken,
    quoteToken,
  });

  // if you are confirmed your market info, don't have to get market info from rpc below
  const marketBufferInfo = await raydium.connection.getAccountInfo(
    new PublicKey(marketId)
  );
  const { baseMint, quoteMint } = MARKET_STATE_LAYOUT_V3.decode(
    marketBufferInfo!.data
  );

  // check mint info here: https://api-v3.raydium.io/mint/list
  // or get mint info by api: await raydium.token.getTokenInfo('mint address')

  // amm pool doesn't support token 2022
  const baseMintInfo = await raydium.token.getTokenInfo(baseMint);
  const quoteMintInfo = await raydium.token.getTokenInfo(quoteMint);
  const baseAmount = new BN(100 * 10 ** baseMintInfo.decimals);
  const quoteAmount = new BN(100 * 10 ** quoteMintInfo.decimals);

  if (
    baseMintInfo.programId !== TOKEN_PROGRAM_ID.toBase58() ||
    quoteMintInfo.programId !== TOKEN_PROGRAM_ID.toBase58()
  ) {
    throw new Error(
      'amm pools with openbook market only support TOKEN_PROGRAM_ID mints, if you want to create pool with token-2022, please create cpmm pool instead'
    );
  }

  if (
    baseAmount
      .mul(quoteAmount)
      .lte(new BN(1).mul(new BN(10 ** baseMintInfo.decimals)).pow(new BN(2)))
  ) {
    throw new Error(
      'initial liquidity too low, try adding more baseAmount/quoteAmount'
    );
  }

  const { execute, extInfo } = await raydium.liquidity.createPoolV4({
    programId: AMM_PROGRAM_ID,
    // programId: DEVNET_PROGRAM_ID.AmmV4, // devnet
    marketInfo: {
      marketId,
      programId: OPENBOOK_MARKET,
      // programId: DEVNET_PROGRAM_ID.OPENBOOK_MARKET, // devent
    },
    baseMintInfo: {
      mint: baseMint,
      decimals: baseMintInfo.decimals, // if you know mint decimals here, can pass number directly
    },
    quoteMintInfo: {
      mint: quoteMint,
      decimals: quoteMintInfo.decimals, // if you know mint decimals here, can pass number directly
    },
    baseAmount: baseAmount,
    quoteAmount: quoteAmount,

    // sol devnet faucet: https://faucet.solana.com/
    // baseAmount: new BN(4 * 10 ** 9), // if devent pool with sol/wsol, better use amount >= 4*10**9
    // quoteAmount: new BN(4 * 10 ** 9), // if devent pool with sol/wsol, better use amount >= 4*10**9

    startTime: new BN(0), // unit in seconds
    ownerInfo: {
      useSOLBalance: true,
    },
    associatedOnly: false,
    txVersion: TxVersion.LEGACY,
    feeDestinationId: FEE_DESTINATION,
    // feeDestinationId: DEVNET_PROGRAM_ID.FEE_DESTINATION_ID, // devnet
    // optional: set up priority fee here
    // computeBudgetConfig: {
    //   units: 600000,
    //   microLamports: 4659150,
    // },
  });

  // don't want to wait confirm, set sendAndConfirm to false or don't pass any params to execute
  const { txId } = await execute({ sendAndConfirm: true });
  console.log(
    'amm pool created! txId: ',
    txId,
    ', poolKeys:',
    Object.keys(extInfo.address).reduce(
      (acc, cur) => ({
        ...acc,
        [cur]: extInfo.address[cur as keyof typeof extInfo.address].toBase58(),
      }),
      {}
    )
  );

  return extInfo.address.ammId.toString();
};
