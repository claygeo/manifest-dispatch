/**
 * The lazy route must never be able to take the app down with it.
 *
 * The reported failure, verbatim: load `/` while online (so the PlanPage chunk
 * is never fetched), go offline, click through to `/plan`. Vite's chunk loader
 * rejects with "Unable to preload CSS for /assets/PlanPage-*.css", React
 * rethrows that rejection at the nearest error boundary, there was no boundary,
 * and the whole tree unmounted — `#root` empty, blank page, fleet gone.
 *
 * This is the one test in the suite that needs a DOM, and it needs one for a
 * real reason: the failure only exists in the commit/unmount path of an actual
 * React render. A pure-logic assertion about `getDerivedStateFromError` would
 * restate the boundary rather than test it, and would have passed just as
 * happily on the broken build. So: jsdom, a real root, a real `React.lazy`
 * whose factory rejects, and assertions about what is actually in the document
 * afterwards.
 *
 * @vitest-environment jsdom
 */

import { createElement, type ComponentType } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LazyRoute } from './RouteBoundary'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

/** The exact rejection Vite's preload helper produces when a chunk cannot load. */
const CHUNK_ERROR = () =>
  new Error('Unable to preload CSS for /assets/PlanPage-a1b2c3d4.css')

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  globalThis.IS_REACT_ACT_ENVIRONMENT = false
})

/** A trivial route screen, so a successful load is distinguishable. */
const Planner: ComponentType = () => createElement('p', null, 'planner mounted')

async function render(load: () => Promise<{ default: ComponentType }>): Promise<void> {
  await act(async () => {
    root.render(createElement(LazyRoute, { load, what: 'The planner' }))
  })
}

function text(): string {
  return host.textContent ?? ''
}

function retryButton(): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>('.app-fallback__actions button')
  if (!button) throw new Error(`no retry button in: ${text()}`)
  return button
}

describe('a lazy route whose chunk will not load', () => {
  it('renders the screen when the chunk loads', async () => {
    await render(async () => ({ default: Planner }))
    expect(text()).toContain('planner mounted')
    expect(host.querySelector('.app-fallback')).toBeNull()
  })

  /**
   * The regression itself. Before the boundary, this render left `host` empty:
   * React unmounts the tree when nothing catches. "Not empty" is therefore as
   * much of the assertion as the copy is.
   */
  it('catches the rejection instead of unmounting the tree', async () => {
    await render(() => Promise.reject(CHUNK_ERROR()))

    expect(host.innerHTML).not.toBe('')
    expect(host.querySelector('.app-fallback')).not.toBeNull()
    expect(text()).toContain('This part of the demo could not load')
    expect(text()).toContain('The rest keeps running')
  })

  it('offers a way back to the surfaces that did not fail', async () => {
    await render(() => Promise.reject(CHUNK_ERROR()))
    const hrefs = [...host.querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(hrefs).toContain('/dispatch')
    expect(hrefs).toContain('/')
  })

  it('shows the loading line while the chunk is still in flight', async () => {
    let resolve: ((mod: { default: ComponentType }) => void) | null = null
    const pending = new Promise<{ default: ComponentType }>((r) => {
      resolve = r
    })

    await render(() => pending)
    expect(text()).toContain('Loading the planner')
    expect(host.querySelector('.app-loading')).not.toBeNull()

    await act(async () => {
      resolve!({ default: Planner })
    })
    expect(text()).toContain('planner mounted')
  })

  /**
   * Retry has to re-IMPORT. `React.lazy` memoises the promise it was given,
   * rejection included, so a boundary that only cleared its own error state
   * would render the same failed component again and land straight back on the
   * fallback — a button that looks like a retry and cannot be one.
   */
  it('really re-imports when the retry button is pressed', async () => {
    let attempts = 0
    const flaky = () => {
      attempts += 1
      return attempts === 1
        ? Promise.reject(CHUNK_ERROR())
        : Promise.resolve({ default: Planner })
    }

    await render(flaky)
    expect(attempts).toBe(1)
    expect(text()).toContain('This part of the demo could not load')

    await act(async () => {
      retryButton().click()
    })

    expect(attempts).toBe(2)
    expect(text()).toContain('planner mounted')
    expect(host.querySelector('.app-fallback')).toBeNull()
  })

  /**
   * The escalation. A re-import cannot recover a chunk whose SCRIPT fetch
   * failed — the browser records that failure in the module map for the life of
   * the document and replays it without touching the network (measured against
   * the built app: zero requests on retry). So once retrying has been tried and
   * has not worked, the fallback has to offer the thing that does work.
   */
  it('offers a reload only after a retry has actually failed', async () => {
    let attempts = 0
    const dead = () => {
      attempts += 1
      return Promise.reject(CHUNK_ERROR())
    }

    await render(dead)
    // first failure: retry is the whole offer, no reload shouted at the visitor
    expect(host.querySelector('[data-role="reload"]')).toBeNull()

    await act(async () => {
      retryButton().click()
    })

    expect(attempts).toBe(2)
    expect(host.querySelector('.app-fallback')).not.toBeNull()
    // still a live control, not a spent one
    expect(retryButton().disabled).toBe(false)
    // ...and now the honest way out is on screen, with copy that says why
    const reload = host.querySelector<HTMLButtonElement>('[data-role="reload"]')
    expect(reload).not.toBeNull()
    expect(reload!.textContent).toContain('Reload')
    expect(text()).toContain('the browser remembers it for this page')
  })
})
