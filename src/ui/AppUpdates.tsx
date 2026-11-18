import { Download as DownloadIcon, ExternalLink } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  APP_VERSION,
  currentPlatform,
  latestRelease,
  RELEASES_URL,
  type Download,
  type LatestRelease,
  type Platform,
} from '../app/release';
import { installUpdate, updates } from '../app/updates';
import type { Settings } from '../game/settings';
import { backInput } from '../input/pads';
import { Hint, useHints } from './actions';
import { Dialog } from './Dialog';
import { ICON_STROKE } from './icons';

/** The back button's hint (Esc, or the controller's back button), on a card's own way out. */
function BackHint({ settings }: { settings: Settings }) {
  const { mode, style } = useHints(settings);
  return <Hint kbd="Escape" pad={backInput(style)} mode={mode} style={style} />;
}

const PLATFORM_NAME: Record<Platform, string> = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };
const mb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1e6))} MB`;

/** The release notes, as a few plain lines: GitHub's markdown without its marks. */
function plainNotes(notes: string): string[] {
  return notes
    .split('\n')
    .map((l) =>
      l
        .replace(/^#+\s*/, '')
        .replace(/^[-*]\s+/, '• ')
        .replace(/\*\*|__|`/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .trim(),
    )
    .filter(Boolean)
    .slice(0, 8);
}

/** Offers the update the desktop app found: what is new, then install and restart. */
export function UpdateCard({ settings, onClose }: { settings: Settings; onClose(): void }) {
  const status = useSyncExternalStore(updates.subscribe, updates.snapshot);
  const working = status.state === 'downloading' || status.state === 'installing';
  const version = 'version' in status ? status.version : '';
  const notes = status.state === 'available' ? plainNotes(status.notes) : [];
  const share = status.state === 'downloading' && status.total ? status.received / status.total : null;
  return (
    <Dialog title="Update Soundwave" variant="card" className="wide-card" closeLabel={working ? 'Hide' : 'Later'} onClose={onClose}>
      {(close) => (
        <div className="pause-card update-card">
          <h2 className="display">{version ? `Soundwave ${version}` : 'Update'}</h2>
          <p className="hint">
            You have {APP_VERSION}.{' '}
            {status.state === 'available'
              ? 'The update downloads, is checked, installs and the game starts again. Your library, scores and settings stay.'
              : status.state === 'downloading'
                ? `Downloading${share !== null ? ` ${Math.round(share * 100)}%` : '…'}`
                : status.state === 'installing'
                  ? 'Installing. The game starts again in a moment.'
                  : status.state === 'error'
                    ? status.message
                    : 'You have the newest version.'}
          </p>
          {notes.length > 0 && (
            <ul className="update-notes" aria-label="What is new">
              {notes.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          )}
          {working && (
            <span className={`meter ${share === null ? 'busy' : ''}`} aria-hidden>
              <span style={share !== null ? { width: `${Math.round(share * 100)}%` } : undefined} />
            </span>
          )}
          {status.state === 'available' && (
            <button type="button" className="btn primary wide" data-autofocus onClick={() => void installUpdate()}>
              <DownloadIcon strokeWidth={ICON_STROKE} aria-hidden />
              Install and restart
            </button>
          )}
          <button
            type="button"
            className="btn wide"
            data-sfx="back"
            data-autofocus={status.state === 'available' ? undefined : ''}
            onClick={close}
          >
            <BackHint settings={settings} />
            {working ? 'Hide' : 'Later'}
          </button>
        </div>
      )}
    </Dialog>
  );
}

/** On the website: where to get the desktop app, for this computer first. */
export function InstallAppCard({ settings, onClose }: { settings: Settings; onClose(): void }) {
  const [release, setRelease] = useState<LatestRelease | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    latestRelease().then(
      (r) => live && setRelease(r),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, []);
  const platform = currentPlatform();
  const mine = release?.downloads.filter((d) => d.platform === platform) ?? [];
  const best = mine[0];
  const others = release?.downloads.filter((d) => d !== best) ?? [];
  const link = (d: Download, primary: boolean) => (
    <a
      key={d.url}
      className={`btn wide ${primary ? 'primary' : 'quiet'} download-link`}
      href={d.url}
      data-autofocus={primary ? '' : undefined}
    >
      <DownloadIcon strokeWidth={ICON_STROKE} aria-hidden />
      <span className="pick-text">
        <span>{primary ? `Download for ${PLATFORM_NAME[d.platform]}` : `${PLATFORM_NAME[d.platform]}: ${d.kind}`}</span>
        <span className="pick-help">
          {d.kind} · {mb(d.size)}
        </span>
      </span>
    </a>
  );
  return (
    <Dialog title="Get the app" variant="card" className="wide-card" closeLabel="Close" onClose={onClose}>
      {(close) => (
        <div className="pause-card install-card">
          <h2 className="display">Get the app</h2>
          <p className="hint">
            The same game as a program on your computer: it starts from your desktop, plays without a browser around it, opens Soundwave
            song files with a double-click and keeps itself up to date.
          </p>
          {!platform && (
            <p className="hint">The app is made for Windows, macOS and Linux computers. Phones and tablets play here, in the browser.</p>
          )}
          {release === undefined && !failed && (
            <span className="meter busy" aria-hidden>
              <span />
            </span>
          )}
          {(failed || release === null) && (
            <p className="hint">
              {failed ? 'The list of downloads could not be loaded.' : 'The first release is not out yet.'} The releases page has every
              version.
            </p>
          )}
          {best && link(best, true)}
          {release && others.length > 0 && (
            <details className="install-others">
              <summary>Other systems and formats</summary>
              <div className="install-list">{others.map((d) => link(d, false))}</div>
            </details>
          )}
          <a
            className="btn quiet wide"
            href={release?.url ?? RELEASES_URL}
            target="_blank"
            rel="noreferrer"
            data-autofocus={best ? undefined : ''}
          >
            <ExternalLink strokeWidth={ICON_STROKE} aria-hidden />
            All releases on GitHub
          </a>
          {platform === 'macos' && best && (
            <p className="hint small">
              The app is not signed by Apple yet: the first time, open it with a right-click and Open, and confirm that you want to open it.
            </p>
          )}
          {platform === 'windows' && best && (
            <p className="hint small">
              The app is not signed by Microsoft yet: if Windows warns about it, choose More info, then Run anyway.
            </p>
          )}
          <button type="button" className="btn wide" data-sfx="back" onClick={close}>
            <BackHint settings={settings} />
            Close
          </button>
        </div>
      )}
    </Dialog>
  );
}
