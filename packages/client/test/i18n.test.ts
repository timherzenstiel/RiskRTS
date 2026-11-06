import { describe, expect, it } from 'vitest';
import { t, tx, withLang } from '../src/i18n';
import { DE } from '../src/i18n/de';

describe('i18n', () => {
  it('fills, translates arguments, declines and capitalises', () => {
    DE['__T {0} attacks {1}!'] = '{0} greift {1:acc} an!';
    DE['__T Victory at {0}: taken from {1}.'] = 'Sieg bei {0}: {1:dat} abgenommen.';
    expect(t('__T {0} attacks {1}!', 'x', 'y')).toBe('__T x attacks y!');
    withLang('de', () => {
      expect(t('__T {0} attacks {1}!', 'the Ottoman Empire', 'France')).toBe('Das Osmanische Reich greift Frankreich an!');
      expect(tx('__T Victory at Germany: taken from the Ottoman Empire.')).toBe('Sieg bei Deutschland: dem Osmanischen Reich abgenommen.');
      expect(tx('untranslated thing')).toBe('untranslated thing');
    });
  });
});
