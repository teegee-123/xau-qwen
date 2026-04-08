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
  private defaultInitialRegex = /Gold\s+buy\s+([\d.]+)/i;
  private defaultEditedRegex = /gold\s+buy\s+now/i;
  private defaultEntryRegex = /Buy\s*@\s*([\d.]+)\s*-\s*([\d.]+)/i;
  private defaultSLRegex = /SL\s*[\n:\s]*([\d.]+)/i;  // * instead of + to handle "SL 4780" format
  private defaultTPRegex = /TP\s*[\n:\s]*([\d.]+)/gi; // * instead of + to handle "TP 4820" format

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
   * Check if message should be ignored
   */
  shouldIgnore(text: string): boolean {
    // Ignore if contains sell (but not if it also contains buy)
    const hasSell = text.toLowerCase().includes('sell');
    const hasBuy = text.toLowerCase().includes('buy');
    const hasGold = text.toLowerCase().includes('gold') || text.toLowerCase().includes('xau');

    const shouldIgnore = (hasSell && !hasBuy) || !hasGold;
    
    console.log('[MessageParser] shouldIgnore - Text:', text.substring(0, 100));
    console.log('[MessageParser] shouldIgnore - hasSell:', hasSell, 'hasBuy:', hasBuy, 'hasGold:', hasGold);
    console.log('[MessageParser] shouldIgnore - Result:', shouldIgnore);

    // Only ignore if it has sell but no buy, or no gold/xau at all
    if (hasSell && !hasBuy) {
      return true;
    }
    if (!hasGold) {
      return true;
    }

    return false;
  }

  // Parse initial buy signal
  async parseInitialMessage(text: string): Promise<InitialSignal | null> {
    const pattern = await this.getInitialRegex();

    // Strip emojis and HTML
    const cleanedText = this.stripIcons(text);
    console.log('[MessageParser] parseInitialMessage - Cleaned text:', cleanedText.substring(0, 100));
    console.log('[MessageParser] parseInitialMessage - Pattern:', pattern.toString());

    const match = cleanedText.match(pattern);
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

      // Strip emojis and HTML
      const cleanedText = this.stripIcons(text);
      console.log('[MessageParser] parseEditedMessage - Cleaned text:', JSON.stringify(cleanedText.substring(0, 200)));

      // Check for "GOLD BUY NOW" header (case insensitive)
      if (!this.defaultEditedRegex.test(cleanedText)) {
        console.log('[MessageParser] parseEditedMessage - No GOLD BUY NOW header found');
        return null;
      }

      // Extract entry range: "Buy @ 4685 - 4681"
      const entryMatch = cleanedText.match(this.defaultEntryRegex);
      if (!entryMatch) {
        console.log('[MessageParser] parseEditedMessage - No entry range matched');
        return null;
      }

      const entryMin = parseFloat(entryMatch[1]);
      const entryMax = parseFloat(entryMatch[2]);

      if (isNaN(entryMin) || isNaN(entryMax)) {
        return null;
      }

      // Extract SL - look for "SL" followed by number
      const slMatch = cleanedText.match(this.defaultSLRegex);
      if (!slMatch) {
        console.log('[MessageParser] parseEditedMessage - No SL matched');
        return null;
      }

      const sl = parseFloat(slMatch[1]);
      if (isNaN(sl)) {
        return null;
      }

      // Extract all TP values and use the LOWEST
      const tpMatches = cleanedText.matchAll(this.defaultTPRegex);
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
