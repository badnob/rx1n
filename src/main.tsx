// src/main.tsx
import React, { useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css';

import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import '@solana/wallet-adapter-react-ui/styles.css';

function Root() {
  // 1. Add Network State
  const [network, setNetwork] = useState<'mainnet' | 'testnet'>('mainnet');

  // 2. Dynamically set the RPC based on state
  const endpoint = network === 'mainnet' 
    ? 'https://rpc.mainnet.x1.xyz' // Replace with official X1 mainnet RPC if different
    : 'https://rpc.testnet.x1.xyz';

  // Empty array! Modern wallets like Phantom, Backpack, and Solflare auto-detect automatically.
  const wallets = useMemo(() => [], [network]); 

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <App network={network} setNetwork={setNetwork} />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
