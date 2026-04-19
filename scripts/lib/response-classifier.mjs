/**
 * response-classifier.mjs — LLM-powered email response classification
 *
 * Uses Claude Haiku to classify recruiter email responses into categories.
 * Requires: ANTHROPIC_API_KEY in .env
 */

const CLASSIFICATIONS = {
  interview_invite: 'Scheduling a call, interview, or screen',
  rejection: 'Not moving forward, position filled, etc.',
  info_request: 'Asking for more info, availability, salary expectations',
  offer: 'Formal or verbal offer',
  follow_up: 'Recruiter following up on application',
  automated: 'Auto-acknowledgment, no action needed',
  unknown: 'Cannot classify',
};

const SUGGESTED_ACTIONS = {
  interview_invite: 'Schedule interview — check calendar and reply with availability',
  rejection: 'Archive — review rejection reason for pattern analysis',
  info_request: 'Reply within 24h with requested information',
  offer: 'Review offer terms — schedule decision deadline',
  follow_up: 'Reply within 24h — express continued interest',
  automated: 'No action — auto-acknowledgment only',
  unknown: 'Manual review needed',
};

/**
 * Classify a recruiter email response using Claude Haiku
 *
 * @param {string} emailSubject - Email subject line
 * @param {string} emailBody - Email body text
 * @param {object} applicationContext - { company, role, status, appliedDate }
 * @param {object} options - { apiKey?: string }
 * @returns {object} { classification, confidence, suggestedAction, reasoning }
 */
export async function classifyResponse(emailSubject, emailBody, applicationContext = {}, options = {}) {
  const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return {
      classification: 'unknown',
      confidence: 0,
      suggestedAction: SUGGESTED_ACTIONS.unknown,
      reasoning: 'ANTHROPIC_API_KEY not configured',
      error: 'no-api-key',
    };
  }

  const prompt = `Classify this recruiter email response into exactly one category.

Categories:
- interview_invite: Scheduling a call, interview, phone screen, or meeting
- rejection: Not moving forward, position filled, not a fit, regret to inform
- info_request: Asking for more information, availability, salary expectations, portfolio
- offer: Formal or verbal job offer, compensation details
- follow_up: Recruiter checking in, following up on status
- automated: Auto-reply, acknowledgment, confirmation of receipt, no-reply

Application Context:
- Company: ${applicationContext.company || 'Unknown'}
- Role: ${applicationContext.role || 'Unknown'}
- Current Status: ${applicationContext.status || 'Unknown'}
- Applied: ${applicationContext.appliedDate || 'Unknown'}

Email Subject: ${emailSubject}

Email Body:
${emailBody.slice(0, 2000)}

Respond with ONLY a JSON object (no markdown, no explanation):
{"classification":"<category>","confidence":<0-1>,"reasoning":"<brief reason>"}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${err}`);
    }

    const data = await response.json();
    const text = data.content[0]?.text || '';

    // Parse JSON response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON in response');
    }

    const result = JSON.parse(jsonMatch[0]);
    const classification = result.classification || 'unknown';

    return {
      classification,
      confidence: Math.min(1, Math.max(0, result.confidence || 0.5)),
      suggestedAction: SUGGESTED_ACTIONS[classification] || SUGGESTED_ACTIONS.unknown,
      reasoning: result.reasoning || '',
    };
  } catch (err) {
    return {
      classification: 'unknown',
      confidence: 0,
      suggestedAction: SUGGESTED_ACTIONS.unknown,
      reasoning: `Classification error: ${err.message}`,
      error: err.message,
    };
  }
}

/**
 * Batch classify multiple responses
 */
export async function classifyResponses(responses, options = {}) {
  const results = [];
  for (const resp of responses) {
    const result = await classifyResponse(
      resp.subject || '',
      resp.body || '',
      resp.context || {},
      options,
    );
    results.push({ ...resp, ...result });

    // Rate limit: 500ms between requests
    await new Promise(r => setTimeout(r, 500));
  }
  return results;
}
