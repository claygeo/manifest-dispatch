/**
 * Supabase client — lazily, and only ever for live mode.
 *
 * The import is dynamic on purpose. SPEC.md: "Demo mode (default): fully
 * client-side... Zero backend dependency for the recruiter first-click", and
 * "demo mode never touches the network". A static import would put the SDK in
 * the entry chunk and every visitor would pay for a feature almost none of them
 * open. Vite code-splits this into its own chunk, fetched the first time a
 * dispatcher arms a session.
 *
 * Nothing here throws at the caller: a live transport that cannot connect must
 * degrade behind an honest amber banner, never break the page it is bolted to.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_KEY, SUPABASE_URL } from './config'

let clientPromise: Promise<SupabaseClient> | null = null

export function getLiveClient(): Promise<SupabaseClient> {
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js')
      .then((mod) =>
        mod.createClient(SUPABASE_URL, SUPABASE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          realtime: { params: { eventsPerSecond: 10 } },
          global: { headers: { 'x-manifest-surface': 'demo' } },
        }),
      )
      .catch((err) => {
        // let the next attempt retry rather than caching a rejected promise
        clientPromise = null
        throw err
      })
  }
  return clientPromise
}

/** true once the SDK has been pulled in — used to skip teardown work in demo mode. */
export function liveClientLoaded(): boolean {
  return clientPromise !== null
}
