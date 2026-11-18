import { useEffect, useRef } from 'react';
import { getEngine } from '../audio/engine';
import { resolveGraphics, type GraphicsSettings } from '../game/graphics';
import type { AuroraStage } from '../render/aurora/AuroraStage';
import { acquireMenuStage, releaseMenuStage } from '../render/aurora/menuStage';

/**
 * The backdrop behind menus: the 3D stage idling with slow camera moves, reacting to whatever the
 * engine plays (e.g. previews). Until it is built, and where it cannot be, the menus stand before
 * the plain night. The stage is shared between mounts (see menuStage), so remounting this never
 * shows a black frame.
 *
 * `onReady` is told once the stage has drawn (or cannot be built): the loading screen waits for it.
 */
export function MenuBackground({ graphics, onReady }: { graphics: GraphicsSettings; onReady?(): void }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  useEffect(() => {
    let stage: AuroraStage | null = null;
    let live = true;
    let drawn = false;
    let late = 0;
    const ready = () => live && readyRef.current?.();
    const g = resolveGraphics(graphics);
    // Menus never need the full show: cap the frame rate so the UI stays light.
    acquireMenuStage(stageRef.current!, { ...g, fpsCap: g.fpsCap && g.fpsCap < 60 ? g.fpsCap : 60, effects: 'off' })
      .then((s) => {
        if (!live) return;
        s.setAnalyser(getEngine().analyser);
        stage = s;
        if (import.meta.env.DEV) (window as unknown as { __stage?: AuroraStage }).__stage = s;
        // A window that is not showing draws no frames: it does not hold the game back for ever.
        late = window.setTimeout(ready, 1500);
      })
      .catch((err) => {
        console.warn('3D stage unavailable', err);
        ready();
      });
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!stage) return;
      const b = stage.bands;
      stage.render({ beat: 'none', intensity: Math.min(1, (b.low + b.mid) * 0.7), overdrive: false, barSeconds: 2 });
      if (!drawn) {
        // The first frame compiles the stage's shaders; it is on screen one frame later.
        drawn = true;
        requestAnimationFrame(ready);
      }
    };
    loop();
    const onResize = () => stage?.resize();
    window.addEventListener('resize', onResize);
    return () => {
      live = false;
      cancelAnimationFrame(raf);
      clearTimeout(late);
      window.removeEventListener('resize', onResize);
      stage = null;
      releaseMenuStage();
    };
  }, [graphics]);
  return <div ref={stageRef} className="layer stage-host" />;
}
