import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const frontend = process.env.BASE_URL || 'http://127.0.0.1:1337';
const nodeBase = process.env.HYPERBEAM_BASE_URL || 'http://127.0.0.1:18809';
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
});
const harness = `${frontend}/${'h'.repeat(43)}/`;
const modulePath = '/ui/util/hyperbeam.ts';
const contexts = [];
const appErrors = [];

async function actor(name) {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  let showApp = false;
  page.on('pageerror', (error) => {
    if (!error.stack?.includes('/@vite/client:')) appErrors.push(error.message);
  });
  await page.route(`${frontend}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.href === harness && showApp) return route.fulfill({ response: await route.fetch({ url: frontend + '/' }) });
    if (url.href === harness)
      return route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><body>Native notification integration</body></html>',
      });
    if (/^\/(?:id(?:\?|\/|$)|~|[A-Za-z0-9_-]{43}(?:\/|$))/.test(url.pathname)) {
      try {
        const response = await route.fetch({
          url: `${nodeBase}${url.pathname}${url.search}`,
          maxRetries: route.request().method() === 'GET' ? 2 : 0,
        });
        return await route.fulfill({ response });
      } catch {
        return route.abort('failed');
      }
    }
    return route.continue();
  });
  await page.addInitScript(
    ({ nodeBase, frontend }) => {
      window.__ = (s) => s;
      window.process = {
        env: {
          NODE_ENV: 'development',
          ODYSEE_HYPERBEAM_NODE_API: nodeBase,
          HYPERBEAM_BASE_URL: nodeBase,
          URL: frontend,
        },
      };
    },
    { nodeBase, frontend }
  );
  await page.goto(harness);
  const profile = await page.evaluate(
    async (name) => (await import('/ui/util/hyperbeamAccount.ts')).signUpHyperbeam(name),
    name
  );
  return {
    page,
    profile,
    showApp: () => {
      showApp = true;
    },
  };
}

async function list(page) {
  return page.evaluate(async (path) => (await import(path)).fetchHyperbeamNotifications(), modulePath);
}

async function eventually(read, accept, label) {
  const deadline = Date.now() + 90000;
  let result;
  do {
    result = await read();
    if (accept(result)) return result;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  } while (Date.now() < deadline);
  assert.fail(`${label}: ${JSON.stringify(result)}`);
}

try {
  const viewer = await actor(`notification-viewer-${Date.now()}`);
  const creator = await actor(`notification-creator-${Date.now()}`);
  await viewer.page.evaluate(
    async ({ profile, path }) => {
      await (
        await import(path)
      ).fetchHyperbeamSubscriptionUpdate({
        channelName: profile.name,
        uri: `lbry://@${profile.name}#${profile.id}`,
        notificationsDisabled: false,
      });
    },
    { profile: creator.profile, path: modulePath }
  );
  const upload = await creator.page.evaluate(async (profile) => {
    const write = async (body, contentType) => {
      const response = await fetch('/id?0.%21=true&committers=all', {
        method: 'POST',
        credentials: 'include',
        headers: { accept: 'application/json', 'content-type': contentType },
        body,
      });
      if (!response.ok) throw Error(`Upload fixture failed: ${response.status}`);
      return response.headers.get('message-id') || (await response.json())['message-id'];
    };
    const dataId = await write(new Blob(['native notification fixture']), 'application/octet-stream');
    return write(
      JSON.stringify({
        schema: 'odysee-upload@1.0',
        type: 'upload',
        name: `notification-video-${Date.now()}`,
        title: 'Notification test video',
        'data-id': dataId,
        'channel-id': profile.id,
        'channel-name': profile.name,
        'content-type': 'video/mp4',
        'source-size': '27',
        timestamp: Math.floor(Date.now() / 1000),
      }),
      'application/json'
    );
  }, creator.profile);
  const parent = await viewer.page.evaluate(
    async ({ target, path }) =>
      (await import(path)).fetchHyperbeamCommentCreate({ claim_id: target, comment: 'A native parent comment' }),
    { target: upload, path: modulePath }
  );
  const reply = await creator.page.evaluate(
    async ({ target, parent, path }) =>
      (await import(path)).fetchHyperbeamCommentCreate({
        claim_id: target,
        parent_id: parent,
        comment: 'A native notification reply',
      }),
    { target: upload, parent: parent.comment_id, path: modulePath }
  );
  const notifications = await eventually(
    () => list(viewer.page),
    (items) => items.length === 2,
    'reply and upload notification'
  );
  assert.deepEqual(
    new Set(notifications.map((item) => item.notification_rule)),
    new Set(['new_content', 'comment-reply'])
  );
  viewer.showApp();
  await viewer.page.goto(harness + '#/$/notifications');
  await viewer.page.reload();
  await viewer.page.getByRole('heading', { name: 'Notifications', exact: true }).waitFor({ timeout: 60000 });
  await viewer.page.locator('.notification-page select').selectOption('Replies');
  await viewer.page.locator('.notification-page .notification__wrapper').waitFor();
  assert.equal(await viewer.page.locator('.notification-page .notification__wrapper').count(), 1);
  await viewer.page.locator('.notification-page select').selectOption('All');
  await viewer.page.getByRole('button', { name: 'Mark all as read' }).click();
  await eventually(
    () => list(viewer.page),
    (items) => items.every((item) => item.is_read),
    'mark all read from the page'
  );
  if (process.env.NOTIFICATION_SCREENSHOT)
    await viewer.page.screenshot({ path: process.env.NOTIFICATION_SCREENSHOT, fullPage: true });
  const replyNotification = notifications.find((item) => item.notification_rule === 'comment-reply');
  assert.equal(replyNotification.id, `reply:${reply.comment_id}`);
  assert.equal(replyNotification.notification_parameters.dynamic.hash, reply.comment_id);
  assert.ok(replyNotification.notification_parameters.dynamic.reply_author.includes(creator.profile.id));
  assert.equal((await list(creator.page)).length, 0, 'self activity does not notify');
  assert.equal(
    (await list(viewer.page)).every((item) => item.is_read && item.is_seen),
    true
  );
  await viewer.page.reload();
  await eventually(
    () => list(viewer.page),
    (items) => items.length === 2 && items.every((item) => item.is_read),
    'read state after reload'
  );
  await viewer.page.getByRole('button', { name: 'Notifications', exact: true }).click();
  const drawerReply = viewer.page
    .locator('.menu__list--notification')
    .filter({ hasText: 'A native notification reply' });
  await drawerReply.locator('.delete-notification').click();
  await eventually(
    () => list(viewer.page),
    (items) => items.length === 1,
    'dismiss from the header drawer'
  );
  await viewer.page.reload();
  await eventually(
    () => list(viewer.page),
    (items) => items.length === 1 && items[0].notification_rule === 'new_content',
    'dismissal after reload'
  );
  const link = await viewer.page.evaluate(
    async (notification) =>
      (await import('/ui/component/notification/helpers/target.ts')).getNotificationLink(notification),
    replyNotification
  );
  assert.ok(link.includes(encodeURIComponent(reply.comment_id)), 'notification link points to the logical comment');
  await viewer.page.evaluate(async () => (await import('/ui/util/hyperbeamAccount.ts')).signOutHyperbeam());
  await viewer.page.reload();
  await viewer.page.getByText('Sign in to view notifications', { exact: true }).waitFor();
  assert.equal(await viewer.page.locator('.notification__wrapper').count(), 0);
  assert.deepEqual(appErrors, []);
  console.log(
    'PASS: real cookie accounts, follow bell, upload/reply discovery, verified authors, rendered inbox filters, mark all read, header dismissal, encrypted receipts after reload, comment links and sign-out.'
  );
} finally {
  await Promise.all(
    contexts.flatMap((context) => context.pages().map((page) => page.unrouteAll({ behavior: 'ignoreErrors' })))
  );
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
}
