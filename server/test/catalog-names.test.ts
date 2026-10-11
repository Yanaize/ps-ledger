import { describe, expect, it } from 'vitest';
import { preferDisplayName } from '../src/services/catalogService.js';

describe('preferDisplayName', () => {
  it('prefers Latin over Japanese', () => {
    expect(preferDisplayName('龍が如く', 'Yakuza')).toBe('Yakuza');
    expect(preferDisplayName('Yakuza', '龍が如く')).toBe('Yakuza');
  });

  it('keeps English when both Latin', () => {
    expect(preferDisplayName('Spider-Man', 'Spider-Man 2')).toBe('Spider-Man');
  });
});
