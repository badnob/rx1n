// src/components/MatrixRain.tsx
import React, { useEffect, useRef } from 'react';

export default function MatrixRain() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const chars =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%^&*()ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ'.split('');
    const fontSize = 16;

    // drops[i] = current Y position (in character rows) for column i
    let drops: number[] = [];

    const initCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    const initDrops = (columnCount: number) => {
      // Start all drops at random negative offsets so they cascade in naturally
      drops = Array.from({ length: columnCount }, () => Math.random() * -100);
    };

    initCanvas();
    initDrops(Math.floor(canvas.width / fontSize));

    const draw = () => {
      // Slight transparent black overlay creates the fading trail effect
      ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = '#00ff41';
      ctx.font = `${fontSize}px monospace`;

      for (let i = 0; i < drops.length; i++) {
        if (drops[i] >= 0) {
          const text = chars[Math.floor(Math.random() * chars.length)];
          ctx.fillText(text, i * fontSize, drops[i] * fontSize);
        }

        if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
          drops[i] = 0;
        }

        drops[i]++;
      }
    };

    const intervalId = setInterval(draw, 33); // ~30 fps

    const handleResize = () => {
      const newColumnCount = Math.floor(window.innerWidth / fontSize);
      const prevDrops = [...drops];

      initCanvas();

      // Preserve existing drop positions; only extend or trim column count.
      // This avoids the visible flash caused by reinitialising all drops to
      // random negative values on every resize event.
      if (newColumnCount > prevDrops.length) {
        // Add new columns starting off-screen
        const extra = Array.from(
          { length: newColumnCount - prevDrops.length },
          () => Math.random() * -100
        );
        drops = [...prevDrops, ...extra];
      } else {
        drops = prevDrops.slice(0, newColumnCount);
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 1,
        opacity: 0.8,
      }}
    />
  );
}
