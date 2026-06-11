import { z } from 'zod'
import { config as loadDotenv } from 'dotenv'
import { resolve } from 'path'

// Load .env from project root
loadDotenv({ path: resolve(process.cwd(), '.env') })

// ============================================================================
// Schema definition — every env var is validated here
// ============================================================================

const envSchema = z.object({

  // --- Database (Supabase) ---
  SUPABASE_URL: z.string().url({ message: 'SUPABASE_URL must be a valid URL' }),
  SUPABASE_ANON_KEY: z.string().min(10, 'SUPABASE_ANON_KEY is required'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10, 'SUPABASE_SERVICE_ROLE_KEY is required'),
  DATABASE_URL: z.string().min(10, 'DATABASE_URL is required (postgresql://...)'),

  // --- Cache (Upstash Redis) ---
  UPSTASH_REDIS_REST_URL: z.string().url({ message: 'UPSTASH_REDIS_REST_URL must be a valid URL' }),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(10, 'UPSTASH_REDIS_REST_TOKEN is required'),
  REDIS_URL: z.string().min(10, 'REDIS_URL is required (for BullMQ)'),

  // --- Exchange (Bybit) — OPTIONAL in Phase 0 ---
  // Public OHLCV endpoints work without API key
  BYBIT_API_KEY: z.string().default(''),
  BYBIT_API_SECRET: z.string().default(''),
  BYBIT_TESTNET: z.string()
    .transform(v => v === 'true')
    .default('true'),

  // --- Backtest & Execution Realism ---
  MAKER_FEE: z.string()
    .transform(v => parseFloat(v))
    .refine(v => v > 0 && v < 0.01, 'MAKER_FEE must be between 0 and 0.01')
    .default('0.0002'),
  TAKER_FEE: z.string()
    .transform(v => parseFloat(v))
    .refine(v => v > 0 && v < 0.01, 'TAKER_FEE must be between 0 and 0.01')
    .default('0.00055'),
  SLIPPAGE: z.string()
    .transform(v => parseFloat(v))
    .refine(v => v >= 0 && v < 0.01, 'SLIPPAGE must be between 0 and 0.01')
    .default('0.0005'),
  ENTRY_DELAY_BARS: z.string()
    .transform(v => parseInt(v, 10))
    .refine(v => v >= 1, 'ENTRY_DELAY_BARS must be at least 1')
    .default('1'),
  EXIT_DELAY_BARS: z.string()
    .transform(v => parseInt(v, 10))
    .refine(v => v >= 1, 'EXIT_DELAY_BARS must be at least 1')
    .default('1'),
  FEE_VIABILITY_MULTIPLIER: z.string()
    .transform(v => parseFloat(v))
    .refine(v => v >= 1, 'FEE_VIABILITY_MULTIPLIER must be >= 1')
    .default('2'),

  // --- Risk Engine ---
  MAX_RISK_PER_TRADE: z.string()
    .transform(v => parseFloat(v))
    .refine(v => v > 0 && v <= 0.02, 'MAX_RISK_PER_TRADE must be between 0 and 0.02')
    .default('0.005'),
  MAX_DAILY_LOSS: z.string()
    .transform(v => parseFloat(v))
    .refine(v => v > 0 && v <= 0.1, 'MAX_DAILY_LOSS must be between 0 and 0.1')
    .default('0.02'),
  MAX_WEEKLY_LOSS: z.string()
    .transform(v => parseFloat(v))
    .default('0.05'),
  MAX_ACCOUNT_DRAWDOWN: z.string()
    .transform(v => parseFloat(v))
    .refine(v => v > 0 && v <= 0.5, 'MAX_ACCOUNT_DRAWDOWN must be between 0 and 0.5')
    .default('0.10'),
  MAX_LEVERAGE: z.string()
    .transform(v => parseFloat(v))
    .refine(v => v >= 1 && v <= 5, 'MAX_LEVERAGE must be between 1 and 5')
    .default('2'),
  MAX_OPEN_POSITIONS: z.string()
    .transform(v => parseInt(v, 10))
    .refine(v => v >= 1 && v <= 10, 'MAX_OPEN_POSITIONS must be between 1 and 10')
    .default('3'),
  LOSS_STREAK_COOLDOWN: z.string()
    .transform(v => parseInt(v, 10))
    .default('3'),
  KILL_SWITCH: z.string()
    .transform(v => v === 'true')
    .default('true'),

  // --- Trade Frequency ---
  MIN_TRADE_FREQUENCY_PER_DAY: z.string()
    .transform(v => parseInt(v, 10))
    .default('5'),
  MAX_TRADE_FREQUENCY_PER_DAY: z.string()
    .transform(v => parseInt(v, 10))
    .default('30'),

  // --- Decision Mode ---
  DECISION_MODE: z.enum(['hardcoded', 'llm_advisory', 'llm_active']).default('hardcoded'),
  LLM_SIGNAL_PROVIDER: z.enum(['deepseek', 'openai']).default('deepseek'),
  LLM_MACRO_PROVIDER: z.enum(['grok', 'openai']).default('grok'),
  LLM_TIMEOUT_MS: z.string().transform(v => parseInt(v, 10)).default('8000'),
  LLM_FALLBACK: z.enum(['hardcoded']).default('hardcoded'),
  LLM_MAX_DAILY_CALLS: z.string().transform(v => parseInt(v, 10)).default('500'),
  LLM_MAX_MONTHLY_USD: z.string().transform(v => parseFloat(v)).default('50'),
  GROK_POLL_INTERVAL_MINUTES: z.string().transform(v => parseInt(v, 10)).default('30'),

  // --- Live / Paper Trading ---
  LIVE_TRADING: z.string().transform(v => v === 'true').default('false'),
  PAPER_TRADING: z.string().transform(v => v === 'true').default('false'),
  EXECUTION_MODE: z.enum(['manual', 'semi_auto', 'full_auto']).default('manual'),

  // --- Nansen ---
  NANSEN_API_KEY: z.string().default(''),
  NANSEN_BASE_URL: z.string().url().default('https://api.nansen.ai'),
  NANSEN_ENABLED: z.string().transform(v => v === 'true').default('false'),
  NANSEN_CACHE_TTL_SECONDS: z.string().transform(v => parseInt(v, 10)).default('60'),
  NANSEN_WALLET_LABEL_CACHE_HOURS: z.string().transform(v => parseInt(v, 10)).default('24'),
  NANSEN_MAX_DAILY_CREDITS: z.string().transform(v => parseInt(v, 10)).default('5000'),
  NANSEN_FAIL_OPEN: z.string().transform(v => v === 'true').default('false'),
  NANSEN_MIN_SMART_MONEY_SCORE: z.string().transform(v => parseFloat(v)).default('70'),
  NANSEN_MIN_WALLET_CREDIBILITY: z.string().transform(v => parseFloat(v)).default('65'),
  NANSEN_MIN_NETFLOW_SCORE: z.string().transform(v => parseFloat(v)).default('60'),
  NANSEN_BLOCK_ON_DISTRIBUTION: z.string().transform(v => v === 'true').default('true'),

  // --- CoinGlass ---
  COINGLASS_API_KEY: z.string().default(''),
  COINGLASS_ENABLED: z.string().transform(v => v === 'true').default('false'),
  COINGLASS_SCAN_INTERVAL_SECONDS: z.string().transform(v => parseInt(v, 10)).default('120'),
  COINGLASS_TOP_N: z.string().transform(v => parseInt(v, 10)).default('300'),
  VOLUME_SPIKE_MULTIPLIER: z.string().transform(v => parseFloat(v)).default('3'),
  COINGLASS_MAX_DAILY_CALLS: z.string().transform(v => parseInt(v, 10)).default('20000'),

  // --- Telegram ---
  TELEGRAM_BOT_TOKEN: z.string().default(''),
  TELEGRAM_ADMIN_IDS: z.string().default(''),
  TELEGRAM_CONFIRM_HIGH_IMPACT: z.string().transform(v => v === 'true').default('true'),

  // --- Logging ---
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  LOG_FORMAT: z.enum(['json', 'pretty']).default('pretty'),

  // --- Runtime ---
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
})

// ============================================================================
// Validate and parse
// ============================================================================

function loadConfig() {
  const result = envSchema.safeParse(process.env)

  if (!result.success) {
    console.error('\n❌ Mythos config validation FAILED:\n')
    const errors = result.error.flatten().fieldErrors
    for (const [field, messages] of Object.entries(errors)) {
      console.error(`  ${field}: ${messages?.join(', ')}`)
    }

    // Warn about optional Bybit keys in Phase 0
    console.error('\nNote: BYBIT_API_KEY and BYBIT_API_SECRET are optional in Phase 0')
    console.error('      Public Bybit endpoints are used for OHLCV data.\n')

    process.exit(1)
  }

  const cfg = result.data

  // Safety assertions — these should never be relaxed
  if (cfg.LIVE_TRADING && cfg.BYBIT_API_KEY === '') {
    console.error('❌ LIVE_TRADING=true requires BYBIT_API_KEY to be set')
    process.exit(1)
  }

  if (cfg.LIVE_TRADING && cfg.BYBIT_TESTNET) {
    console.warn('⚠️  WARNING: LIVE_TRADING=true but BYBIT_TESTNET=true — are you sure?')
  }

  if (cfg.EXECUTION_MODE === 'full_auto' && !cfg.LIVE_TRADING) {
    console.warn('⚠️  EXECUTION_MODE=full_auto but LIVE_TRADING=false — no live trades will occur')
  }

  if (cfg.NANSEN_ENABLED && cfg.NANSEN_API_KEY === '') {
    console.error('❌ NANSEN_ENABLED=true requires NANSEN_API_KEY to be set')
    process.exit(1)
  }

  return cfg
}

// ============================================================================
// Singleton export
// ============================================================================

export type Config = z.output<typeof envSchema>
export const config: Config = loadConfig()

// Derived helpers used throughout the codebase
export const isPhase0 = (): boolean => !config.LIVE_TRADING && !config.PAPER_TRADING
export const roundTripCostPct = (): number =>
  config.TAKER_FEE * 2 + config.SLIPPAGE * 2  // Simple round-trip estimate
export const feeViabilityThreshold = (): number =>
  config.FEE_VIABILITY_MULTIPLIER * roundTripCostPct()
