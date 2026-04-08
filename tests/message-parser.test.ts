import { messageParser } from '../backend/src/services/message-parser';

describe('Message Parser', () => {
  describe('parseInitialMessage', () => {
    it('should match exact "Gold buy {price}" pattern', async () => {
      const result = await messageParser.parseInitialMessage('Gold buy 4617');
      expect(result).not.toBeNull();
      expect(result?.price).toBe(4617);
      expect(result?.type).toBe('BUY');
    });

    it('should match case variations', async () => {
      const result1 = await messageParser.parseInitialMessage('GOLD BUY 4617');
      expect(result1).not.toBeNull();
      expect(result1?.price).toBe(4617);

      const result2 = await messageParser.parseInitialMessage('gold buy 4500');
      expect(result2).not.toBeNull();
      expect(result2?.price).toBe(4500);
    });

    it('should match any price number', async () => {
      const result1 = await messageParser.parseInitialMessage('Gold buy 4500');
      expect(result1?.price).toBe(4500);

      const result2 = await messageParser.parseInitialMessage('Gold buy 4700.50');
      expect(result2?.price).toBe(4700.50);
    });

    it('should reject sell signals', async () => {
      const result = await messageParser.parseInitialMessage('Gold sell 4617');
      expect(result).toBeNull();
    });

    it('should reject non-gold messages', async () => {
      const result = await messageParser.parseInitialMessage('Silver buy 123');
      expect(result).toBeNull();
    });

    it('should reject messages without price', async () => {
      const result = await messageParser.parseInitialMessage('Gold buy');
      expect(result).toBeNull();
    });
  });

  describe('parseEditedMessage', () => {
    const validEditedMessage = `GOLD BUY NOW

Buy @ 4685 - 4681

SL
4500
TP
4690
TP
4777`;

    it('should match valid edited message', async () => {
      const result = await messageParser.parseEditedMessage(validEditedMessage);
      expect(result).not.toBeNull();
      expect(result?.entryMin).toBe(4685);
      expect(result?.entryMax).toBe(4681);
      expect(result?.sl).toBe(4500);
      expect(result?.tp).toBe(4690); // Lowest TP
    });

    it('should use lowest TP when multiple TPs exist', async () => {
      const message = `GOLD BUY NOW

Buy @ 4685 - 4681

SL
4500
TP
4777
TP
4690
TP
4700`;

      const result = await messageParser.parseEditedMessage(message);
      expect(result?.tp).toBe(4690);
    });

    it('should reject message without GOLD BUY NOW header', async () => {
      const message = `Buy @ 4685 - 4681

SL
4500
TP
4690`;

      const result = await messageParser.parseEditedMessage(message);
      expect(result).toBeNull();
    });

    it('should reject message without entry range', async () => {
      const message = `GOLD BUY NOW

SL
4500
TP
4690`;

      const result = await messageParser.parseEditedMessage(message);
      expect(result).toBeNull();
    });

    it('should reject message without SL', async () => {
      const message = `GOLD BUY NOW

Buy @ 4685 - 4681

TP
4690`;

      const result = await messageParser.parseEditedMessage(message);
      expect(result).toBeNull();
    });

    it('should reject message without TP', async () => {
      const message = `GOLD BUY NOW

Buy @ 4685 - 4681

SL
4500`;

      const result = await messageParser.parseEditedMessage(message);
      expect(result).toBeNull();
    });

    it('should handle case variations in header', async () => {
      const message1 = await messageParser.parseEditedMessage('gold buy now\n\nBuy @ 4685 - 4681\n\nSL\n4500\nTP\n4690');
      expect(message1).not.toBeNull();

      const message2 = await messageParser.parseEditedMessage('Gold Buy Now\n\nBuy @ 4685 - 4681\n\nSL\n4500\nTP\n4690');
      expect(message2).not.toBeNull();
    });
  });

  describe('shouldIgnore', () => {
    it('should ignore sell messages', async () => {
      expect(messageParser.shouldIgnore('Gold sell 4617')).toBe(true);
      expect(messageParser.shouldIgnore('GOLD SELL NOW')).toBe(true);
    });

    it('should ignore non-gold messages', async () => {
      expect(messageParser.shouldIgnore('Silver buy 123')).toBe(true);
      expect(messageParser.shouldIgnore('EURUSD buy 1.1234')).toBe(true);
    });

    it('should not ignore valid gold buy messages', async () => {
      expect(messageParser.shouldIgnore('Gold buy 4617')).toBe(false);
      expect(messageParser.shouldIgnore('GOLD BUY NOW')).toBe(false);
    });
  });
});
