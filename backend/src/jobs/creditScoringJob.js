import { recalculateAllScores } from '../services/creditScoringService.js';
import auditService from '../services/auditService.js';

/**
 * Credit-scoring job runner.
 *
 * Runner is intentionally decoupled from the scheduler so it can be invoked
 * manually (benchmarks, CLI, admin endpoint) without waiting for cron time.
 *
 * The job is batched + concurrency-limited inside recalculateAllScores to
 * keep POS response time unaffected (see perf-benchmark.js).
 */
export async function runCreditScoringJob({ logger, batchSize, concurrency } = {}) {
  const log = logger || console;
  const startedAt = Date.now();
  log.info?.('[creditScoringJob] starting');

  let result;
  try {
    result = await recalculateAllScores({
      batchSize: batchSize ?? Number(process.env.CREDIT_JOB_BATCH_SIZE) ?? 100,
      concurrency: concurrency ?? Number(process.env.CREDIT_JOB_CONCURRENCY) ?? 4,
    });
    const durationMs = Date.now() - startedAt;
    log.info?.(
      `[creditScoringJob] done: processed=${result.processed} updated=${result.updated} failed=${result.failed} durationMs=${durationMs}`
    );

    // Audit log — job run summary
    await auditService.log({
      action: 'credit_scoring:job_run',
      resource: 'customers',
      details: { ...result, durationMs },
    });

    return { ...result, durationMs };
  } catch (err) {
    log.error?.('[creditScoringJob] failed:', err);
    await auditService.log({
      action: 'credit_scoring:job_failed',
      resource: 'customers',
      details: { error: err.message },
    });
    throw err;
  }
}
