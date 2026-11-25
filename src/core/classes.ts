// WoW Forever's nine classes and their specs: the list a new poll offers, and the specs each class picks
// from. A poll's maker can change the list; a class this file doesn't know just has no spec buttons.

export const WOW_CLASSES = ['warrior', 'paladin', 'hunter', 'rogue', 'priest', 'shaman', 'mage', 'warlock', 'druid'];

const SPECS: Record<string, string[]> = {
  warrior: ['arms', 'fury', 'protection'],
  paladin: ['holy', 'protection', 'retribution'],
  hunter: ['beast mastery', 'marksmanship', 'survival'],
  rogue: ['assassination', 'combat', 'subtlety'],
  priest: ['discipline', 'holy', 'shadow'],
  shaman: ['elemental', 'enhancement', 'restoration'],
  mage: ['arcane', 'fire', 'frost'],
  warlock: ['affliction', 'demonology', 'destruction'],
  druid: ['balance', 'feral', 'restoration'],
};

export function specsFor(cls: string): string[] {
  return SPECS[cls] ?? [];
}

/** How many of these people play each of the poll's classes, most first, then in the poll's order. */
export function classCounts(people: { cls: string }[], classes: string[]): { cls: string; n: number }[] {
  const counts = new Map<string, number>();
  for (const p of people) if (classes.includes(p.cls)) counts.set(p.cls, (counts.get(p.cls) ?? 0) + 1);
  return classes
    .filter((c) => counts.has(c))
    .map((cls) => ({ cls, n: counts.get(cls)! }))
    .sort((a, b) => b.n - a.n);
}

/** "4 warriors", "1 mage". */
export function classCount(cls: string, n: number): string {
  return `${n} ${n === 1 ? cls : `${cls}s`}`;
}
