/**
 * Locale-following spec: the sidebar copy follows the DSH locale service
 * (`ctx.locale`, provided by @deepseek-ai/dsh-client-locale) when attached
 * through `attachLocale`, and defaults to English otherwise. Covers
 * attach/detach, live switching, dictionary parity, and placeholder
 * interpolation.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { LOCALE_NS, attachLocale, en, isZh, relativeTime, t, zh } from '../src/client/locales.ts'

/** Minimal structural fake of the DSH LocaleService face the sidebar uses. */
class FakeLocale {
  active: string = 'en'
  getSnapshot(): { active: string } {
    return { active: this.active }
  }
  subscribe(_fn: () => void): () => void {
    return () => {}
  }
  register(_ns: string, _locale: string, _dict: Record<string, string>): () => void {
    return () => {}
  }
  switchTo(id: string): void {
    this.active = id
  }
}

afterEach(() => {
  attachLocale(undefined)
})

describe('locales (DSH i18n following)', () => {
  it('defaults to English without an attached locale service', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { language: 'zh-CN' },
      configurable: true,
    })
    expect(t('explorer')).toBe('Explorer')
    expect(isZh()).toBe(false)
  })

  it('follows the attached locale service instead of the English default', () => {
    const locale = new FakeLocale()
    attachLocale(locale)

    locale.switchTo('zh')
    expect(t('git')).toBe('源代码管理')
    expect(isZh()).toBe(true)

    // Live switches from the service remain authoritative.
    locale.switchTo('en')
    expect(t('git')).toBe('Source Control')
    expect(isZh()).toBe(false)
  })

  it('detaches back to the English default', () => {
    const locale = new FakeLocale()
    locale.switchTo('zh')
    const detach = attachLocale(locale)
    expect(t('terminal')).toBe('终端')

    detach()
    expect(t('terminal')).toBe('Terminal')
  })

  it('does not let a stale HMR disposer clear a newer attachment', () => {
    const locale = new FakeLocale()
    locale.switchTo('zh')
    const detachOld = attachLocale(locale)
    const detachCurrent = attachLocale(locale)

    detachOld()
    expect(t('terminal')).toBe('终端')

    detachCurrent()
    expect(t('terminal')).toBe('Terminal')
  })

  it('interpolates {name} placeholders in the active locale', () => {
    const locale = new FakeLocale()
    attachLocale(locale)
    locale.switchTo('zh')
    expect(t('timeMinutesAgo', { n: 5 })).toBe('5 分钟前')
    locale.switchTo('en')
    expect(t('timeMinutesAgo', { n: 5 })).toBe('5 min ago')
  })

  it('drives the relative-time chain through the active locale', () => {
    const locale = new FakeLocale()
    attachLocale(locale)
    locale.switchTo('zh')
    expect(relativeTime(new Date().toISOString())).toBe('刚刚')
    locale.switchTo('en')
    expect(relativeTime(new Date().toISOString())).toBe('just now')
  })

  it('registers a namespace distinct from DSH ui-sidebar\'s own \'sidebar\'', () => {
    expect(LOCALE_NS).toBe('betterSidebar')
  })

  it('keeps the zh and en dictionaries key-set-equal', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})
