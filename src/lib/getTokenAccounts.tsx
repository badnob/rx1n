import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

export type UiTokenAccount = {
  tokenAccount: string;
  mint: string;
  amountRaw: string;
  decimals: number;
  uiAmountString: string;
  uiAmount: number;
  tokenProgram: 'spl-token' | 'token-2022';
};

function mapParsed(it: any, tokenProgram: UiTokenAccount['tokenProgram']): UiTokenAccount {
  const info = it.account.data.parsed.info;
  const ta = info.tokenAmount;
  return {
    tokenAccount: it.pubkey.toBase58(),
    mint: info.mint as string,
    amountRaw: ta.amount as string,
    decimals: ta.decimals as number,
    uiAmountString: (ta.uiAmountString ?? '0') as string,
    uiAmount: (ta.uiAmount ?? 0) as number,
    tokenProgram,
  };
}

export async function getTokenAccounts(connection: Connection, owner: PublicKey): Promise<UiTokenAccount[]> {
  const [spl, t22] = await Promise.all([
    connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
    connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }),
  ]);

  const all = [
    ...spl.value.map((it) => mapParsed(it, 'spl-token')),
    ...t22.value.map((it) => mapParsed(it, 'token-2022')),
  ];

  const seen = new Set();
  const deduped: UiTokenAccount[] = [];
  for (const x of all) {
    if (seen.has(x.tokenAccount)) continue;
    seen.add(x.tokenAccount);
    deduped.push(x);
  }
  return deduped;
}
