import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Command } from 'commander';
import { clampInt, siteReceipt } from './http-utils.js';
import type { SiteAdapter, SiteCommandContext, SiteReceipt } from './types.js';

const SITE = 'media';

interface MediaOptions {
  url: string;
  out?: string;
  filename?: string;
  maxBytes?: string;
  iHaveRights?: boolean;
}

interface HlsSegment {
  url: string;
  duration?: number;
}

interface HlsManifest {
  url: string;
  isHls: boolean;
  isEncrypted: boolean;
  hasKey: boolean;
  version?: string;
  targetDuration?: number;
  mediaSequence?: number;
  segments: HlsSegment[];
  playlists: Array<{ url: string; bandwidth?: number; resolution?: string }>;
  keyUris: string[];
}

function maxBytes(value: string | undefined): number {
  return clampInt(value, 200 * 1024 * 1024, 1, 2048) * 1024 * 1024;
}

function sanitizeFilename(value: string): string {
  return value.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'media';
}

function filenameFromUrl(url: string, fallback: string): string {
  try {
    const parsed = new URL(url);
    const base = path.basename(parsed.pathname);
    return sanitizeFilename(base || fallback);
  } catch {
    return sanitizeFilename(fallback);
  }
}

function resolveUrl(base: string, value: string): string {
  return new URL(value, base).toString();
}

function redactedUrl(value: string): string {
  try {
    const parsed = new URL(value);
    for (const key of parsed.searchParams.keys()) {
      if (/token|sign|auth|key|secret|session|sid/i.test(key)) {
        parsed.searchParams.set(key, '[redacted]');
      }
    }
    return parsed.toString();
  } catch {
    return value;
  }
}

async function fetchTextStrict(url: string): Promise<{ responseUrl: string; status: number; contentType: string; text: string }> {
  const response = await fetch(url, { headers: { accept: 'application/vnd.apple.mpegurl, application/x-mpegURL, text/plain, */*' } });
  const text = await response.text();
  return {
    responseUrl: response.url,
    status: response.status,
    contentType: response.headers.get('content-type') || '',
    text,
  };
}

function parseHlsManifest(url: string, text: string): HlsManifest {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const manifest: HlsManifest = {
    url,
    isHls: lines[0] === '#EXTM3U',
    isEncrypted: false,
    hasKey: false,
    segments: [],
    playlists: [],
    keyUris: [],
  };
  let pendingDuration: number | undefined;
  let pendingStream: { bandwidth?: number; resolution?: string } | undefined;

  for (const line of lines) {
    if (line.startsWith('#EXT-X-VERSION:')) {
      manifest.version = line.slice('#EXT-X-VERSION:'.length);
      continue;
    }
    if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      manifest.targetDuration = Number(line.slice('#EXT-X-TARGETDURATION:'.length));
      continue;
    }
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      manifest.mediaSequence = Number(line.slice('#EXT-X-MEDIA-SEQUENCE:'.length));
      continue;
    }
    if (line.startsWith('#EXTINF:')) {
      pendingDuration = Number(line.slice('#EXTINF:'.length).split(',')[0]);
      continue;
    }
    if (line.startsWith('#EXT-X-KEY:')) {
      manifest.hasKey = true;
      manifest.isEncrypted = !/METHOD=NONE/i.test(line);
      const uri = line.match(/URI="([^"]+)"/i)?.[1];
      if (uri) manifest.keyUris.push(resolveUrl(url, uri));
      continue;
    }
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const bandwidth = line.match(/BANDWIDTH=(\d+)/i)?.[1];
      const resolution = line.match(/RESOLUTION=([^,]+)/i)?.[1];
      pendingStream = {
        ...(bandwidth ? { bandwidth: Number(bandwidth) } : {}),
        ...(resolution ? { resolution } : {}),
      };
      continue;
    }
    if (line.startsWith('#')) continue;

    const absolute = resolveUrl(url, line);
    if (pendingStream) {
      manifest.playlists.push({ url: absolute, ...pendingStream });
      pendingStream = undefined;
    } else {
      manifest.segments.push({ url: absolute, ...(Number.isFinite(pendingDuration) ? { duration: pendingDuration } : {}) });
      pendingDuration = undefined;
    }
  }

  return manifest;
}

function summarizeManifest(manifest: HlsManifest): Record<string, unknown> {
  return {
    url: redactedUrl(manifest.url),
    isHls: manifest.isHls,
    isEncrypted: manifest.isEncrypted,
    hasKey: manifest.hasKey,
    version: manifest.version,
    targetDuration: manifest.targetDuration,
    mediaSequence: manifest.mediaSequence,
    segmentCount: manifest.segments.length,
    playlistCount: manifest.playlists.length,
    totalDuration: Number(manifest.segments.reduce((sum, segment) => sum + (segment.duration || 0), 0).toFixed(3)),
    sampleSegments: manifest.segments.slice(0, 3).map(segment => ({ ...segment, url: redactedUrl(segment.url) })),
    playlists: manifest.playlists.map(item => ({ ...item, url: redactedUrl(item.url) })),
    keyUriCount: manifest.keyUris.length,
    keyUriHosts: [...new Set(manifest.keyUris.map(uri => new URL(uri).host))],
  };
}

async function writeJson(outDir: string, filename: string, data: unknown): Promise<string> {
  await fs.mkdir(outDir, { recursive: true });
  const filePath = path.join(outDir, filename);
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return filePath;
}

async function runInspect(_ctx: SiteCommandContext, options: MediaOptions): Promise<SiteReceipt> {
  const fetched = await fetchTextStrict(options.url);
  const looksHls = fetched.text.trimStart().startsWith('#EXTM3U') || /\.m3u8(?:$|\?)/i.test(fetched.responseUrl);
  const observations: Record<string, unknown> = {
    target: redactedUrl(options.url),
    responseUrl: redactedUrl(fetched.responseUrl),
    httpStatus: fetched.status,
    contentType: fetched.contentType,
    sideEffects: [],
  };

  if (looksHls) {
    const manifest = parseHlsManifest(fetched.responseUrl, fetched.text);
    observations.hls = summarizeManifest(manifest);
  } else {
    observations.previewBytes = Buffer.byteLength(fetched.text);
    observations.preview = fetched.text.slice(0, 500);
  }

  if (options.out) {
    observations.receiptPath = await writeJson(path.resolve(options.out), 'media-inspect.json', observations);
  }

  return siteReceipt(SITE, 'inspect', observations, true);
}

async function downloadDirect(url: string, outDir: string, filename: string, limit: number): Promise<Record<string, unknown>> {
  const response = await fetch(url, { headers: { accept: '*/*' } });
  if (!response.ok) throw new Error(`${redactedUrl(url)} returned HTTP ${response.status}`);
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > limit) throw new Error(`Remote file is ${contentLength} bytes; max is ${limit}.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > limit) throw new Error(`Downloaded file is ${bytes.byteLength} bytes; max is ${limit}.`);
  await fs.mkdir(outDir, { recursive: true });
  const filePath = path.join(outDir, filename);
  await fs.writeFile(filePath, bytes);
  return {
    filePath,
    bytes: bytes.byteLength,
    contentType: response.headers.get('content-type') || '',
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

async function downloadHlsSegments(manifest: HlsManifest, outDir: string, filename: string, limit: number): Promise<Record<string, unknown>> {
  if (manifest.isEncrypted) {
    throw new Error('Encrypted HLS was detected (#EXT-X-KEY). Refusing to fetch keys or segments.');
  }
  if (!manifest.segments.length) {
    throw new Error('No media segments found in this HLS manifest.');
  }
  await fs.mkdir(outDir, { recursive: true });
  const filePath = path.join(outDir, filename.endsWith('.ts') ? filename : `${filename}.ts`);
  const handle = await fs.open(filePath, 'w');
  const hash = crypto.createHash('sha256');
  let total = 0;
  try {
    for (const segment of manifest.segments) {
      const response = await fetch(segment.url, { headers: { accept: '*/*' } });
      if (!response.ok) throw new Error(`${redactedUrl(segment.url)} returned HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      total += bytes.byteLength;
      if (total > limit) throw new Error(`Downloaded HLS is ${total} bytes; max is ${limit}.`);
      hash.update(bytes);
      await handle.write(bytes);
    }
  } finally {
    await handle.close();
  }
  return {
    filePath,
    bytes: total,
    sha256: hash.digest('hex'),
    segmentCount: manifest.segments.length,
    container: 'mpeg-ts',
  };
}

async function runDownload(_ctx: SiteCommandContext, options: MediaOptions): Promise<SiteReceipt> {
  if (!options.iHaveRights) {
    return siteReceipt(SITE, 'download', {
      target: redactedUrl(options.url),
      sideEffects: [],
    }, false, [{
      code: 'RIGHTS_CONFIRMATION_REQUIRED',
      message: 'Pass --i-have-rights to confirm you are authorized to download and store this media.',
    }]);
  }

  const limit = maxBytes(options.maxBytes);
  const outDir = path.resolve(options.out || 'downloads/media');
  const fetched = await fetchTextStrict(options.url);
  const looksHls = fetched.text.trimStart().startsWith('#EXTM3U') || /\.m3u8(?:$|\?)/i.test(fetched.responseUrl);
  const baseName = options.filename ? sanitizeFilename(options.filename) : filenameFromUrl(fetched.responseUrl, 'media');

  if (looksHls) {
    const manifest = parseHlsManifest(fetched.responseUrl, fetched.text);
    if (manifest.playlists.length && !manifest.segments.length) {
      return siteReceipt(SITE, 'download', {
        target: redactedUrl(options.url),
        hls: summarizeManifest(manifest),
        sideEffects: [],
      }, false, [{
        code: 'MASTER_PLAYLIST_ONLY',
        message: 'This is a master playlist. Inspect it and download a selected media playlist URL.',
      }]);
    }
    try {
      const downloaded = await downloadHlsSegments(manifest, outDir, baseName, limit);
      return siteReceipt(SITE, 'download', {
        target: redactedUrl(options.url),
        hls: summarizeManifest(manifest),
        downloaded,
        sideEffects: ['file_download'],
      });
    } catch (error) {
      return siteReceipt(SITE, 'download', {
        target: redactedUrl(options.url),
        hls: summarizeManifest(manifest),
        sideEffects: [],
      }, false, [{
        code: 'HLS_DOWNLOAD_REFUSED_OR_FAILED',
        message: error instanceof Error ? error.message : String(error),
      }]);
    }
  }

  const downloaded = await downloadDirect(fetched.responseUrl, outDir, options.filename ? sanitizeFilename(options.filename) : filenameFromUrl(fetched.responseUrl, 'media.bin'), limit);
  return siteReceipt(SITE, 'download', {
    target: redactedUrl(options.url),
    downloaded,
    sideEffects: ['file_download'],
  });
}

export const mediaAdapter: SiteAdapter = {
  id: SITE,
  title: 'Media',
  description: 'Inspect and download authorized direct media or unencrypted HLS streams.',
  commands: [
    {
      name: 'inspect',
      description: 'Inspect a media URL or HLS manifest without downloading segments',
      configure(command: Command): void {
        command
          .argument('<url>', 'media URL or .m3u8 manifest URL')
          .option('--out <dir>', 'write a JSON receipt to this directory')
          .action(async function (url: string) {
            const { runSiteCommand } = await import('./runner.js');
            await runSiteCommand(this, ctx => runInspect(ctx, { ...this.opts<Omit<MediaOptions, 'url'>>(), url }));
          });
      },
    },
    {
      name: 'download',
      description: 'Download an authorized direct file or unencrypted HLS media playlist',
      configure(command: Command): void {
        command
          .argument('<url>', 'media URL or unencrypted media .m3u8 URL')
          .option('--out <dir>', 'output directory', 'downloads/media')
          .option('--filename <name>', 'output filename')
          .option('--max-bytes <mb>', 'download size limit in MiB', '200')
          .option('--i-have-rights', 'confirm you are authorized to download and store this media')
          .action(async function (url: string) {
            const { runSiteCommand } = await import('./runner.js');
            await runSiteCommand(this, ctx => runDownload(ctx, { ...this.opts<Omit<MediaOptions, 'url'>>(), url }));
          });
      },
    },
  ],
};
