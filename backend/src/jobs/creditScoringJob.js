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
export async function runCreditScoringJob({ logger, chunkSize, yieldMs } = {}) {
  const log = logger || console;
  const startedAt = Date.now();
  log.info?.('[creditScoringJob] starting');

  let result;
  try {
    result = await recalculateAllScores({
      chunkSize: chunkSize ?? Number(process.env.CREDIT_JOB_CHUNK_SIZE) ?? 500,
      yieldMs: yieldMs ?? Number(process.env.CREDIT_JOB_YIELD_MS) ?? 25,
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
