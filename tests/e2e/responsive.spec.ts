/**
 * Phone-width layout check for every console screen, the portal and the quote page.
 *
 * At 360 px (a small Android phone) no page may scroll sideways. Wide tables and the
 * day board may scroll inside their own container, but the page itself must fit.
 * The test also reports the elements that stick out, so a failure says what to fix.
 */
import { test, expect, type Page, type Browser } from '@playwright/test';
import { signInAsAdmin, svc } from './helpers';

const WIDTH = 360;

async function staff(browser: Browser, email: string) {
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await signInAsAdmin(page, email);
  return { page, close: () => ctx.close() };
}

/** Elements whose right edge passes the viewport and that aren't inside a sideways-scrolling box. */
async function overflow(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out: string[] = [];
    const scrollsX = (el: Element | null): boolean => {
      for (let e = el; e && e !== document.body; e = e.parentElement) {
        const ox = getComputedStyle(e).overflowX;
        if ((ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') && e.scrollWidth >= e.clientWidth) return true;
      }
      return false;
    };
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > vw + 1 && !scrollsX(el.parentElement)) {
        const s = getComputedStyle(el);
        if (s.position === 'fixed' || s.visibility === 'hidden') continue;
        const id = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}` : ''}`;
        out.push(`${id} right=${Math.round(r.right)} "${(el.textContent ?? '').trim().slice(0, 30)}"`);
      }
    }
    // Also name the outermost boxes that are themselves wider than the screen (e.g. a scroll box that grew).
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      const r = el.getBoundingClientRect();
      const parent = el.parentElement?.getBoundingClientRect();
      if (r.width > vw + 1 && parent && parent.width <= vw + 1) {
        out.push(`WIDE ${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/).slice(0, 4).join('.')} w=${Math.round(r.width)} "${(el.textContent ?? '').trim().slice(0, 30)}"`);
      }
    }
    return { scrollWidth: document.documentElement.scrollWidth, vw, offenders: out.slice(0, 10) };
  });
}

async function check(page: Page, path: string, problems: string[]) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(300);
  const r = await overflow(page);
  if (r.scrollWidth > r.vw + 1) problems.push(`${path}: page is ${r.scrollWidth}px wide at ${r.vw}px\n    ${r.offenders.join('\n    ')}`);
}

async function ids() {
  const one = async (table: string, extra?: (q: any) => any) => {
    let q = (svc as any).from(table).select('id').limit(1);
    if (extra) q = extra(q);
    const { data } = await q;
    return data?.[0]?.id as string | undefined;
  };
  return {
    suggestion: await one('suggestions'),
    hr: await one('hr_reports'),
    job: await one('jobs'),
    crew: await one('crew_members'),
    estimate: await one('estimates', (q: any) => q.eq('status', 'draft')),
    estimateSent: await one('estimates', (q: any) => q.eq('status', 'sent')),
    client: await one('clients'),
    rateCard: await one('rate_cards'),
  };
}

test('every admin screen fits a 360 px phone without sideways scrolling', async ({ browser }) => {
  test.setTimeout(240_000);
  const id = await ids();
  const paths = [
    '/admin',
    id.suggestion && `/admin/s/${id.suggestion}`,
    '/admin/audit',
    '/admin/admins',
    '/admin/tools',
    '/admin/account',
    '/admin/dispatch',
    '/admin/dispatch/week',
    '/admin/dispatch/jobs',
    '/admin/dispatch/jobs/new',
    id.job && `/admin/dispatch/jobs/${id.job}`,
    id.job && `/admin/dispatch/print/${id.job}`,
    '/admin/dispatch/crew',
    id.crew && `/admin/dispatch/crew/${id.crew}`,
    '/admin/dispatch/assets',
    '/admin/dispatch/time-off',
    '/admin/dispatch/incidents',
    '/admin/dispatch/roles',
    '/admin/estimates',
    '/admin/estimates/new',
    id.estimate && `/admin/estimates/${id.estimate}`,
    id.estimateSent && `/admin/estimates/${id.estimateSent}`,
    id.estimate && `/admin/estimates/${id.estimate}/build-sheet`,
    '/admin/estimates/approvals',
    '/admin/estimates/clients',
    id.client && `/admin/estimates/clients/${id.client}`,
    '/admin/estimates/rates',
    id.rateCard && `/admin/estimates/rates/${id.rateCard}`,
    '/admin/estimates/rules',
    '/admin/estimates/terms',
  ].filter(Boolean) as string[];

  const problems: string[] = [];
  const admin = await staff(browser, 'admin@example.com');
  for (const p of paths) await check(admin.page, p, problems);
  await admin.close();

  const hr = await staff(browser, 'hr@example.com');
  for (const p of ['/admin/hr', '/admin/hr/team', id.hr && `/admin/hr/r/${id.hr}`].filter(Boolean) as string[]) await check(hr.page, p, problems);
  await hr.close();

  const crew = await staff(browser, 'crew@example.com');
  await check(crew.page, '/admin/my-jobs', problems);
  await crew.close();

  expect(problems, problems.join('\n')).toEqual([]);
});

test('portal, quote page and sign-in fit a 360 px phone', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 780 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const problems: string[] = [];
  for (const p of ['/s/local-dev-portal-key-1234', '/q/seedsentquotetoken000000000000A', '/admin']) await check(page, p, problems);
  await ctx.close();
  expect(problems, problems.join('\n')).toEqual([]);
});
