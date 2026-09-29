import { describe, expect, it } from "vitest";
import { type ClassSpellTable, parseClassSpells } from "./class-spells.ts";
import { csv } from "./test-tables.ts";

type Rows = readonly (readonly (number | string)[])[];

// SkillLine's flag for a class's specialisation lines, such as Arms. Lines like a hunter's Beast
// Training (pet skills) don't have it.
const specialisation = 0x400;

// Made-up client tables with one warrior trainer spell: Made-up Strike (Rank 2), learned at level
// 10 on Arms, a warrior-only line. Humans, dwarves and night elves can be warriors; night elves
// can't be paladins. Pass rows to add to a table, after its header.
function tables(
  extra: Partial<Record<ClassSpellTable, Rows>> = {},
): Record<ClassSpellTable, string> {
  const table = (name: ClassSpellTable, header: readonly string[], rows: Rows): string =>
    csv([header, ...rows, ...(extra[name] ?? [])]);
  return {
    ChrRaces: table(
      "ChrRaces",
      ["ID", "Name_lang", "PlayableRaceBit"],
      [
        [1, "Human", 0],
        [3, "Dwarf", 2],
        [4, "Night Elf", 3],
      ],
    ),
    CharBaseInfo: table(
      "CharBaseInfo",
      ["ID", "RaceID", "ClassID"],
      [
        [1, 1, 1],
        [2, 3, 1],
        [3, 4, 1],
        [4, 1, 2],
        [5, 3, 2],
      ],
    ),
    SkillLine: table(
      "SkillLine",
      ["ID", "DisplayName_lang", "CategoryID", "Flags"],
      [[26, "Arms", 7, specialisation]],
    ),
    SkillRaceClassInfo: table("SkillRaceClassInfo", ["ID", "SkillID", "ClassMask"], [[1, 26, 1]]),
    SkillLineAbility: table(
      "SkillLineAbility",
      ["ID", "SkillLine", "Spell", "ClassMask", "AcquireMethod", "RaceMasks_0"],
      [[1, 26, 900_001, 1, 0, 0]],
    ),
    SpellName: table("SpellName", ["ID", "Name_lang"], [[900_001, "Made-up Strike"]]),
    Spell: table("Spell", ["ID", "NameSubtext_lang"], [[900_001, "Rank 2"]]),
    SpellLevels: table(
      "SpellLevels",
      ["ID", "DifficultyID", "BaseLevel", "SpellLevel", "SpellID"],
      [[1, 0, 10, 10, 900_001]],
    ),
    SpellMisc: table(
      "SpellMisc",
      ["ID", "Attributes_0", "DifficultyID", "SpellID"],
      [[1, 0, 0, 900_001]],
    ),
    SpellEffect: table("SpellEffect", ["ID", "SpellID", "EffectTriggerSpell"], [[1, 900_001, 0]]),
    Talent: table(
      "Talent",
      ["ID", ...Array.from({ length: 9 }, (_, rank) => `SpellRank_${String(rank)}`)],
      [],
    ),
  };
}

const madeUpStrike = {
  spellId: 900_001,
  classId: 1,
  level: 10,
  name: "Made-up Strike",
  rank: 2,
  races: [],
};

// Where the second spell is: Arms (warrior only), Fire (mage only), Companions (every class), or
// Beast Training (hunter only, but not a specialisation line).
type Line = "arms" | "fire" | "companions" | "beast training";

const lines: Record<Line, { readonly id: number; readonly classMask: number }> = {
  arms: { id: 26, classMask: 1 },
  fire: { id: 8, classMask: 128 },
  companions: { id: 778, classMask: 1535 },
  "beast training": { id: 261, classMask: 4 },
};

interface SpellChanges {
  readonly line?: Line;
  readonly name?: string;
  readonly subtext?: string;
  readonly baseLevel?: number;
  readonly spellLevel?: number;
  readonly abilityClassMask?: number;
  readonly acquireMethod?: number;
  readonly raceMask?: number;
  // SpellMisc's first attributes: 0x40 marks a passive, 0x80 hides a spell from the spellbook.
  readonly attributes?: number;
  readonly isTalent?: boolean;
  // A talent's effect triggers it, like a proc.
  readonly triggeredByTalent?: boolean;
}

// Rows for a second spell, Made-up Shout (Rank 1) at level 12 on Arms, with any changes.
function anotherSpell(changes: SpellChanges = {}): Partial<Record<ClassSpellTable, Rows>> {
  const id = 900_002;
  const line = lines[changes.line ?? "arms"];
  return {
    SkillLine: [
      [8, "Fire", 7, specialisation],
      [778, "Companions", 7, specialisation],
      [261, "Beast Training", 7, 146],
    ],
    SkillRaceClassInfo: [
      [2, 8, 128],
      [3, 778, 1535],
      [4, 261, 4],
    ],
    SkillLineAbility: [
      [
        2,
        line.id,
        id,
        changes.abilityClassMask ?? line.classMask,
        changes.acquireMethod ?? 0,
        changes.raceMask ?? 0,
      ],
    ],
    SpellName: [[id, changes.name ?? "Made-up Shout"]],
    Spell: [[id, changes.subtext ?? "Rank 1"]],
    SpellLevels: [[2, 0, changes.baseLevel ?? 12, changes.spellLevel ?? 12, id]],
    SpellMisc: [[2, changes.attributes ?? 0, 0, id]],
    Talent:
      changes.isTalent === true || changes.triggeredByTalent === true
        ? [[1, changes.isTalent === true ? id : 900_100, 0, 0, 0, 0, 0, 0, 0, 0]]
        : [],
    SpellEffect: changes.triggeredByTalent === true ? [[2, 900_100, id]] : [],
  };
}

describe("parseClassSpells", () => {
  it("reads a trainer spell's class, level, name and rank", () => {
    expect(parseClassSpells(tables())).toEqual([madeUpStrike]);
  });

  it("reads each class's spells", () => {
    expect(parseClassSpells(tables(anotherSpell({ line: "fire" })))).toEqual([
      madeUpStrike,
      { spellId: 900_002, classId: 8, level: 12, name: "Made-up Shout", rank: 1, races: [] },
    ]);
  });

  it("takes the spell's level when it has no base level", () => {
    const [, shout] = parseClassSpells(tables(anotherSpell({ baseLevel: 0, spellLevel: 16 })));

    expect(shout?.level).toBe(16);
  });

  it("keeps a spell with no class restriction of its own on a line only one class has", () => {
    const [, shout] = parseClassSpells(tables(anotherSpell({ abilityClassMask: 0 })));

    expect(shout?.name).toBe("Made-up Shout");
  });

  it.each<[string, SpellChanges]>([
    ["a talent", { isTalent: true }],
    ["a talent's effect, such as a proc", { triggeredByTalent: true }],
    ["a spell hidden from the spellbook", { attributes: 0x80 }],
    ["a spell every character starts with", { acquireMethod: 2 }],
    ["a spell another spell triggers", { acquireMethod: 3 }],
    ["a spell restricted to another class", { abilityClassMask: 128 }],
    ["a spell with no level", { baseLevel: 0, spellLevel: 0 }],
    ["a spell on a line every class has", { line: "companions" }],
    ["a pet skill, on a line that isn't a specialisation", { line: "beast training" }],
    ["a trap's effect, which isn't taught on its own", { name: "Made-up Trap Effect" }],
    [
      "a form's own passive, which comes with the form",
      { name: "Made-up Form (Passive)", attributes: 0x40 },
    ],
  ])("leaves out %s", (_kind, changes) => {
    expect(parseClassSpells(tables(anotherSpell(changes)))).toEqual([madeUpStrike]);
  });

  it.each([
    // Night Elf's bit is 3.
    [8, ["Night Elf"]],
    // Human's bit is 0 and Dwarf's 2.
    [5, ["Human", "Dwarf"]],
    // Every race.
    [-1, []],
  ])("names the races of a spell with the race mask %s", (raceMask, races) => {
    const [, shout] = parseClassSpells(tables(anotherSpell({ raceMask })));

    expect(shout?.races).toEqual(races);
  });

  it("names only the races that can be the spell's class", () => {
    // Humans, dwarves and night elves, but night elves can't be paladins.
    const paladinLine = {
      SkillLine: [[594, "Holy", 7, specialisation]],
      SkillRaceClassInfo: [[5, 594, 2]],
      SkillLineAbility: [[5, 594, 900_005, 2, 0, 13]],
      SpellName: [[900_005, "Made-up Light"]],
      Spell: [[900_005, "Rank 1"]],
      SpellLevels: [[5, 0, 14, 14, 900_005]],
      SpellMisc: [[5, 0, 0, 900_005]],
    };

    const [, light] = parseClassSpells(tables(paladinLine));

    expect(light?.races).toEqual(["Human", "Dwarf"]);
  });

  it("gives no rank to a spell whose subtext isn't one", () => {
    const [, shout] = parseClassSpells(tables(anotherSpell({ subtext: "Summon" })));

    expect(shout?.rank).toBeUndefined();
  });

  it("keeps one of two identical entries for the same class, level, name and rank", () => {
    const withCopy = tables({
      SkillLineAbility: [[3, 26, 900_003, 1, 0, 0]],
      SpellName: [[900_003, "Made-up Strike"]],
      Spell: [[900_003, "Rank 2"]],
      SpellLevels: [[3, 0, 10, 10, 900_003]],
      SpellMisc: [[3, 0, 0, 900_003]],
    });

    expect(parseClassSpells(withCopy)).toEqual([madeUpStrike]);
  });

  it("names the races of both when two race-only entries are the same spell", () => {
    // Made-up Prayer for humans (bit 0) and, as another entry, for dwarves (bit 2).
    const twoEntries = tables({
      SkillLineAbility: [
        [3, 26, 900_003, 1, 0, 1],
        [4, 26, 900_004, 1, 0, 4],
      ],
      SpellName: [
        [900_003, "Made-up Prayer"],
        [900_004, "Made-up Prayer"],
      ],
      Spell: [
        [900_003, "Rank 1"],
        [900_004, "Rank 1"],
      ],
      SpellLevels: [
        [3, 0, 10, 10, 900_003],
        [4, 0, 10, 10, 900_004],
      ],
      SpellMisc: [
        [3, 0, 0, 900_003],
        [4, 0, 0, 900_004],
      ],
    });

    const [, prayer] = parseClassSpells(twoEntries);

    expect(prayer).toEqual({
      spellId: 900_003,
      classId: 1,
      level: 10,
      name: "Made-up Prayer",
      rank: 1,
      races: ["Human", "Dwarf"],
    });
  });
});
