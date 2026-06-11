import fs from 'node:fs/promises'
import path from 'node:path'
import { supabase } from '../storage/supabaseClient.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('reporting')

export interface ReportOptions {
  runId: number
  outputPath?: string
}

export async function generateMarkdownReport(opts: ReportOptions): Promise<string | null> {
  log.info({ runId: opts.runId }, 'Generating markdown report for backtest run')

  // Fetch the run data
  const { data: runData, error: runError } = await supabase
    .from('strategy_runs')
    .select(`
      *,
      strategy:strategies(name, description, edge_thesis_markdown)
    `)
    .eq('id', opts.runId)
    .single()

  if (runError || !runData) {
    log.error({ error: runError, runId: opts.runId }, 'Failed to fetch run data')
    return null
  }

  const strategy = runData.strategy as any
  const metrics = runData.metrics as any
  const params = runData.parameters as any

  // Start building the markdown
  const md: string[] = []

  md.push(`# Strategy Run Report: ${strategy?.name || 'Unknown Strategy'}`)
  md.push(`**Run ID:** ${runData.id}`)
  md.push(`**Status:** ${runData.status.toUpperCase()}`)
  md.push(`**Time:** ${new Date(runData.created_at).toLocaleString()}`)
  md.push(`**Type:** ${runData.run_type}`)
  md.push('')

  // Edge Thesis (if available)
  if (strategy?.edge_thesis_markdown) {
    md.push('## Edge Thesis')
    md.push(strategy.edge_thesis_markdown)
    md.push('')
  }

  // Parameters
  md.push('## Parameters')
  md.push('```json')
  md.push(JSON.stringify(params, null, 2))
  md.push('```')
  md.push('')

  // Metrics
  md.push('## Performance Metrics')
  if (metrics) {
    md.push('| Metric | Value |')
    md.push('|---|---|')
    md.push(`| Total Return | ${((metrics.total_return_pct || 0) * 100).toFixed(2)}% |`)
    md.push(`| Sharpe Ratio | ${(metrics.sharpe_ratio || 0).toFixed(2)} |`)
    md.push(`| Max Drawdown | ${((metrics.max_drawdown_pct || 0) * 100).toFixed(2)}% |`)
    md.push(`| Win Rate | ${((metrics.win_rate || 0) * 100).toFixed(2)}% |`)
    md.push(`| Total Trades | ${metrics.total_trades || 0} |`)
    md.push(`| Profit Factor | ${(metrics.profit_factor || 0).toFixed(2)} |`)
  } else {
    md.push('No metrics available.')
  }
  md.push('')

  // Sub-engine results (WFO, Monte Carlo, Holdout)
  // Fetch from the specific tables if needed, or if stored in metrics JSON, extract them here.
  // Assuming they are logged in validation_results table:
  const { data: valData } = await supabase
    .from('validation_results')
    .select('*')
    .eq('run_id', opts.runId)
  
  if (valData && valData.length > 0) {
    md.push('## Validation Pipeline')
    for (const v of valData) {
      md.push(`### ${v.validation_type.toUpperCase()} - Verdict: **${v.verdict}**`)
      
      const vMetrics = v.metrics as any
      if (vMetrics) {
        md.push('```json')
        md.push(JSON.stringify(vMetrics, null, 2))
        md.push('```')
      }
      
      const reasons = v.reasons as string[]
      if (reasons && reasons.length > 0) {
        md.push('**Reasons:**')
        reasons.forEach(r => md.push(`- ${r}`))
      }
      md.push('')
    }
  }

  const finalContent = md.join('\n')

  if (opts.outputPath) {
    try {
      await fs.mkdir(path.dirname(opts.outputPath), { recursive: true })
      await fs.writeFile(opts.outputPath, finalContent, 'utf-8')
      log.info({ outputPath: opts.outputPath }, 'Report saved successfully')
    } catch (err) {
      log.error({ err, outputPath: opts.outputPath }, 'Failed to save markdown report')
    }
  }

  return finalContent
}
