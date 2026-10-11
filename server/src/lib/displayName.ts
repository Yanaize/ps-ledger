/** Prefer a Latin-script title over a Japanese/CJK store name. */
export function preferLatinTitle(
  current: string | null | undefined,
  candidate: string | null | undefined,
): string {
  const cur = (current ?? '').trim();
  const cand = (candidate ?? '').trim();
  if (!cand) return cur;
  if (!cur) return cand;
  const curLatin = hasLatin(cur);
  const candLatin = hasLatin(cand);
  if (candLatin && !curLatin) return cand;
  if (curLatin && !candLatin) return cur;
  return cur;
}

function hasLatin(s: string): boolean {
  return /[A-Za-z]/.test(s);
}
