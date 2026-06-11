import { Redis } from '@upstash/redis'
import { config } from '../config/index.js'
import { createLogger } from './logger.js'

const log = createLogger('utils:redis')

// ============================================================================
// Upstash Redis client (HTTP-based — no persistent TCP connection needed)
// ============================================================================

let _client: Redis | null = null

function getClient(): Redis {
  if (!_client) {
    _client = new Redis({
      url: config.UPSTASH_REDIS_REST_URL,
      token: config.UPSTASH_REDIS_REST_TOKEN,
    })
  }
  return _client
}

export const redis = {
  /**
   * Get a cached value. Returns null if not found or expired.
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await getClient().get<T>(key)
      return value
    } catch (err) {
      log.warn({ key, err }, 'Redis GET failed — treating as cache miss')
      return null
    }
  },

  /**
   * Set a value with optional TTL in seconds.
   */
  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    try {
      if (ttlSeconds) {
        await getClient().set(key, value, { ex: ttlSeconds })
      } else {
        await getClient().set(key, value)
      }
    } catch (err) {
      log.warn({ key, err }, 'Redis SET failed — continuing without cache')
    }
  },

  /**
   * Delete a key.
   */
  async del(key: string): Promise<void> {
    try {
      await getClient().del(key)
    } catch (err) {
      log.warn({ key, err }, 'Redis DEL failed')
    }
  },

  /**
   * Increment a counter (for rate limiting).
   * Returns the new value.
   */
  async incr(key: string): Promise<number> {
    try {
      return await getClient().incr(key)
    } catch (err) {
      log.warn({ key, err }, 'Redis INCR failed — returning 0')
      return 0
    }
  },

  /**
   * Set TTL on existing key (for rate limit windows).
   */
  async expire(key: string, ttlSeconds: number): Promise<void> {
    try {
      await getClient().expire(key, ttlSeconds)
    } catch (err) {
      log.warn({ key, err }, 'Redis EXPIRE failed')
    }
  },

  /**
   * Check if a rate limit is exceeded.
   * Increments the counter and sets TTL on first call within window.
   *
   * @returns { allowed: boolean, current: number, limit: number }
   */
  async checkRateLimit(
    key: string,
    limit: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; current: number; limit: number }> {
    const current = await this.incr(key)
    if (current === 1) {
      // First call in window — set expiry
      await this.expire(key, windowSeconds)
    }
    return { allowed: current <= limit, current, limit }
  },
}

// ============================================================================
// Cache key factories — consistent naming across the codebase
// ============================================================================

export const cacheKeys = {
  // Nansen
  nansenToken: (chain: string, address: string) =>
    `nansen:token:${chain}:${address}`,
  nansenWallet: (chain: string, address: string) =>
    `nansen:wallet:${chain}:${address}`,
  nansenDailyCredits: () =>
    `nansen:credits:${new Date().toISOString().slice(0, 10)}`,

  // CoinGlass
  coinglassScan: (symbol: string) =>
    `coinglass:scan:${symbol}`,
  coinglassDailyCalls: () =>
    `coinglass:calls:${new Date().toISOString().slice(0, 10)}`,

  // LLM
  llmDailyCalls: () =>
    `llm:calls:${new Date().toISOString().slice(0, 10)}`,

  // Rate limits
  bybitRateLimit: () =>
    `bybit:rl:${Math.floor(Date.now() / 60000)}`, // Per minute
}
