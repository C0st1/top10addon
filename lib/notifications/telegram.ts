import { logger } from '../logger.js';

interface TelegramMessage {
  chat_id: number;
  text: string;
  parse_mode?: 'HTML' | 'Markdown';
  disable_web_page_preview?: boolean;
}

interface TelegramSubscription {
  chatId: number;
  countries: string[];
  types: string[]; // ['movie', 'series']
  language: string;
  active: boolean;
}

export class TelegramBot {
  private token: string | null = null;
  private webhookUrl: string | null = null;
  private subscriptions: Map<number, TelegramSubscription> = new Map();

  /**
   * Initialize the bot with a token.
   */
  initialize(token: string, webhookUrl?: string): void {
    this.token = token;
    this.webhookUrl = webhookUrl || null;
    logger.info({ module: 'telegram' }, 'Telegram bot initialized');
  }

  /**
   * Check if the bot is configured.
   */
  isConfigured(): boolean {
    return !!this.token;
  }

  /**
   * Send a message to a chat.
   */
  async sendMessage(chatId: number, text: string, parseMode: 'HTML' | 'Markdown' = 'HTML'): Promise<boolean> {
    if (!this.token) {
      logger.warn({ module: 'telegram' }, 'Cannot send message: bot not initialized');
      return false;
    }
    try {
      const url = `https://api.telegram.org/bot${this.token}/sendMessage`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: parseMode,
          disable_web_page_preview: true,
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        logger.error({ module: 'telegram', status: res.status, error: err }, 'Telegram API error');
        return false;
      }
      return true;
    } catch (err: any) {
      logger.error({ module: 'telegram', error: err.message }, 'Failed to send Telegram message');
      return false;
    }
  }

  /**
   * Format top 10 titles as an HTML message for Telegram.
   */
  formatTop10Message(titles: Array<{title: string, year: string | null}>, category: string, country: string): string {
    const header = `<b>Netflix Top 10 ${category}</b>\n<b>Country:</b> ${country}\n<b>Date:</b> ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}\n`;
    
    if (titles.length === 0) {
      return `${header}\n\n<i>No titles available at this time.</i>`;
    }

    const list = titles.map((t, i) => 
      `<b>${i + 1}.</b> ${this.escapeHtml(t.title)}${t.year ? ` (${t.year})` : ''}`
    ).join('\n');

    return `${header}\n\n${list}`;
  }

  /**
   * Handle incoming Telegram update (for bot commands).
   */
  async handleUpdate(update: any): Promise<void> {
    if (!update.message || !update.message.text) return;
    
    const chatId = update.message.chat.id;
    const text = update.message.text;
    
    logger.info({ module: 'telegram', chatId, text }, 'Received Telegram message');

    if (text.startsWith('/start')) {
      await this.sendMessage(chatId,
        '<b>Netflix Top 10 Bot</b>\n\n' +
        'I deliver daily Netflix Top 10 rankings right to your chat!\n\n' +
        '<b>Commands:</b>\n' +
        '/subscribe <country> - Subscribe to daily updates\n' +
        '/top10 <country> - Get current top 10\n' +
        '/countries - List available countries\n' +
        '/unsubscribe - Stop receiving updates\n' +
        '/help - Show this help message'
      );
    } else if (text.startsWith('/help')) {
      await this.sendMessage(chatId,
        '<b>Netflix Top 10 Bot Help</b>\n\n' +
        '/subscribe <country> - Get daily updates for a country\n' +
        '  Example: /subscribe US\n' +
        '  Use "Global" for worldwide rankings\n\n' +
        '/top10 <country> [movies|tv] - View current rankings\n' +
        '  Example: /top10 Japan movies\n\n' +
        '/countries - Show all supported countries\n\n' +
        '/unsubscribe - Stop all notifications\n\n' +
        '<i>Tips: Use country codes or full names. Default type is "movies".</i>'
      );
    } else if (text.startsWith('/countries')) {
      // Import countries list and format them
      const { FLIXPATROL_COUNTRIES } = await import('../constants.js');
      const grouped: Record<string, string[]> = {};
      FLIXPATROL_COUNTRIES.forEach(c => {
        const letter = c[0].toUpperCase();
        if (!grouped[letter]) grouped[letter] = [];
        grouped[letter].push(c);
      });
      const list = Object.entries(grouped)
        .map(([letter, countries]) => 
          `<b>${letter}</b>\n${countries.join(', ')}`
        ).join('\n\n');
      await this.sendMessage(chatId,
        `<b>Available Countries (${FLIXPATROL_COUNTRIES.length}):</b>\n\n${list}`
      );
    } else if (text.startsWith('/top10')) {
      // Parse: /top10 [country] [movies|tv]
      const parts = text.split(/\s+/);
      const country = parts[1] || 'Global';
      const type = parts[2] === 'tv' ? 'TV Shows' : 'Films';
      
      try {
        const { fetchFlixPatrolTitles } = await import('../scraper.js');
        const titles = await fetchFlixPatrolTitles(type, country);
        const message = this.formatTop10Message(titles, type, country);
        await this.sendMessage(chatId, message);
      } catch (err: any) {
        await this.sendMessage(chatId, `<i>Failed to fetch top 10 for ${country}. Please try again later.</i>`);
      }
    } else if (text.startsWith('/subscribe')) {
      const country = text.split(/\s+/)[1] || 'Global';
      this.subscriptions.set(chatId, {
        chatId,
        countries: [country],
        types: ['movie', 'series'],
        language: 'en',
        active: true,
      });
      await this.sendMessage(chatId,
        `<b>Subscribed!</b>\n\nYou will receive daily updates for: <b>${country}</b>\n\n` +
        `To change your country, just send /subscribe again.\nTo stop, send /unsubscribe.`
      );
    } else if (text.startsWith('/unsubscribe')) {
      this.subscriptions.delete(chatId);
      await this.sendMessage(chatId, '<b>Unsubscribed.</b>\n\nYou will no longer receive daily updates.');
    }
  }

  /**
   * Process a webhook update from Telegram.
   * Returns true if the update was handled.
   */
  async processWebhook(body: any): Promise<boolean> {
    if (!body || !body.update_id) return false;
    await this.handleUpdate(body);
    return true;
  }

  /**
   * Get all active subscriptions (for cron job to iterate).
   */
  getActiveSubscriptions(): TelegramSubscription[] {
    return Array.from(this.subscriptions.values()).filter(s => s.active);
  }

  /**
   * Set webhook URL for the bot.
   */
  async setWebhook(url: string): Promise<boolean> {
    if (!this.token) return false;
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.token}/setWebhook?url=${encodeURIComponent(url)}`, {
        method: 'POST',
      });
      return res.ok;
    } catch (err: any) {
      logger.error({ module: 'telegram', error: err.message }, 'Failed to set webhook');
      return false;
    }
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}

// Singleton instance
export const telegramBot = new TelegramBot();
