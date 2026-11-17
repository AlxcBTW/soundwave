import { useEffect, useRef } from 'react';
import { getEngine } from '../audio/engine';
import { resolveGraphics, type GraphicsSettings } from '../game/graphics';
import { Background2D } from '../render/Background2D';
import { AuroraStage } from '../render/aurora/AuroraStage';

/**
 * The backdrop behind menus: the 3D stage idling with slow camera moves (or the 2D backdrop when
 * it is off or still loading), reacting to whatever the engine plays (e.g. previews).
 */
export function MenuBackground({ graphics }: { graphics: GraphicsSettings }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bg = new Background2D(ref.current!);
    bg.setAnalyser(getEngine().analyser);
    let stage: AuroraStage | null = null;
    let live = true;
    const g = resolveGraphics(graphics);
    if (g.stage3d) {
      // Menus never need the full show: cap the frame rate so the UI stays light.
      AuroraStage.create(stageRef.current!, { ...g, fpsCap: g.fpsCap && g.fpsCap < 60 ? g.fpsCap : 60, effects: 'off' }, { mode: 'menu' })
        .then((s) => {
          if (!live) return s.dispose();
          s.setAnalyser(getEngine().analyser);
          stage = s;
          if (import.meta.env.DEV) (window as unknown as { __stage?: AuroraStage }).__stage = s;
        })
        .catch((err) => console.warn('3D stage unavailable, using the 2D backdrop', err));
    }
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (stage) {
        const b = stage.bands;
        stage.render({ beat: 'none', intensity: Math.min(1, (b.low + b.mid) * 0.7), overdrive: false, barSeconds: 2 });
      } else bg.render();
    };
    loop();
    const onResize = () => {
      bg.resize();
      stage?.resize();
    };
    window.addEventListener('resize', onResize);
    return () => {
      live = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      stage?.dispose();
    };
  }, [graphics]);
  return (
    <>
      <canvas ref={ref} className="layer" />
      <div ref={stageRef} className="layer stage-host" />
    </>
  );
}
