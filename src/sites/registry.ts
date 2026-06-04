import type { Command } from 'commander';
import { alibaba1688Adapter } from './1688.js';
import { arxivAdapter } from './arxiv.js';
import { bilibiliAdapter } from './bilibili.js';
import { cninfoAdapter } from './cninfo.js';
import { douyinAdapter } from './douyin.js';
import { eastmoneyAdapter } from './eastmoney.js';
import { githubAdapter } from './github.js';
import { hackernewsAdapter } from './hackernews.js';
import { jimengAdapter } from './jimeng.js';
import { mediaAdapter } from './media.js';
import { producthuntAdapter } from './producthunt.js';
import { redditAdapter } from './reddit.js';
import { rouman5Adapter } from './rouman5.js';
import { secAdapter } from './sec.js';
import { sunoAdapter } from './suno.js';
import { telegramAdapter } from './telegram.js';
import { twitterAdapter, xAdapter } from './twitter.js';
import type { SiteAdapter } from './capabilities.js';
import { runSiteCommand } from './capabilities.js';
import { xhsAdapter } from './xhs.js';
import { xueqiuAdapter } from './xueqiu.js';
import { youtubeAdapter } from './youtube.js';

export const siteAdapters: SiteAdapter[] = [
  alibaba1688Adapter,
  hackernewsAdapter,
  arxivAdapter,
  cninfoAdapter,
  secAdapter,
  eastmoneyAdapter,
  githubAdapter,
  redditAdapter,
  bilibiliAdapter,
  mediaAdapter,
  youtubeAdapter,
  producthuntAdapter,
  telegramAdapter,
  douyinAdapter,
  sunoAdapter,
  jimengAdapter,
  rouman5Adapter,
  xhsAdapter,
  xueqiuAdapter,
  xAdapter,
  twitterAdapter,
];

export function registerSiteCommands(program: Command): void {
  const sites = program.command('sites').description('List and inspect installed site automation adapters');
  sites
    .command('list')
    .description('List available site adapters')
    .action(async function () {
      await runSiteCommand(this, async () => ({
        adapters: siteAdapters.map(adapter => ({
          id: adapter.id,
          title: adapter.title,
          description: adapter.description,
          commands: adapter.commands.map(command => command.name),
        })),
      }));
    });

  for (const adapter of siteAdapters) {
    const root = program.command(adapter.id).description(adapter.description);
    for (const commandSpec of adapter.commands) {
      const command = root.command(commandSpec.name).description(commandSpec.description);
      commandSpec.configure(command);
    }
  }
}
