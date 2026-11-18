/**
 * Where Soundwave is published, and which version this build is. The desktop app's updater reads
 * the same repository's releases (`plugins.updater.endpoints` in src-tauri/tauri.conf.json).
 */
export const REPOSITORY = 'DavidNiessen/soundwave';
export const REPOSITORY_URL = `https://github.com/${REPOSITORY}`;
export const RELEASES_URL = `${REPOSITORY_URL}/releases/latest`;
const LATEST_RELEASE_API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;

/** The version this build was made from (package.json; a release sets it before building). */
export const APP_VERSION: string = __APP_VERSION__;

export type Platform = 'windows' | 'macos' | 'linux';

export interface Download {
  platform: Platform;
  /** What the file is, for people: "Installer", "Disk image", "AppImage" ... */
  kind: string;
  name: string;
  url: string;
  size: number;
}

export interface LatestRelease {
  version: string;
  url: string;
  downloads: Download[];
}

/** Which file of a release is which download, best first for each system. */
const KINDS: [RegExp, Platform, string][] = [
  [/_x64-setup\.exe$/i, 'windows', 'Installer'],
  [/_x64_[a-z-]+\.msi$/i, 'windows', 'MSI installer'],
  [/\.dmg$/i, 'macos', 'Disk image'],
  [/\.AppImage$/, 'linux', 'AppImage'],
  [/\.deb$/i, 'linux', 'Debian and Ubuntu package'],
  [/\.rpm$/i, 'linux', 'Fedora package'],
];

/** The files of a release that people download, best first for each system (updater files and signatures left out). */
export function pickDownloads(assets: { name: string; browser_download_url: string; size: number }[]): Download[] {
  const downloads: Download[] = [];
  for (const [pattern, platform, kind] of KINDS) {
    const asset = assets.find((a) => pattern.test(a.name));
    if (asset) downloads.push({ platform, kind, name: asset.name, url: asset.browser_download_url, size: asset.size });
  }
  return downloads;
}

/** The system this page runs on, when it is one the app is made for. */
export function currentPlatform(): Platform | null {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string; mobile?: boolean } };
  if (nav.userAgentData?.mobile || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return null;
  const name = `${nav.userAgentData?.platform ?? ''} ${navigator.platform} ${navigator.userAgent}`;
  if (/Win/i.test(name)) return 'windows';
  if (/Mac/i.test(name)) return 'macos';
  if (/Linux|X11|CrOS/i.test(name)) return 'linux';
  return null;
}

let latest: Promise<LatestRelease | null> | null = null;

/**
 * The newest full release and its downloads, from GitHub (pre-releases are left out). Null when
 * there is none yet. Asked once per visit.
 */
export function latestRelease(): Promise<LatestRelease | null> {
  latest ??= (async () => {
    const res = await fetch(LATEST_RELEASE_API, { headers: { Accept: 'application/vnd.github+json' } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const body = (await res.json()) as {
      tag_name: string;
      html_url: string;
      assets: { name: string; browser_download_url: string; size: number }[];
    };
    return { version: body.tag_name.replace(/^v/, ''), url: body.html_url, downloads: pickDownloads(body.assets) };
  })();
  // A failed attempt is not remembered: the next one asks again.
  latest.catch(() => (latest = null));
  return latest;
}
