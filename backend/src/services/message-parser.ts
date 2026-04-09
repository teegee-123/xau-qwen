import { getConfig } from '../storage/json-store';

interface InitialSignal {
  matched: boolean;
  type: 'BUY';
  price: number;
  rawMessage: string;
}

interface EditedSignal {
  matched: boolean;
  type: 'BUY';
  entryMin: number;
  entryMax: number;
  sl: number;
  tp: number; // Lowest TP value
  rawMessage: string;
}

class MessageParser {
  // Default regex patterns (can be overridden by config)
  // STRICT: Only matches "Gold buy {price}" with optional whitespace, nothing else
  // ^ and $ anchors ensure the ENTIRE message is just the signal
  // \s* allows optional whitespace at start/end
  // (\d+(?:\.\d+)?) captures integer or decimal price
  private defaultInitialRegex = /^\s*Gold\s+buy\s+(\d+(?:\.\d+)?)\s*$/i;
  private defaultEditedRegex = /gold\s+buy\s+now/i;
  private defaultEntryRegex = /Buy\s*@\s*([\d.]+)\s*-\s*([\d.]+)/i;
  private defaultSLRegex = /SL[^\d]*?([\d.]+)/i;  // Matches SL{any-icon}number
  private defaultTPRegex = /TP[^\d]*?([\d.]+)/gi; // Matches TP{any-icon}number

  /**
   * Strip emojis, HTML tags, and Telegram custom emoji from text
   * Replaces icons with spaces to preserve word boundaries for regex matching
   */
  private stripIcons(text: string): string {
    return text
      // Remove HTML tags (including Telegram custom emoji tags like <tg-emoji>)
      .replace(/<[^>]+>/g, ' ')
      // Replace Unicode emoji ranges with spaces (preserves word boundaries)
      .replace(/[\u{1F600}-\u{1F64F}]/gu, ' ')  // Emoticons
      .replace(/[\u{1F300}-\u{1F5FF}]/gu, ' ')  // Misc Symbols and Pictographs
      .replace(/[\u{1F680}-\u{1F6FF}]/gu, ' ')  // Transport and Map
      .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, ' ')  // Flags
      .replace(/[\u{1F900}-\u{1F9FF}]/gu, ' ')  // Supplemental Symbols
      .replace(/[\u{2600}-\u{26FF}]/gu, ' ')    // Misc symbols
      .replace(/[\u{2700}-\u{27BF}]/gu, ' ')    // Dingbats
      .replace(/[\u{FE00}-\u{FE0F}]/gu, ' ')    // Variation Selectors
      .replace(/[\u{200D}]/gu, ' ')              // Zero-width joiner
      .replace(/[\u{1FA70}-\u{1FAFF}]/gu, ' ')  // Symbols Extended
      // Clean up extra whitespace (collapse multiple spaces into one)
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Get initial pattern from config or use default
   */
  private async getInitialRegex(): Promise<RegExp> {
    try {
      const config = await getConfig();
      if (config.messages?.initialPattern) {
        // Ensure pattern has price capture group
        const pattern = config.messages.initialPattern;
        // If pattern doesn't have a capture group, add one for the price
        if (!pattern.includes('(')) {
          return new RegExp(pattern + '\\s+([\\d.]+)', 'i');
        }
        return new RegExp(pattern, 'i');
      }
    } catch (error) {
      // Ignore config errors, use default
    }
    return this.defaultInitialRegex;
  }

  /**
   * Check if message should be ignored.
   * With strict regex, only messages that exactly match "Gold buy {price}" are accepted.
   * This function provides additional rejection for sell-only or non-gold messages.
   */
  shouldIgnore(text: string): boolean {
    // Ignore if contains sell and no buy
    const hasSell = text.toLowerCase().includes('sell');
    const hasBuy = text.toLowerCase().includes('buy');
    const hasGold = text.toLowerCase().includes('gold') || text.toLowerCase().includes('xau');

    console.log('[MessageParser] shouldIgnore - Text:', text.substring(0, 100));
    console.log('[MessageParser] shouldIgnore - hasSell:', hasSell, 'hasBuy:', hasBuy, 'hasGold:', hasGold);

    // Ignore sell-only messages
    if (hasSell && !hasBuy) {
      console.log('[MessageParser] shouldIgnore - Result: true (sell only)');
      return true;
    }
    // Ignore messages without gold/xau
    if (!hasGold) {
      console.log('[MessageParser] shouldIgnore - Result: true (no gold/xau)');
      return true;
    }

    console.log('[MessageParser] shouldIgnore - Result: false (may match)');
    return false;
  }

  // Parse initial buy signal
  async parseInitialMessage(text: string): Promise<InitialSignal | null> {
    const pattern = await this.getInitialRegex();
    console.log('[MessageParser] parseInitialMessage - Text:', text.substring(0, 100));
    console.log('[MessageParser] parseInitialMessage - Pattern:', pattern.toString());

    const match = text.match(pattern);
    console.log('[MessageParser] parseInitialMessage - Match result:', match ? match[0] : 'null');

    if (match) {
      const price = parseFloat(match[1]);
      console.log('[MessageParser] parseInitialMessage - Price:', price);

      if (!isNaN(price)) {
        return {
          matched: true,
          type: 'BUY',
          price,
          rawMessage: text
        };
      } else {
        console.log('[MessageParser] parseInitialMessage - Price is NaN');
      }
    }

    return null;
  }

  // Parse edited message with SL/TP details
  // Expected format:
  // GOLD BUY NOW
  //
  // Buy @ 4685 - 4681
  //
  // SL
  // 4500
  // TP
  // 4690
  // TP
  // 4777
  async parseEditedMessage(text: string): Promise<EditedSignal | null> {
    try {
      // Log raw text as received
      console.log('[MessageParser] parseEditedMessage - Raw text:', JSON.stringify(text.substring(0, 200)));

      // Check for "GOLD BUY NOW" header (case insensitive, allows icons between words)
      if (!this.defaultEditedRegex.test(text)) {
        console.log('[MessageParser] parseEditedMessage - No GOLD BUY NOW header found');
        return null;
      }

      // Extract entry range: "Buy @ 4685 - 4681"
      const entryMatch = text.match(this.defaultEntryRegex);
      if (!entryMatch) {
        console.log('[MessageParser] parseEditedMessage - No entry range matched');
        return null;
      }

      const entryMin = parseFloat(entryMatch[1]);
      const entryMax = parseFloat(entryMatch[2]);

      if (isNaN(entryMin) || isNaN(entryMax)) {
        return null;
      }

      // Extract SL - regex allows any non-digit chars between SL and number
      const slMatch = text.match(this.defaultSLRegex);
      if (!slMatch) {
        console.log('[MessageParser] parseEditedMessage - No SL matched');
        return null;
      }

      const sl = parseFloat(slMatch[1]);
      if (isNaN(sl)) {
        return null;
      }

      // Extract all TP values - regex allows any non-digit chars between TP and number
      const tpMatches = text.matchAll(this.defaultTPRegex);
      const tpValues: number[] = [];

      for (const tpMatch of tpMatches) {
        const tp = parseFloat(tpMatch[1]);
        if (!isNaN(tp)) {
          tpValues.push(tp);
        }
      }

      if (tpValues.length === 0) {
        return null;
      }

      // Use lowest TP value
      const lowestTP = Math.min(...tpValues);

      return {
        matched: true,
        type: 'BUY',
        entryMin,
        entryMax,
        sl,
        tp: lowestTP,
        rawMessage: text
      };
    } catch (error: any) {
      // Log parsing errors for debugging
      console.error('[MessageParser] Error parsing edited message:', error.message);
      console.error('[MessageParser] Raw message:', text.substring(0, 200));
      return null;
    }
  }
}

export const messageParser = new MessageParser();
