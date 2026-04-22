// parse-apply-url.mjs — Extract structured fields from ATS apply URLs.
//
// Deterministic parsing of Greenhouse / Lever / Ashby / Workday / iCIMS /
// SmartRecruiters / Workable URLs. Used by package-from-report.mjs to make
// portal routing deterministic, and by future scan enrichment passes to
// capture job IDs into report frontmatter.
//
//   import { parseApplyUrl } from './lib/parse-apply-url.mjs';
//   parseApplyUrl('https://www.pivotbio.com/job-description?gh_jid=8419914002')
//     → { portal: 'greenhouse', jobId: '8419914002', board: 'pivotbio', raw: '...' }
//
// Returns { portal, jobId, board, companySlug, raw }. All fields may be null
// if parsing fails (e.g., company career pages that don't encode a job ID).

const GREENHOUSE_EMBED = /[?&]gh_jid=(\d+)/i;
const GREENHOUSE_BOARD = /(?:boards|job-boards)\.greenhouse\.io\/([^\/?#]+)(?:\/jobs\/(\d+))?/i;
const LEVER_JOB = /jobs\.lever\.co\/([^\/?#]+)\/([a-f0-9-]{36})/i;
const LEVER_API = /api\.lever\.co\/v\d+\/postings\/([^\/?#]+)\/([a-f0-9-]{36})/i;
const ASHBY_JOB = /jobs\.ashbyhq\.com\/([^\/?#]+)(?:\/([a-f0-9-]{36}))?/i;
const WORKDAY = /([a-z0-9][a-z0-9-]*)\.myworkdayjobs\.com\/(?:[^\/]+\/)*([A-Z0-9_-]+)/i;
const ICIMS = /([a-z0-9-]+)\.icims\.com\/jobs\/(\d+)/i;
const SMARTRECRUITERS = /jobs\.smartrecruiters\.com\/([^\/?#]+)(?:\/([\d-]+))?/i;
const WORKABLE = /apply\.workable\.com\/([^\/?#]+)(?:\/j\/([A-F0-9]+))?/i;

export function parseApplyUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return { portal: null, jobId: null, board: null, companySlug: null, raw: '' };

  // Greenhouse embedded (company careers page with gh_jid query)
  const ghEmbed = raw.match(GREENHOUSE_EMBED);
  if (ghEmbed) {
    // Try to infer board from the company host if it's on a *.pivotbio.com-style domain
    const host = raw.match(/^https?:\/\/(?:www\.)?([^\/]+)/i)?.[1] || null;
    const companySlug = host ? host.split('.')[0] : null;
    return { portal: 'greenhouse', jobId: ghEmbed[1], board: companySlug, companySlug, raw };
  }

  // Greenhouse direct board
  const ghBoard = raw.match(GREENHOUSE_BOARD);
  if (ghBoard) {
    return { portal: 'greenhouse', jobId: ghBoard[2] || null, board: ghBoard[1], companySlug: ghBoard[1], raw };
  }

  // Lever
  const leverJob = raw.match(LEVER_JOB);
  if (leverJob) {
    return { portal: 'lever', jobId: leverJob[2], board: leverJob[1], companySlug: leverJob[1], raw };
  }
  const leverApi = raw.match(LEVER_API);
  if (leverApi) {
    return { portal: 'lever', jobId: leverApi[2], board: leverApi[1], companySlug: leverApi[1], raw };
  }

  // Ashby
  const ashby = raw.match(ASHBY_JOB);
  if (ashby) {
    return { portal: 'ashby', jobId: ashby[2] || null, board: ashby[1], companySlug: ashby[1], raw };
  }

  // Workday
  const workday = raw.match(WORKDAY);
  if (workday) {
    return { portal: 'workday', jobId: workday[2], board: workday[1], companySlug: workday[1], raw };
  }

  // iCIMS
  const icims = raw.match(ICIMS);
  if (icims) {
    return { portal: 'icims', jobId: icims[2], board: icims[1], companySlug: icims[1], raw };
  }

  // SmartRecruiters
  const sr = raw.match(SMARTRECRUITERS);
  if (sr) {
    return { portal: 'smartrecruiters', jobId: sr[2] || null, board: sr[1], companySlug: sr[1], raw };
  }

  // Workable
  const wk = raw.match(WORKABLE);
  if (wk) {
    return { portal: 'workable', jobId: wk[2] || null, board: wk[1], companySlug: wk[1], raw };
  }

  // Aggregators (not directly applyable)
  if (/linkedin\.com/i.test(raw)) return { portal: 'linkedin-proxy', jobId: null, board: null, companySlug: null, raw };
  if (/indeed\.com/i.test(raw)) return { portal: 'indeed-proxy', jobId: null, board: null, companySlug: null, raw };
  if (/builtin\.com/i.test(raw)) return { portal: 'builtin-proxy', jobId: null, board: null, companySlug: null, raw };

  // Email mailto:
  if (/^mailto:/i.test(raw)) return { portal: 'email', jobId: null, board: null, companySlug: null, raw };

  return { portal: 'universal', jobId: null, board: null, companySlug: null, raw };
}
