/// <reference lib="webworker" />
import type { FromStage, ToStage } from './protocol';
import { createStageHost } from './stageHost';

/** The 3D stage's own thread: it draws on canvases the page hands over (see StageView). */
const host = createStageHost((m: FromStage) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m));
self.onmessage = (e: MessageEvent<ToStage>) => host.handle(e.data);
