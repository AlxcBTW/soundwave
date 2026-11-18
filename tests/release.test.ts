import { describe, expect, it } from 'vitest';
import { pickDownloads } from '../src/app/release';

const asset = (name: string, size = 10e6) => ({ name, size, browser_download_url: `https://example.test/${name}` });

describe('the downloads of a release', () => {
  it('picks the installer for each system, best first, and leaves updater files and signatures out', () => {
    const picked = pickDownloads([
      asset('latest.json', 1e3),
      asset('Soundwave_0.2.0_x64-setup.exe'),
      asset('Soundwave_0.2.0_x64-setup.exe.sig', 1e3),
      asset('Soundwave_0.2.0_x64_en-US.msi'),
      asset('Soundwave_0.2.0_x64_en-US.msi.sig', 1e3),
      asset('Soundwave_0.2.0_universal.dmg'),
      asset('Soundwave_universal.app.tar.gz'),
      asset('Soundwave_universal.app.tar.gz.sig', 1e3),
      asset('Soundwave_0.2.0_amd64.AppImage'),
      asset('Soundwave_0.2.0_amd64.AppImage.sig', 1e3),
      asset('Soundwave_0.2.0_amd64.deb'),
      asset('Soundwave-0.2.0-1.x86_64.rpm'),
    ]);
    expect(picked.map((d) => [d.platform, d.name])).toEqual([
      ['windows', 'Soundwave_0.2.0_x64-setup.exe'],
      ['windows', 'Soundwave_0.2.0_x64_en-US.msi'],
      ['macos', 'Soundwave_0.2.0_universal.dmg'],
      ['linux', 'Soundwave_0.2.0_amd64.AppImage'],
      ['linux', 'Soundwave_0.2.0_amd64.deb'],
      ['linux', 'Soundwave-0.2.0-1.x86_64.rpm'],
    ]);
  });

  it('offers nothing for a release without installers', () => {
    expect(pickDownloads([asset('latest.json'), asset('notes.txt')])).toEqual([]);
  });
});
