/**
 * Curated recognizable / first-party / widely known titles for the
 * "Popular Games" view and "Sort by most popular".
 *
 * This is NOT a scraped popularity score — it is an explicit allowlist of
 * English name needles matched against catalog `name` / `nameEn`.
 * Edit this list to curate; starred games in Settings always rank higher.
 */
export const CURATED_POPULAR_TITLE_NEEDLES: string[] = [
  'god of war',
  'spider-man',
  'horizon',
  'the last of us',
  'ghost of tsushima',
  'ghost of yotei',
  'bloodborne',
  "demon's souls",
  'returnal',
  'ratchet',
  'uncharted',
  'gran turismo',
  'astro bot',
  "astro's playroom",
  'helldivers',
  'final fantasy',
  'resident evil',
  'elden ring',
  'black myth',
  'stellar blade',
  'death stranding',
  'days gone',
  'infamous',
  'jak and daxter',
  'sackboy',
  'concrete genie',
  'destruction allstars',
  'mlb the show',
  'nba 2k',
  'ea sports fc',
  'fifa',
  'call of duty',
  'fortnite',
  'gta',
  'grand theft auto',
  'red dead',
  'witcher',
  'cyberpunk',
  'hogwarts',
  'batman',
  'mortal kombat',
  'tekken',
  'street fighter',
  'assassin',
  'far cry',
  'watch dogs',
  'tomb raider',
  'control',
  'hades',
  'it takes two',
  'overcooked',
  'minecraft',
  'roblox',
  'destiny',
  'warhammer',
  'diablo',
  'battlefield',
  'apex legends',
  'rocket league',
  'yakuza',
  'like a dragon',
  'disgaea',
  'hotline miami',
  "everybody's golf",
];

/** Known JP-only Extra titles → English display (curated, not scraped). */
export const JP_TITLE_ENGLISH_OVERRIDES: Array<{ match: RegExp; english: string }> = [
  { match: /みんなのGOLF|みんなのゴルフ/i, english: "Everybody's Golf Value Selection" },
  { match: /ゴッド[・\s\u3000]*オブ[・\s\u3000]*ウォー/, english: 'God of War PlayStationHits' },
  { match: /ホットライン[\s\u3000]*マイアミ/, english: 'Hotline Miami Collected Edition' },
  { match: /ツーポイントホスピタル/, english: 'Two Point Hospital Jumbo Edition' },
  { match: /龍が如く[７7]/, english: 'Yakuza: Like a Dragon' },
  { match: /魔界戦記ディスガイア6/, english: 'Disgaea 6' },
  { match: /深夜廻/, english: 'Yomawari: Midnight Shadows' },
  { match: /真[\s\u3000]*流行り神/, english: 'Shin Hayarigami 3' },
  { match: /英雄伝説[\s\u3000]*碧の軌跡/, english: 'The Legend of Heroes: Ao no Kiseki Kai' },
  { match: /英雄伝説[\s\u3000]*零の軌跡/, english: 'The Legend of Heroes: Zero no Kiseki Kai' },
  { match: /英雄伝説[\s\u3000]*閃の軌跡III/, english: 'The Legend of Heroes: Trails of Cold Steel III' },
  { match: /英雄伝説[\s\u3000]*閃の軌跡IV/, english: 'The Legend of Heroes: Trails of Cold Steel IV' },
  { match: /英雄伝説[\s\u3000]*閃の軌跡II/, english: 'The Legend of Heroes: Trails of Cold Steel II Kai' },
  { match: /英雄伝説[\s\u3000]*閃の軌跡I/, english: 'The Legend of Heroes: Trails of Cold Steel I Kai' },
  { match: /那由多の軌跡/, english: 'The Legend of Nayuta: Boundless Trails Kai' },
];

export function matchCuratedPopular(
  name: string,
  nameEn: string | null,
): string | null {
  const hay = `${name} ${nameEn ?? ''}`.toLowerCase();
  for (const needle of CURATED_POPULAR_TITLE_NEEDLES) {
    if (hay.includes(needle.toLowerCase())) return needle;
  }
  return null;
}

/** Prefer parenthetical Latin, then curated JP→EN overrides. */
export function englishDisplayFallback(name: string): string | null {
  const paren = name.match(/[（(]([^）)]*[A-Za-z][^）)]*)[）)]/);
  if (paren?.[1]) return paren[1].trim();
  for (const row of JP_TITLE_ENGLISH_OVERRIDES) {
    if (row.match.test(name)) return row.english;
  }
  return null;
}
