import type { Page } from 'playwright';
import type { BrowserElementTarget } from '../shared/types.js';
import { SiteflowError } from '../shared/errors.js';

export async function findClickablePoint(page: Page, target: BrowserElementTarget, description: string): Promise<{ x: number; y: number }> {
  const nth = target.nth ?? 0;
  const result = await page.evaluate(({ selector, text, aria, exact, nth }) => {
    function visible(el: Element): boolean {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    }

    function ownText(el: Element): string {
      return (el.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function matches(el: Element): boolean {
      if (!visible(el)) return false;
      if (selector) return el.matches(selector);
      if (aria) {
        const label = el.getAttribute('aria-label') || '';
        return exact ? label === aria : label.includes(aria);
      }
      if (text) {
        const value = ownText(el);
        return exact ? value === text : value.includes(text);
      }
      return false;
    }

    function clickable(el: Element): boolean {
      const style = window.getComputedStyle(el);
      const role = el.getAttribute('role');
      const tag = el.tagName.toLowerCase();
      return style.cursor === 'pointer'
        || ['button', 'a', 'input', 'select', 'textarea', 'summary'].includes(tag)
        || ['button', 'link', 'menuitem', 'option', 'tab', 'combobox', 'checkbox', 'radio'].includes(role || '')
        || Boolean((el as HTMLElement).onclick);
    }

    const pool = selector ? [...document.querySelectorAll(selector)] : [...document.querySelectorAll('body *')];
    const match = pool.filter(matches)[nth];
    if (!match) return null;
    let current: Element | null = match;
    while (current && current !== document.body) {
      if (visible(current) && clickable(current)) break;
      current = current.parentElement;
    }
    const chosen = current && current !== document.body ? current : match;
    const rect = chosen.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, {
    selector: target.selector,
    text: target.text,
    aria: target.aria,
    exact: target.exact ?? true,
    nth,
  });

  if (!result) {
    throw new SiteflowError('TARGET_NOT_FOUND', `No visible target found for ${description}`);
  }

  return result;
}

export function inspectTargetCandidates(page: Page, target: BrowserElementTarget, limit: number) {
  return page.evaluate(({ selector, text, aria, exact, limit, includeHidden }) => {
    function visible(el: Element): boolean {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    }

    function clean(value: string | null | undefined): string {
      return (value || '').replace(/\s+/g, ' ').trim().slice(0, 240);
    }

    function matches(el: Element): boolean {
      if (selector) return el.matches(selector);
      if (aria) {
        const label = el.getAttribute('aria-label') || '';
        return exact ? label === aria : label.includes(aria);
      }
      if (text) {
        const value = clean(el.textContent);
        return exact ? value === text : value.includes(text);
      }
      return false;
    }

    function rectOf(el: Element) {
      const rect = el.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    }

    function brief(el: Element | null) {
      if (!el) return null;
      return {
        tag: el.tagName,
        role: el.getAttribute('role'),
        text: clean(el.textContent),
        id: (el as HTMLElement).id || undefined,
        className: typeof (el as HTMLElement).className === 'string' ? (el as HTMLElement).className.slice(0, 160) : undefined,
      };
    }

    function clickableParent(el: Element) {
      let current: Element | null = el;
      while (current && current !== document.body) {
        const style = window.getComputedStyle(current);
        const role = current.getAttribute('role');
        const tag = current.tagName.toLowerCase();
        if (
          style.cursor === 'pointer'
          || ['button', 'a', 'input', 'select', 'textarea', 'summary'].includes(tag)
          || ['button', 'link', 'menuitem', 'option', 'tab', 'combobox', 'checkbox', 'radio'].includes(role || '')
          || Boolean((current as HTMLElement).onclick)
        ) {
          return current;
        }
        current = current.parentElement;
      }
      return null;
    }

    const pool = selector ? [...document.querySelectorAll(selector)] : [...document.querySelectorAll('body *')];
    return pool
      .filter(matches)
      .filter(el => includeHidden || visible(el))
      .slice(0, limit)
      .map((el, index) => {
        const rect = el.getBoundingClientRect();
        const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        const parent = clickableParent(el);
        const parentBrief = parent ? brief(parent) : null;
        return {
          index,
          tag: el.tagName,
          role: el.getAttribute('role'),
          text: clean(el.textContent),
          aria: el.getAttribute('aria-label'),
          id: (el as HTMLElement).id || undefined,
          className: typeof (el as HTMLElement).className === 'string' ? (el as HTMLElement).className.slice(0, 160) : undefined,
          visible: visible(el),
          rect: rectOf(el),
          topElement: brief(top),
          clickableParent: parent && parentBrief ? {
            tag: parentBrief.tag,
            role: parentBrief.role,
            text: parentBrief.text,
            id: parentBrief.id,
            className: parentBrief.className,
            rect: rectOf(parent),
          } : null,
        };
      });
  }, {
    selector: target.selector,
    text: target.text,
    aria: target.aria,
    exact: target.exact ?? true,
    limit,
    includeHidden: Boolean(target.includeHidden),
  });
}
