import React from 'react';
import { TokenMeta } from '../hooks/useTokenMetadata';

interface TokenCardProps {
  meta: TokenMeta | null;
}

export default function TokenCard({ meta }: TokenCardProps) {
  if (!meta) {
    return (
      <div className="flex items-center gap-4 p-3 border border-[#003300] bg-black opacity-50">
        <div className="w-10 h-10 bg-[#001100] border border-[#003300] flex items-center justify-center">
          <span className="text-[#004400] text-xs">?</span>
        </div>
        <div>
          <div className="text-sm font-bold text-[#004400] tracking-widest">WAITING...</div>
          <div className="text-xs text-[#003300]">ENTER_ADDRESS</div>
        </div>
      </div>
    );
  }

  if (meta.symbol === 'ERR') {
    return (
      <div className="flex items-center gap-4 p-3 border border-red-900 bg-black">
        <div className="w-10 h-10 bg-red-950 border border-red-500 flex items-center justify-center">
          <span className="text-red-500 font-bold">X</span>
        </div>
        <div>
          <div className="text-sm font-bold text-red-500 tracking-widest">INVALID_TARGET</div>
          <div className="text-xs text-red-800">CHECK_ADDRESS_FORMAT</div>
        </div>
      </div>
    );
  }

  const isUnknown = meta.symbol === 'UNK' || meta.symbol.includes('..');

  return (
    <div className={`flex items-center gap-4 p-3 border ${isUnknown ? 'border-[#005500]' : 'border-[#00ff41]'} bg-black transition-colors`}>
      <div className={`w-10 h-10 flex items-center justify-center overflow-hidden border ${isUnknown ? 'bg-[#001100] border-[#003300]' : 'bg-[#001100] border-[#00ff41]'}`}>
        {meta.logo ? (
          <img src={meta.logo} alt={meta.symbol} className="w-full h-full object-cover" />
        ) : (
          <span className={isUnknown ? "text-[#00aa22] text-xs font-mono" : "text-[#00ff41] font-bold"}>
            {meta.symbol?.slice(0, 3) || '?'}
          </span>
        )}
      </div>

      <div className="flex flex-col overflow-hidden">
        <div className={`text-sm font-bold tracking-widest truncate ${isUnknown ? 'text-[#00aa22]' : 'text-[#00ff41]'}`}>
          {meta.symbol || 'UNKNOWN'}
        </div>
        <div className={`text-xs truncate ${isUnknown ? 'text-[#005500]' : 'text-[#00aa22]'}`}>
          {meta.name || 'Unregistered Asset'}
          {meta.supply !== undefined && ` • SUPPLY: ${meta.supply.toLocaleString()}`}
        </div>
      </div>
    </div>
  );
}
