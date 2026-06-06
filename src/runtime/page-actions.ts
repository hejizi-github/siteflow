import type { Locator, Page } from 'playwright';
import type {
  BrowserClickOptions,
  BrowserElementTarget,
  BrowserSelectOptions,
  BrowserTypeOptions,
  BrowserUploadOptions,
} from '../shared/types.js';
import { SiteflowError } from '../shared/errors.js';
import { findClickablePoint, inspectTargetCandidates } from './page-action-helpers.js';

export async function clickPageTarget(page: Page, options: BrowserClickOptions): Promise<string> {
  const timeout = options.timeoutMs ?? 10_000;
  let targetDescription: string;
  if (Number.isFinite(options.x) && Number.isFinite(options.y)) {
    await page.mouse.click(options.x!, options.y!, { button: options.button || 'left' });
    targetDescription = `xy:${options.x},${options.y}`;
  } else if (options.clickableParent) {
    targetDescription = `${describeTarget(options)} -> clickable-parent`;
    const clickPoint = await findClickablePoint(page, options, describeTarget(options));
    await page.mouse.click(clickPoint.x, clickPoint.y, { button: options.button || 'left' });
  } else {
    const locator = locatorForTarget(page, options);
    targetDescription = describeTarget(options);
    await locator.click({ button: options.button || 'left', timeout, force: options.force });
  }
  await assertPostconditions(page, options, timeout);
  return targetDescription;
}

export async function typeIntoPageTarget(page: Page, options: BrowserTypeOptions): Promise<void> {
  const timeout = options.timeoutMs ?? 10_000;
  const locator = locatorForTarget(page, options);
  await locator.waitFor({ state: 'visible', timeout });
  await locator.focus({ timeout });
  if (options.clear !== false) {
    await clearFocusedEditable(page);
  }
  await page.keyboard.type(options.value);
  if (options.pressEnter) await page.keyboard.press('Enter');
}

export async function uploadToPageTarget(page: Page, options: BrowserUploadOptions): Promise<BrowserElementTarget> {
  const timeout = options.timeoutMs ?? 10_000;
  const target: BrowserElementTarget = {
    selector: options.selector || 'input[type="file"]',
    text: options.text,
    aria: options.aria,
    exact: options.exact,
    nth: options.nth,
  };
  const locator = locatorForTarget(page, target);
  await locator.waitFor({ state: 'attached', timeout });
  await locator.setInputFiles(options.files, { timeout });
  return target;
}

export async function selectPageOption(page: Page, options: BrowserSelectOptions): Promise<BrowserElementTarget> {
  const timeout = options.timeoutMs ?? 10_000;
  const before = await nativeSelectSelectionForTarget(page, options) ?? await visibleTextForSelectTarget(page, options);
  const target = selectTargetFromOptions(options);
  const combo = locatorForTarget(page, target);
  if (await isNativeSelectLocator(combo)) {
    await selectNativeOption(combo, options, timeout);
  } else {
    await combo.click({ timeout, force: options.force });
    await clickVisibleOption(page, options, timeout);
  }
  if (options.verify !== false) {
    const changed = await waitForSelectPostcondition(page, options, before, timeout);
    if (!changed) {
      throw new SiteflowError(
        'SELECT_POSTCONDITION_FAILED',
        `Selected option "${options.option}" but the combobox did not visibly change.`,
        'Use browser inspect-target on the combobox/option, or retry with a more specific selector.',
      );
    }
  }
  return target;
}

export function inspectPageTarget(page: Page, target: BrowserElementTarget, limit: number) {
  return inspectTargetCandidates(page, target, limit);
}

export async function capturePageScreenshot(page: Page, fullPage: boolean): Promise<Buffer> {
  return page.screenshot({ fullPage, type: 'png' });
}

export function describeTarget(target: BrowserElementTarget): string {
  if (target.selector) return `selector:${target.selector}`;
  if (target.aria) return `aria:${target.aria}`;
  if (target.text) return `text:${target.text}`;
  return 'unknown';
}

function locatorForTarget(page: Page, target: BrowserElementTarget): Locator {
  const nth = target.nth ?? 0;
  if (target.selector) return page.locator(target.selector).nth(nth);
  if (target.aria) {
    return page.locator(`[aria-label="${cssStringEscape(target.aria)}"]`).filter({ visible: true }).nth(nth)
      .or(page.getByLabel(target.aria, { exact: target.exact ?? true }).filter({ visible: true }).nth(nth));
  }
  if (target.text) return page.getByText(target.text, { exact: target.exact ?? true }).filter({ visible: true }).nth(nth);
  throw new SiteflowError('MISSING_TARGET', 'Action requires --selector, --text, --aria, or --xy.');
}

async function assertPostconditions(page: Page, options: BrowserClickOptions, timeout: number): Promise<void> {
  if (options.expectText) {
    try {
      await page.getByText(options.expectText, { exact: false }).waitFor({ state: 'visible', timeout });
    } catch {
      throw new SiteflowError('CLICK_POSTCONDITION_FAILED', `Text "${options.expectText}" was not visible after click.`);
    }
  }
  if (options.expectSelector) {
    try {
      await page.locator(options.expectSelector).first().waitFor({ state: 'visible', timeout });
    } catch {
      throw new SiteflowError('CLICK_POSTCONDITION_FAILED', `Selector "${options.expectSelector}" was not visible after click.`);
    }
  }
}

async function isNativeSelectLocator(locator: Locator): Promise<boolean> {
  try {
    return await locator.evaluate((element) => element.tagName.toLowerCase() === 'select' || element instanceof HTMLSelectElement);
  } catch {
    return false;
  }
}

async function selectNativeOption(locator: Locator, options: BrowserSelectOptions, timeout: number): Promise<void> {
  try {
    await locator.selectOption({ label: options.option }, { timeout });
  } catch {
    await locator.selectOption({ value: options.option }, { timeout });
  }
}

function selectTargetFromOptions(options: BrowserSelectOptions): BrowserElementTarget {
  return options.selector
    ? { selector: options.selector, exact: options.exact }
    : { text: options.comboboxText, exact: options.exact };
}

interface NativeSelectSelection {
  label: string | null;
  value: string | null;
}

async function nativeSelectSelectionForTarget(page: Page, options: BrowserSelectOptions): Promise<NativeSelectSelection | null> {
  const locator = locatorForTarget(page, selectTargetFromOptions(options));
  try {
    const selection = await locator.evaluate((element) => {
      if (element.tagName.toLowerCase() !== 'select') return null;
      const select = element as HTMLSelectElement;
      const option = select.selectedOptions[0];
      return {
        label: option?.label || option?.innerText || option?.textContent || null,
        value: select.value || option?.value || null,
      };
    });
    if (!selection) return null;
    const label = normalizeSelectText(selection.label);
    const value = normalizeSelectText(selection.value);
    return label || value ? { label, value } : null;
  } catch {
    return null;
  }
}

async function visibleTextForSelectTarget(page: Page, options: BrowserSelectOptions): Promise<string | null> {
  const target = selectTargetFromOptions(options);
  const locator = locatorForTarget(page, target);
  try {
    const text = await locator.innerText({ timeout: 1000 });
    return text.replace(/\s+/g, ' ').trim();
  } catch {
    return null;
  }
}

async function clickVisibleOption(page: Page, options: BrowserSelectOptions, timeout: number): Promise<void> {
  const exact = options.exact ?? true;
  const roleOption = page.getByRole('option', { name: options.option, exact }).filter({ visible: true }).first();
  if (await roleOption.count()) {
    await roleOption.click({ timeout, force: options.force });
    return;
  }
  const point = await findClickablePoint(page, { text: options.option, exact, nth: 0 }, describeTarget({ text: options.option, exact, nth: 0 }));
  await page.mouse.click(point.x, point.y);
}

function normalizeSelectText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized || null;
}

function nativeSelectionMatches(selection: NativeSelectSelection, expected: string): boolean {
  return Boolean(selection.label?.includes(expected) || selection.value === expected);
}

function nativeSelectionChanged(selection: NativeSelectSelection, before: NativeSelectSelection | string | null): boolean {
  if (!before) return true;
  if (typeof before === 'string') return selection.label !== before && selection.value !== before;
  return selection.label !== before.label || selection.value !== before.value;
}

function genericSelectionChanged(current: string, before: NativeSelectSelection | string | null): boolean {
  if (!before) return true;
  if (typeof before === 'string') return current !== before;
  return current !== before.label && current !== before.value;
}

async function waitForSelectPostcondition(
  page: Page,
  options: BrowserSelectOptions,
  before: NativeSelectSelection | string | null,
  timeout: number,
): Promise<boolean> {
  const deadline = Date.now() + timeout;
  const expected = options.option.replace(/\s+/g, ' ').trim();
  while (Date.now() < deadline) {
    const nativeSelection = await nativeSelectSelectionForTarget(page, options);
    if (nativeSelection && nativeSelectionMatches(nativeSelection, expected) && nativeSelectionChanged(nativeSelection, before)) {
      return true;
    }
    const current = await visibleTextForSelectTarget(page, options);
    if (current && current.includes(expected) && genericSelectionChanged(current, before)) return true;
    const visibleComboboxTexts = await page.locator('[role=combobox]').filter({ visible: true }).allInnerTexts().catch(() => []);
    if (visibleComboboxTexts.some(text => text.replace(/\s+/g, ' ').trim().includes(expected))) return true;
    await page.waitForTimeout(100);
  }
  return false;
}

function cssStringEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function clearFocusedEditable(page: Page): Promise<void> {
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');
}
