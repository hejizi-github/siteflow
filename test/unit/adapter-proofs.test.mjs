import test from 'node:test';
import assert from 'node:assert/strict';

import { douyinTesting } from '../../dist/sites/douyin.js';
import { twitterTesting } from '../../dist/sites/twitter.js';
import { xhsTesting } from '../../dist/sites/xhs.js';
import { youtubeTesting } from '../../dist/sites/youtube.js';
import { createPageObservation } from '../../dist/runtime/page-observation.js';
import { BrowserRuntime } from '../../dist/runtime/browser-runtime.js';

function fakePage(url, title) {
  return {
    isClosed: () => false,
    title: async () => title,
    url: () => url,
    on: () => {},
  };
}

test('BrowserRuntime.attach resets stale page state before adopting attached pages', async () => {
  const runtime = new BrowserRuntime('default');
  runtime.kernel.adoptPage(fakePage('https://old.example', 'old'), createPageObservation());
  runtime.kernel.selectedPageId = 1;

  const attachedPage = fakePage('https://attached.example', 'attached');
  const fakeContext = {
    pages: () => [attachedPage],
    on: () => {},
  };
  const fakeBrowser = { close: async () => {} };

  const result = await runtime.attach('http://127.0.0.1:9222', async () => ({ browser: fakeBrowser, context: fakeContext }));

  assert.equal(result.pages.length, 1);
  assert.equal(result.pages[0].url, 'https://attached.example');
  assert.equal(runtime.kernel.pages.size, 1);
  assert.equal(runtime.kernel.selectedPageId, result.pages[0].id);
});

test('twitter proof exercises migrated read-heavy flow through injected capabilities deps', async () => {
  const deps = {
    ...twitterTesting.deps,
    ensureSitePage: async () => ({ id: 1, url: 'https://x.com/explore', title: 'Explore', selected: true }),
    sleep: async () => {},
    captureSiteScreenshot: async () => '/tmp/twitter-proof.png',
    readSiteSnapshot: async () => ({ url: 'https://x.com/explore', title: 'Explore', text: 'tweet one\ntweet two' }),
    readRecentSiteErrors: async () => [],
    evaluateInSitePage: async (_profile, expression) => {
      if (expression.includes("document.querySelectorAll('article')")) {
        return [{ index: 0, text: 'tweet one', hrefs: ['https://x.com/a/status/1'] }];
      }
      if (expression.includes("document.querySelectorAll('a')")) {
        return [{ text: 'Home', href: 'https://x.com/home' }];
      }
      return true;
    },
    openSitePage: async () => ({ id: 2, url: 'https://x.com/explore', title: 'Explore', selected: true }),
  };

  const receipt = await twitterTesting.runCollect({ profile: 'default' }, { limit: '5', scrollPages: '0', wait: '0', screenshot: '/tmp/twitter-proof.png' }, deps);

  assert.equal(receipt.site, 'twitter');
  assert.equal(receipt.command, 'collect');
  assert.equal(receipt.ok, true);
  assert.equal(receipt.state, 'collected_visible_data');
  assert.equal(receipt.observations.summary.title, 'Twitter/X visible page collection');
});

test('xhs proof exercises migrated draft flow and stops before publish', async () => {
  const deps = {
    ...xhsTesting.deps,
    ensureSitePage: async () => ({ id: 1, url: 'https://creator.xiaohongshu.com/publish/publish?source=official', title: 'XHS', selected: true }),
    sleep: async () => {},
    readSiteSnapshot: async () => ({ url: 'https://creator.xiaohongshu.com/publish/publish?source=official', title: 'XHS', text: 'draft editor ready' }),
    captureSiteScreenshot: async () => '/tmp/xhs-proof.png',
    uploadSiteFiles: async () => ({ action: 'upload' }),
    typeIntoSiteTarget: async () => ({ action: 'type' }),
    clickSiteTarget: async () => ({ action: 'click' }),
    readRecentSiteErrors: async () => [],
  };

  const receipt = await xhsTesting.runDraft({ profile: 'default' }, {
    title: 'Proof title',
    body: 'Proof body',
    topic: ['测试'],
    image: ['/tmp/example.png'],
    screenshot: '/tmp/xhs-proof.png',
  }, deps);

  assert.equal(receipt.site, 'xhs');
  assert.equal(receipt.command, 'draft');
  assert.equal(receipt.ok, true);
  assert.equal(receipt.state, 'draft_filled_publish_not_clicked');
  assert.deepEqual(receipt.next, ['Review layout, topics, AI content declaration, and visibility before publishing manually.']);
});

test('douyin auth detection treats creator login page as auth required', () => {
  const text = [
    '抖音创作者中心',
    '解锁创作者专属功能',
    '短信登录',
    '发送验证码',
    '登 录',
  ].join('\n');

  assert.equal(
    douyinTesting.isAuthRequired(text, 'https://creator.douyin.com/creator-micro/content/upload'),
    true,
  );
});

test('youtube search proof returns step trace through injected deps', async () => {
  const deps = {
    ...youtubeTesting.deps,
    openOrNavigateSitePage: async () => ({ pageId: 3, url: 'https://www.youtube.com/results?search_query=proof', title: 'YouTube Search' }),
    sleep: async () => {},
    youtubeSearchResults: async () => ({
      videos: [
        { id: 'abc123XYZ_1', title: 'Proof video', href: 'https://www.youtube.com/watch?v=abc123XYZ_1', channel: 'Proof', metadata: '1 view', text: 'Proof video visible row text' },
      ],
      evidence: {
        count: 1,
        limit: 3,
        requestedLimit: 1,
        root: 'ytd-video-renderer, ytd-rich-item-renderer, a#video-title',
      },
    }),
  };

  const receipt = await youtubeTesting.runSearch({ profile: 'default' }, { keyword: 'proof', limit: '1' }, deps);

  assert.equal(receipt.site, 'youtube');
  assert.equal(receipt.command, 'search');
  assert.equal(receipt.ok, true);
  assert.equal(receipt.observations.videos.length, 1);
  assert.equal(receipt.observations.title, 'YouTube Search');
  assert.equal(receipt.observations.videos[0].text, 'Proof video visible row text');
  assert.deepEqual(receipt.steps.map(step => step.name), ['open_search_page', 'wait_for_search_results', 'extract_search_results']);
  const stepTrace = JSON.stringify(receipt.steps);
  assert.equal(stepTrace.includes('YouTube Search'), false);
  assert.equal(stepTrace.includes('Proof video visible row text'), false);
  assert.equal(stepTrace.includes('Proof video'), false);
});

test('youtube comments proof returns step trace through injected deps', async () => {
  const deps = {
    ...youtubeTesting.deps,
    openOrNavigateSitePage: async () => ({ pageId: 4, url: 'https://www.youtube.com/watch?v=abc123XYZ_1', title: 'Watch' }),
    sleep: async () => {},
    youtubeScrollToComments: async () => ({ pageId: 4, scrolled: true, y: 1200 }),
    youtubeComments: async () => ({
      comments: [
        { author: 'A', text: 'Visible comment', likes: '1', time: 'today' },
      ],
      evidence: {
        count: 1,
        limit: 1,
        root: 'ytd-comment-thread-renderer',
      },
    }),
  };

  const receipt = await youtubeTesting.runComments({ profile: 'default' }, { target: 'abc123XYZ_1', limit: '1' }, deps);

  assert.equal(receipt.site, 'youtube');
  assert.equal(receipt.command, 'comments');
  assert.equal(receipt.ok, true);
  assert.equal(receipt.observations.title, 'Watch');
  assert.equal(receipt.observations.comments.length, 1);
  assert.deepEqual(receipt.steps.map(step => step.name), ['open_video_page', 'wait_for_watch_page', 'scroll_to_comments', 'extract_comments']);
  const stepTrace = JSON.stringify(receipt.steps);
  assert.equal(stepTrace.includes('Watch'), false);
  assert.equal(stepTrace.includes('Visible comment'), false);
});

test('youtube video proof returns step trace through injected deps', async () => {
  const deps = {
    ...youtubeTesting.deps,
    openOrNavigateSitePage: async () => ({ pageId: 5, url: 'https://www.youtube.com/watch?v=abc123XYZ_1', title: 'Watch' }),
    sleep: async () => {},
    youtubeVideoDetails: async () => ({
      details: {
        url: 'https://www.youtube.com/watch?v=abc123XYZ_1',
        title: 'Watch',
        video: {
          id: 'abc123XYZ_1',
          title: 'Proof video',
          channel: 'Proof channel',
        },
        text: 'Visible watch page text',
      },
      evidence: {
        pageId: 5,
        hasVideoId: true,
      },
    }),
  };

  const receipt = await youtubeTesting.runVideo({ profile: 'default' }, { target: 'abc123XYZ_1' }, deps);

  assert.equal(receipt.site, 'youtube');
  assert.equal(receipt.command, 'video');
  assert.equal(receipt.ok, true);
  assert.equal(receipt.observations.title, 'Watch');
  assert.equal(receipt.observations.video.title, 'Proof video');
  assert.equal(receipt.observations.text, 'Visible watch page text');
  assert.deepEqual(receipt.steps.map(step => step.name), ['open_video_page', 'wait_for_watch_page', 'extract_video_details']);
  const stepTrace = JSON.stringify(receipt.steps);
  assert.equal(stepTrace.includes('Watch'), false);
  assert.equal(stepTrace.includes('Proof video'), false);
  assert.equal(stepTrace.includes('Visible watch page text'), false);
});

test('youtube channel proof returns step trace through injected deps', async () => {
  const deps = {
    ...youtubeTesting.deps,
    openOrNavigateSitePage: async () => ({ pageId: 6, url: 'https://www.youtube.com/@proof', title: 'Proof channel' }),
    sleep: async () => {},
    youtubeChannelSummary: async () => ({
      summary: {
        url: 'https://www.youtube.com/@proof',
        title: 'Proof channel',
        heading: 'Proof',
        text: 'Visible channel page text',
      },
      evidence: {
        pageId: 6,
        hasHeading: true,
      },
    }),
  };

  const receipt = await youtubeTesting.runChannel({ profile: 'default' }, { target: '@proof' }, deps);

  assert.equal(receipt.site, 'youtube');
  assert.equal(receipt.command, 'channel');
  assert.equal(receipt.ok, true);
  assert.equal(receipt.observations.title, 'Proof channel');
  assert.equal(receipt.observations.heading, 'Proof');
  assert.equal(receipt.observations.text, 'Visible channel page text');
  assert.deepEqual(receipt.steps.map(step => step.name), ['open_channel_page', 'wait_for_channel_page', 'extract_channel_summary']);
  const stepTrace = JSON.stringify(receipt.steps);
  assert.equal(stepTrace.includes('Proof channel'), false);
  assert.equal(stepTrace.includes('Visible channel page text'), false);
});
