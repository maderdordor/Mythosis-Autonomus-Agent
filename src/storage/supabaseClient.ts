import { createClient } from '@supabase/supabase-js'
import { config } from '../config/index.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('storage:supabase')

// ============================================================================
// Supabase client — use service role key for agent operations
// Service role bypasses RLS — never expose this key to client-side code
// ============================================================================

export const supabase = createClient(
  config.SUPABASE_URL,
  config.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    db: {
      schema: 'public',
    },
  }
)

/**
 * Test the Supabase connection on startup.
 * Throws if connection fails — agent should not start with broken DB.
 */
export async function testConnection(): Promise<void> {
  const { error } = await supabase
    .from('system_config')
    .select('key')
    .limit(1)

  if (error) {
    log.error({ error }, 'Supabase connection test FAILED')
    throw new Error(`Supabase connection failed: ${error.message}`)
  }

  log.info('Supabase connection OK')
}

/**
 * Get a system config value by key.
 */
export async function getSystemConfig(key: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('system_config')
    .select('value')
    .eq('key', key)
    .single()

  if (error || !data) return null
  return data.value as string
}

/**
 * Set a system config value.
 */
export async function setSystemConfig(key: string, value: string): Promise<void> {
  const { error } = await supabase
    .from('system_config')
    .upsert({ key, value, updated_at: new Date().toISOString() })

  if (error) {
    log.error({ key, value, error }, 'Failed to set system config')
    throw new Error(`Failed to set system config [${key}]: ${error.message}`)
  }
}
