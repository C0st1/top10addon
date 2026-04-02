import { logger } from '../logger.js';

interface WebhookPayload {
  title: string;
  message: string;
  titles: Array<{ title: string; rank: number; year: string | null }>;
  country: string;
  category: string;
  timestamp: string;
}

interface WebhookConfig {
  url: string;
  format: 'json' | 'slack' | 'teams';
  secret?: string;
}

/**
 * Send a notification to a webhook URL.
 */
export async function sendWebhook(config: WebhookConfig, payload: WebhookPayload): Promise<boolean> {
  try {
    let body: string;
    let contentType: string;

    switch (config.format) {
      case 'slack':
        body = JSON.stringify({
          text: `*${payload.title}*`,
          blocks: [
            {
              type: 'header',
              text: { type: 'plain_text', text: payload.title },
            },
            {
              type: 'section',
              text: { type: 'mrkdwn', text: `*Country:* ${payload.country}\n*Category:* ${payload.category}\n*Date:* ${payload.timestamp}` },
            },
            {
              type: 'section',
              fields: payload.titles.slice(0, 5).map(t => ({
                type: 'mrkdwn',
                text: `*#${t.rank}* ${t.title}${t.year ? ` (${t.year})` : ''}`,
              })),
            },
            ...(payload.titles.length > 5 ? [{
              type: 'context',
              elements: [{ type: 'mrkdwn', text: `_...and ${payload.titles.length - 5} more_` }],
            }] : []),
          ],
        });
        contentType = 'application/json';
        break;

      case 'teams':
        body = JSON.stringify({
          type: 'message',
          attachments: [{
            contentType: 'application/vnd.microsoft.card.adaptive',
            contentUrl: null,
            content: {
              type: 'AdaptiveCard',
              version: '1.4',
              body: [
                { type: 'TextBlock', text: payload.title, weight: 'Bolder', size: 'Large' },
                { type: 'TextBlock', text: `${payload.country} - ${payload.category}`, spacing: 'Small' },
                {
                  type: 'FactSet',
                  facts: payload.titles.slice(0, 5).map(t => ({
                    title: `#${t.rank}`,
                    value: `${t.title}${t.year ? ` (${t.year})` : ''}`,
                  })),
                },
              ],
            },
          }],
        });
        contentType = 'application/json';
        break;

      default: // json
        body = JSON.stringify(payload);
        contentType = 'application/json';
        break;
    }

    const headers: Record<string, string> = { 'Content-Type': contentType };
    if (config.secret) {
      headers['X-Webhook-Secret'] = config.secret;
    }

    const res = await fetch(config.url, {
      method: 'POST',
      headers,
      body,
    });

    if (!res.ok) {
      logger.error({ module: 'webhook', status: res.status, url: config.url }, 'Webhook delivery failed');
      return false;
    }

    logger.info({ module: 'webhook', url: config.url, format: config.format }, 'Webhook delivered');
    return true;
  } catch (err: any) {
    logger.error({ module: 'webhook', error: err.message }, 'Webhook error');
    return false;
  }
}

/**
 * Format top 10 data into a webhook payload.
 */
export function formatTop10Payload(
  titles: Array<{ title: string; year: string | null }>,
  country: string,
  category: string
): WebhookPayload {
  return {
    title: `Netflix Top 10 ${category} - ${country}`,
    message: `Current top 10 ${category.toLowerCase()} for ${country}`,
    titles: titles.map((t, i) => ({ title: t.title, rank: i + 1, year: t.year })),
    country,
    category,
    timestamp: new Date().toISOString(),
  };
}
