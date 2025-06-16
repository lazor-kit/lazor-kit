import { Connection, Keypair, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
  Raydium,
  parseTokenAccountResp,
  TxVersion,
} from '@raydium-io/raydium-sdk-v2';

import { ENDPOINT as _ENDPOINT } from '@raydium-io/raydium-sdk';

export const OPENBOOK_MARKET = new PublicKey(
  'EoTcMgcDRTJVZDMZWBoU6rhYHZfkNTVEAfz3uUJRcYGj'
);

export const AMM_PROGRAM_ID = new PublicKey(
  'HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8'
);

export const FEE_DESTINATION = new PublicKey(
  '3XMrhbv989VxAMi3DErLV9eJht1pHppW5LbKxe9fkEFR'
);

export const initSdk = async (params?: {
  loadToken?: boolean;
  owner: PublicKey | Keypair;
  connection: Connection;
  cluster?: 'devnet' | 'mainnet';
}) => {
  let raydium: Raydium | undefined;

  if (raydium) return raydium;
  if (params.connection.rpcEndpoint === clusterApiUrl('mainnet-beta'))
    console.warn(
      'using free rpc node might cause unexpected error, strongly suggest uses paid rpc node'
    );
  console.log(`connect to rpc ${params.connection.rpcEndpoint}`);
  raydium = await Raydium.load({
    owner: params.owner,
    connection: params.connection,
    cluster: params.cluster,
    disableFeatureCheck: true,
    disableLoadToken: !params?.loadToken,
    blockhashCommitment: 'finalized',
    // urlConfigs: {
    //   BASE_HOST: '<API_HOST>', // api url configs, currently api doesn't support devnet
    // },
  });

  /**
   * By default: sdk will automatically fetch token account data when need it or any sol balace changed.
   * if you want to handle token account by yourself, set token account data after init sdk
   * code below shows how to do it.
   * note: after call raydium.account.updateTokenAccount, raydium will not automatically fetch token account
   */

  /*   */
  //   raydium.account.updateTokenAccount(
  //     await fetchTokenAccountData({ ownerPubkey: owner.publicKey })
  //   );
  // connection.onAccountChange(owner.publicKey, async () => {
  //   raydium!.account.updateTokenAccount(await fetchTokenAccountData());
  // });

  return raydium;
};

export const fetchTokenAccountData = async ({
  ownerPubkey,
  connection,
}: {
  ownerPubkey: PublicKey;
  connection: Connection;
}) => {
  const solAccountResp = await connection.getAccountInfo(ownerPubkey);
  const tokenAccountResp = await connection.getTokenAccountsByOwner(
    ownerPubkey,
    { programId: TOKEN_PROGRAM_ID }
  );
  const token2022Req = await connection.getTokenAccountsByOwner(ownerPubkey, {
    programId: TOKEN_2022_PROGRAM_ID,
  });
  const tokenAccountData = parseTokenAccountResp({
    owner: ownerPubkey,
    solAccountResp,
    tokenAccountResp: {
      context: tokenAccountResp.context,
      value: [...tokenAccountResp.value, ...token2022Req.value],
    },
  });
  return tokenAccountData;
};
