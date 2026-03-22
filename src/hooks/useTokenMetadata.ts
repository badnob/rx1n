import { useState, useEffect } from 'react';
import { Connection, PublicKey } from '@solana/web3.js';
import { fetchTokenMetadata } from '../lib/metadataFetcher';

export interface TokenMeta {
  symbol: string;
  name: string;
  logo: string | null;
  supply?: number;
}

export function useTokenMetadata(connection: Connection, mint: string, network: string) {
  const [meta, setMeta] = useState<TokenMeta | null>(null);

  useEffect(() => {
    let active = true;

    if (!mint) {
      setMeta(null);
      return;
    }

    try {
      new PublicKey(mint); 
    } catch {
      setMeta({ symbol: 'ERR', name: 'Invalid Address Format', logo: null });
      return;
    }

    const fetchMeta = async () => {
      setMeta({ symbol: '...', name: 'Querying Ledger...', logo: null });
      const data = await fetchTokenMetadata(connection, mint, network);
      if (active) setMeta(data);
    };

    fetchMeta();

    return () => { active = false; };
  }, [connection, mint, network]);

  return meta;
}
