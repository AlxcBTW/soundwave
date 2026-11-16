import { useEffect, useRef } from 'react';
import { getEngine } from '../audio/engine';
import { Background2D } from '../render/Background2D';

/** The reactive backdrop behind menus; reacts to whatever the engine is playing (e.g. previews). */
export function MenuBackground() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const bg = new Background2D(ref.current!);
    bg.setAnalyser(getEngine().analyser);
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      bg.render();
    };
    loop();
    const onResize = () => bg.resize();
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, []);
  return <canvas ref={ref} className="layer" />;
}
