/** Map the display names used in plugin indexes to BCP 47 tags for `dc:language`. */
const LANGS: Record<string, string> = {
  english: 'en',
  русский: 'ru',
  العربية: 'ar',
  arabic: 'ar',
  français: 'fr',
  español: 'es',
  türkçe: 'tr',
  turkish: 'tr',
  português: 'pt',
  'bahasa indonesia': 'id',
  '中文, 汉语, 漢語': 'zh',
  'tiếng việt': 'vi',
  日本語: 'ja',
  '조선말, 한국어': 'ko',
  ไทย: 'th',
  українська: 'uk',
  polski: 'pl',
  deutsch: 'de',
  italiano: 'it',
};

export function toLanguageTag(lang: string | undefined): string {
  if (!lang) return 'en';
  const key = lang.replace(/[‎‏]/g, '').trim().toLowerCase();
  if (LANGS[key]) return LANGS[key];
  if (/^[a-z]{2,3}(-[a-z0-9]+)*$/i.test(key)) return key;
  return 'en';
}
