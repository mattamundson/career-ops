import { loadProjectEnv } from './load-env.mjs';

const JOB_REQUIREMENTS = {
  'gmail-sync': {
    required: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'],
    optional: ['GMAIL_RECRUITER_QUERY', 'GMAIL_RECRUITER_MAX'],
  },
  'cadence-alert': {
    required: [],
    optional: ['OPENCLAW_WHATSAPP_TO'],
    warnings: [
      {
        whenMissing: 'OPENCLAW_WHATSAPP_TO',
        message: 'OPENCLAW_WHATSAPP_TO is missing; cadence alerts will fall back to a local Windows dialog.',
      },
    ],
  },
  scanner: {
    required: [],
    optional: ['FIRECRAWL_API_KEY'],
    warnings: [
      {
        whenMissing: 'FIRECRAWL_API_KEY',
        message:
          'FIRECRAWL_API_KEY is missing; `job_board_queries` in portals.yml will be skipped (other scan sources still run).',
      },
    ],
  },
};

function checkKeys(keys = []) {
  return keys.filter((key) => !String(process.env[key] || '').trim());
}

export function getJobReadiness(rootDir, jobName) {
  loadProjectEnv(rootDir);
  const spec = JOB_REQUIREMENTS[jobName];
  if (!spec) {
    throw new Error(`Unknown automation job: ${jobName}`);
  }

  const missingRequired = checkKeys(spec.required);
  const missingOptional = checkKeys(spec.optional);
  const warnings = [...(spec.warnings || [])]
    .filter((entry) => missingOptional.includes(entry.whenMissing))
    .map((entry) => entry.message);

  return {
    job: jobName,
    ready: missingRequired.length === 0,
    missingRequired,
    missingOptional,
    warnings,
    checkedAt: new Date().toISOString(),
  };
}

export function printJobReadiness(readiness) {
  const status = readiness.ready ? 'READY' : 'BLOCKED';
  console.log(`[preflight] ${readiness.job}: ${status}`);
  if (readiness.missingRequired.length > 0) {
    console.log(`[preflight] Missing required env: ${readiness.missingRequired.join(', ')}`);
  }
  for (const warning of readiness.warnings) {
    console.log(`[preflight] Warning: ${warning}`);
  }
}

export function assertJobReady(rootDir, jobName) {
  const readiness = getJobReadiness(rootDir, jobName);
  printJobReadiness(readiness);
  if (!readiness.ready) {
    const error = new Error(
      `Preflight failed for ${jobName}: missing required env ${readiness.missingRequired.join(', ')}`
    );
    error.readiness = readiness;
    throw error;
  }
  return readiness;
}
