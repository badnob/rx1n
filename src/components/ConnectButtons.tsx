// src/components/ConnectButtons.tsx
// Note: 'use client' removed — this is a Vite app, not Next.js App Router

import { useEffect, useMemo, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import type { WalletName } from '@solana/wallet-adapter-base';
import styles from '../page.module.css';

export default function ConnectButtons({ className }: { className?: string }) {
  const { wallets, select, connect, disconnect, connected, wallet } = useWallet();
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => setMounted(true), []);

  const backpackWallet = useMemo(
    () => wallets.find((w) => w.adapter.name === 'Backpack'),
    [wallets]
  );

  const x1Wallet = useMemo(
    () =>
      wallets.find(
        (w) =>
          w.adapter.name === 'X1 Wallet' ||
          (w.adapter.name === 'Solana' &&
            typeof window !== 'undefined' &&
            (window as any).solana?.isX1) ||
          (w.adapter.name === 'Backpack' &&
            typeof window !== 'undefined' &&
            (window as any).backpack?.isX1)
      ),
    [wallets]
  );

  const hasBoth =
    !!backpackWallet &&
    !!x1Wallet &&
    backpackWallet.adapter.name !== x1Wallet.adapter.name;

  if (!mounted) return null;

  const connectWallet = async (targetWallet: any) => {
    setBusy(true);
    setShowModal(false);
    try {
      if (wallet?.adapter?.name !== targetWallet.adapter.name) {
        await select(targetWallet.adapter.name as WalletName);
      }
      await connect();
    } catch (e: any) {
      if (e?.name !== 'WalletNotSelectedError') console.error(e);
    } finally {
      setBusy(false);
    }
  };

  const onConnectClick = async () => {
    if (hasBoth) {
      setShowModal(true);
      return;
    }
    const targetWallet = backpackWallet ?? x1Wallet;
    if (!targetWallet) {
      alert('ERR: NO_COMPATIBLE_WALLET_DETECTED');
      return;
    }
    await connectWallet(targetWallet);
  };

  const onDisconnectClick = async () => {
    setBusy(true);
    try {
      await disconnect();
    } catch (e: any) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* Wallet selection modal */}
      {showModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 font-mono">
          <div className="bg-[#000a00] border border-[#00ff41] p-6 max-w-sm w-full shadow-[0_0_20px_rgba(0,255,65,0.2)]">
            <h3 className="text-xl font-black mb-2 text-[#00ff41] uppercase tracking-widest">
              &gt; SELECT_PROVIDER
            </h3>
            <p className="text-[#00aa22] text-sm mb-6 uppercase tracking-widest border-b border-[#003300] pb-2">
              Detecting multiple nodes...
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => connectWallet(backpackWallet)}
                className={`w-full py-3 px-4 font-bold text-sm ${styles.neonButton}`}
              >
                CONNECT_BACKPACK()
              </button>
              <button
                onClick={() => connectWallet(x1Wallet)}
                className={`w-full py-3 px-4 font-bold text-sm ${styles.neonButton}`}
              >
                CONNECT_X1()
              </button>
            </div>
            <button
              onClick={() => setShowModal(false)}
              className="mt-6 w-full py-2 text-xs text-[#00aa22] hover:text-[#00ff41] hover:bg-[#001100] border border-transparent hover:border-[#004400] transition-colors"
            >
              [ ABORT_CONNECTION ]
            </button>
          </div>
        </div>
      )}

      {/* Main connect / disconnect */}
      <div className={`flex flex-col gap-3 w-full font-mono ${className || ''}`}>
        {!connected ? (
          <button
            onClick={onConnectClick}
            disabled={busy}
            className={`w-full py-3 px-4 font-black text-sm tracking-widest ${styles.neonButton}`}
          >
            {busy ? '> INITIALIZING...' : 'ESTABLISH_CONNECTION()'}
          </button>
        ) : (
          <button
            onClick={onDisconnectClick}
            disabled={busy}
            className="w-full py-3 px-4 font-bold text-xs uppercase tracking-widest bg-transparent border border-red-900 text-red-500 hover:bg-red-900 hover:text-white hover:shadow-[0_0_15px_rgba(255,0,0,0.4)] transition-all"
          >
            {busy ? '> TERMINATING...' : '[ TERMINATE_CONNECTION ]'}
          </button>
        )}
      </div>
    </>
  );
}
