import { z } from "zod";
import { readTable, wholeNumber } from "./csv.ts";

// The client tables a build's class spells are read from.
export type ClassSpellTable =
  | "ChrRaces"
  | "CharBaseInfo"
  | "SkillLine"
  | "SkillRaceClassInfo"
  | "SkillLineAbility"
  | "SpellName"
  | "Spell"
  | "SpellLevels"
  | "SpellMisc"
  | "SpellEffect"
  | "Talent";

// A spell a class learns as it levels: mostly from its trainer, some from class quests.
export interface ClassSpell {
  readonly spellId: number;
  readonly classId: number;
  readonly level: number;
  readonly name: string;
  // Undefined for a spell with no ranks.
  readonly rank: number | undefined;
  // The races that learn it; empty when every race of the class does.
  readonly races: readonly string[];
}

const skillLineRow = z.object({ ID: wholeNumber, CategoryID: wholeNumber, Flags: wholeNumber });

// SkillLine's category for class skill lines, and its flag for a class's specialisation lines,
// such as a warrior's Arms or a mage's Fire. Other class lines hold pet skills (a hunter's Beast
// Training) or nothing a player trains.
const classSkillCategory = 7;
const specialisationLine = 0x400;

const skillRaceClassInfoRow = z.object({ SkillID: wholeNumber, ClassMask: wholeNumber });

const skillLineAbilityRow = z.object({
  SkillLine: wholeNumber,
  Spell: wholeNumber,
  ClassMask: wholeNumber,
  AcquireMethod: wholeNumber,
  RaceMasks_0: wholeNumber,
});

const spellNameRow = z.object({ ID: wholeNumber, Name_lang: z.string() });

const spellRow = z.object({ ID: wholeNumber, NameSubtext_lang: z.string() });

const spellLevelsRow = z.object({
  SpellID: wholeNumber,
  DifficultyID: wholeNumber,
  BaseLevel: wholeNumber,
  SpellLevel: wholeNumber,
});

const spellMiscRow = z.object({
  SpellID: wholeNumber,
  DifficultyID: wholeNumber,
  Attributes_0: wholeNumber,
});

// The first attributes flag that keeps a spell out of the spellbook, like a stance's hidden passive.
const hiddenFromSpellbook = 0x80;

const spellEffectRow = z.object({ SpellID: wholeNumber, EffectTriggerSpell: wholeNumber });

const talentRow = z.object({
  SpellRank_0: wholeNumber,
  SpellRank_1: wholeNumber,
  SpellRank_2: wholeNumber,
  SpellRank_3: wholeNumber,
  SpellRank_4: wholeNumber,
  SpellRank_5: wholeNumber,
  SpellRank_6: wholeNumber,
  SpellRank_7: wholeNumber,
  SpellRank_8: wholeNumber,
});

const chrRacesRow = z.object({
  ID: wholeNumber,
  Name_lang: z.string(),
  PlayableRaceBit: wholeNumber,
});

const charBaseInfoRow = z.object({ RaceID: wholeNumber, ClassID: wholeNumber });

// SkillLineAbility's AcquireMethod for a spell learned as the class levels. The others are learned
// some other way: 2 automatically with the skill line (a class's starting spells), 3 as part of
// another spell.
const learnedByLevelling = 0;

interface Race {
  readonly id: number;
  readonly name: string;
}

// The races in a race mask, in the game's order. 0 and -1 mean every race.
function racesIn(raceMask: number, racesByBit: ReadonlyMap<number, Race>): Race[] {
  if (raceMask === 0 || raceMask === -1) {
    return [];
  }
  // As an unsigned 32-bit mask, since the CSV holds it signed.
  const mask = raceMask >>> 0;
  return [...racesByBit]
    .toSorted(([a], [b]) => a - b)
    .filter(([bit]) => bit < 32 && ((mask >>> bit) & 1) === 1)
    .map(([, race]) => race);
}

// "Rank 3" under a spell's name. Other subtexts, such as "Summon", aren't ranks.
const rankSubtext = /^Rank (\d+)$/;

function rankOf(subtext: string | undefined): number | undefined {
  const rank = subtext === undefined ? undefined : rankSubtext.exec(subtext)?.[1];
  return rank === undefined ? undefined : Number.parseInt(rank, 10);
}

// A class mask has one bit per class: bit 0 is class 1 (Warrior), bit 1 class 2, and so on.
// Undefined when the mask covers more than one class, or none.
function onlyClass(classMask: number): number | undefined {
  const bit = Math.log2(classMask);
  return Number.isInteger(bit) ? bit + 1 : undefined;
}

function classBit(classId: number): number {
  return 1 << (classId - 1);
}

// Reads the spells each class learns as it levels from a build's client tables, as CSV.
export function parseClassSpells(tables: Readonly<Record<ClassSpellTable, string>>): ClassSpell[] {
  const specialisationLines = new Set(
    readTable("SkillLine", tables.SkillLine, skillLineRow)
      .filter(
        (line) => line.CategoryID === classSkillCategory && (line.Flags & specialisationLine) !== 0,
      )
      .map((line) => line.ID),
  );
  // The class each specialisation line belongs to. A line several classes share isn't a class's.
  const lineClasses = new Map<number, number>();
  for (const info of readTable(
    "SkillRaceClassInfo",
    tables.SkillRaceClassInfo,
    skillRaceClassInfoRow,
  )) {
    const classId = onlyClass(info.ClassMask);
    if (specialisationLines.has(info.SkillID) && classId !== undefined) {
      lineClasses.set(info.SkillID, classId);
    }
  }
  const names = new Map(
    readTable("SpellName", tables.SpellName, spellNameRow).map((row) => [row.ID, row.Name_lang]),
  );
  const subtexts = new Map(
    readTable("Spell", tables.Spell, spellRow).map((row) => [row.ID, row.NameSubtext_lang]),
  );
  // The level each spell is learned at: its base level, or where it has none, its spell level.
  // Rows for other difficulties are for dungeon versions.
  const levels = new Map(
    readTable("SpellLevels", tables.SpellLevels, spellLevelsRow)
      .filter((row) => row.DifficultyID === 0)
      .map((row) => [row.SpellID, row.BaseLevel > 0 ? row.BaseLevel : row.SpellLevel]),
  );
  const hidden = new Set(
    readTable("SpellMisc", tables.SpellMisc, spellMiscRow)
      .filter((row) => row.DifficultyID === 0 && (row.Attributes_0 & hiddenFromSpellbook) !== 0)
      .map((row) => row.SpellID),
  );
  // Every rank of every talent, which are learned with talent points, not by levelling.
  const talents = new Set(
    readTable("Talent", tables.Talent, talentRow).flatMap((talent) =>
      Object.values(talent).filter((spellId) => spellId !== 0),
    ),
  );
  // What talents trigger, such as a mage talent's Clearcasting proc.
  const talentEffects = new Set(
    readTable("SpellEffect", tables.SpellEffect, spellEffectRow)
      .filter((effect) => talents.has(effect.SpellID) && effect.EffectTriggerSpell !== 0)
      .map((effect) => effect.EffectTriggerSpell),
  );
  // By each playable race's bit in a race mask. Some races share a bit with an unplayable copy.
  const racesByBit = new Map<number, Race>();
  for (const race of readTable("ChrRaces", tables.ChrRaces, chrRacesRow)) {
    if (race.PlayableRaceBit >= 0 && !racesByBit.has(race.PlayableRaceBit)) {
      racesByBit.set(race.PlayableRaceBit, { id: race.ID, name: race.Name_lang });
    }
  }
  // Which races can be which class, as "race:class". The client's race masks also cover races
  // from later expansions, which aren't in Forever or can't be the class.
  const raceClasses = new Set(
    readTable("CharBaseInfo", tables.CharBaseInfo, charBaseInfoRow).map(
      (row) => `${String(row.RaceID)}:${String(row.ClassID)}`,
    ),
  );

  // By class, level, name and rank: the client lists a few spells more than once under different
  // IDs, sometimes one entry per race.
  const spells = new Map<string, ClassSpell>();
  for (const ability of readTable(
    "SkillLineAbility",
    tables.SkillLineAbility,
    skillLineAbilityRow,
  )) {
    const classId = lineClasses.get(ability.SkillLine);
    const name = names.get(ability.Spell);
    const level = levels.get(ability.Spell);
    if (
      classId === undefined ||
      name === undefined ||
      level === undefined ||
      level === 0 ||
      ability.AcquireMethod !== learnedByLevelling ||
      // 0 means no restriction beyond the line's class.
      (ability.ClassMask !== 0 && (ability.ClassMask & classBit(classId)) === 0) ||
      hidden.has(ability.Spell) ||
      talents.has(ability.Spell) ||
      talentEffects.has(ability.Spell) ||
      // A trap's effect is a second spell the trap casts; the trainer teaches the trap. A form's
      // "(Passive)" comes with the form.
      name.endsWith(" Effect") ||
      name.endsWith(" (Passive)")
    ) {
      continue;
    }
    const rank = rankOf(subtexts.get(ability.Spell));
    const races = racesIn(ability.RaceMasks_0, racesByBit)
      .filter((race) => raceClasses.has(`${String(race.id)}:${String(classId)}`))
      .map((race) => race.name);
    const key = [classId, level, name, rank ?? ""].join("|");
    const existing = spells.get(key);
    // A second entry for other races adds them, unless either entry is for every race.
    const allRaces =
      existing === undefined
        ? races
        : existing.races.length === 0 || races.length === 0
          ? []
          : [...new Set([...existing.races, ...races])];
    spells.set(key, {
      spellId: Math.min(ability.Spell, existing?.spellId ?? ability.Spell),
      classId,
      level,
      name,
      rank,
      races: allRaces,
    });
  }
  return [...spells.values()];
}
