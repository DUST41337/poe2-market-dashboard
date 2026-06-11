import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_PATH = path.join(ROOT, "public", "data", "market.json");
const POE_NINJA = "https://poe.ninja";
const POE_TRADE = "https://www.pathofexile.com";
const TRADE_LINK_LIMIT = Number(process.env.TRADE_LINK_LIMIT ?? 5);
const TRADE_RETRY_MAX_WAIT_MS = Number(process.env.TRADE_RETRY_MAX_WAIT_MS ?? 15000);

const TRADE_STATS = {
  life: "explicit.stat_3299347043",
  mana: "explicit.stat_1050105434",
  totalElementalResistance: "pseudo.pseudo_total_elemental_resistance",
  movementSpeed: "explicit.stat_2250533757",
  spellLevel: "explicit.stat_124131830",
  attackLevel: "explicit.stat_3035140377",
  meleeLevel: "explicit.stat_9187492",
  projectileLevel: "explicit.stat_1202301673",
  spellDamage: "explicit.stat_2974417149",
  castSpeed: "explicit.stat_2891184298",
  attackSpeed: "explicit.stat_681332047",
  localAttackSpeed: "explicit.stat_210067635",
  flatPhysicalToAttacks: "explicit.stat_3032590688",
  flatFireToAttacks: "explicit.stat_1573130764",
  flatColdToAttacks: "explicit.stat_4067062424",
  flatLightningToAttacks: "explicit.stat_1754445556",
  physicalDamage: "explicit.stat_1509134228",
  elementalAttackDamage: "explicit.stat_387439868",
  accuracy: "explicit.stat_803737631",
  criticalDamage: "explicit.stat_3556824919",
  criticalChance: "explicit.stat_587431675",
  strength: "explicit.stat_4080418644",
  dexterity: "explicit.stat_3261801346",
  intelligence: "explicit.stat_328541901",
  energyShield: "explicit.stat_3489782002",
  armour: "explicit.stat_809229260",
  evasion: "explicit.stat_2144192055",
  spirit: "explicit.stat_3981240776",
};

function readVarint(buffer, offset) {
  let value = 0n;
  let shift = 0n;
  let position = offset;

  while (position < buffer.length) {
    const byte = buffer[position++];
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7n;
  }

  return [Number(value), position];
}

function skipField(buffer, offset, wireType) {
  if (wireType === 0) return readVarint(buffer, offset)[1];
  if (wireType === 1) return offset + 8;
  if (wireType === 2) {
    const [length, bodyOffset] = readVarint(buffer, offset);
    return bodyOffset + length;
  }
  if (wireType === 5) return offset + 4;
  throw new Error(`Unsupported protobuf wire type: ${wireType}`);
}

function readValue(buffer, offset, wireType) {
  if (wireType === 0) {
    const [value, end] = readVarint(buffer, offset);
    return { value, end };
  }

  if (wireType === 2) {
    const [length, bodyOffset] = readVarint(buffer, offset);
    const bytes = buffer.slice(bodyOffset, bodyOffset + length);
    return { bytes, length, text: bytes.toString("utf8"), end: bodyOffset + length };
  }

  if (wireType === 1) return { value: buffer.readDoubleLE(offset), end: offset + 8 };
  if (wireType === 5) return { value: buffer.readUInt32LE(offset), end: offset + 4 };
  throw new Error(`Unsupported protobuf wire type: ${wireType}`);
}

function scanFields(buffer, visitor) {
  let offset = 0;
  while (offset < buffer.length) {
    const [tag, tagEnd] = readVarint(buffer, offset);
    offset = tagEnd;
    const field = tag >> 3;
    const wireType = tag & 7;
    const valueOffset = offset;
    visitor(field, wireType, () => readValue(buffer, valueOffset, wireType));
    offset = skipField(buffer, valueOffset, wireType);
  }
}

function decodeSearchEnvelope(buffer) {
  let resultBytes;
  scanFields(buffer, (field, wireType, get) => {
    if (field === 1 && wireType === 2) resultBytes = get().bytes;
  });
  if (!resultBytes) throw new Error("Search response did not contain a result payload.");
  return decodeSearchResult(resultBytes);
}

function decodeSearchResult(buffer) {
  const result = { total: 0, dimensions: [], dictionaryRefs: [] };
  scanFields(buffer, (field, wireType, get) => {
    const value = get();
    if (field === 1 && wireType === 0) result.total = value.value;
    if (field === 2 && wireType === 2) result.dimensions.push(decodeDimension(value.bytes));
    if (field === 6 && wireType === 2) result.dictionaryRefs.push(decodeDictionaryRef(value.bytes));
  });
  return result;
}

function decodeDimension(buffer) {
  const dimension = { id: "", dictionaryId: "", counts: [] };
  scanFields(buffer, (field, wireType, get) => {
    const value = get();
    if (field === 1 && wireType === 2) dimension.id = value.text;
    if (field === 2 && wireType === 2) dimension.dictionaryId = value.text;
    if (field === 3 && wireType === 2) dimension.counts.push(decodeDimensionCount(value.bytes));
  });
  return dimension;
}

function decodeDimensionCount(buffer) {
  const count = { key: 0, count: 0 };
  scanFields(buffer, (field, wireType, get) => {
    const value = get();
    if (field === 1 && wireType === 0) count.key = value.value;
    if (field === 2 && wireType === 0) count.count = value.value;
  });
  return count;
}

function decodeDictionaryRef(buffer) {
  const ref = { id: "", hash: "" };
  scanFields(buffer, (field, wireType, get) => {
    const value = get();
    if (field === 1 && wireType === 2) ref.id = value.text;
    if (field === 2 && wireType === 2) ref.hash = value.text;
  });
  return ref;
}

function decodeDictionary(buffer) {
  const dictionary = { id: "", values: [], properties: [] };
  scanFields(buffer, (field, wireType, get) => {
    const value = get();
    if (field === 1 && wireType === 2) dictionary.id = value.text;
    if (field === 2 && wireType === 2) dictionary.values.push(value.text);
    if (field === 3 && wireType === 2) dictionary.properties.push(decodeDictionaryProperty(value.bytes));
  });
  return dictionary;
}

function decodeDictionaryProperty(buffer) {
  const property = { id: "", values: [] };
  scanFields(buffer, (field, wireType, get) => {
    const value = get();
    if (field === 1 && wireType === 2) property.id = value.text;
    if (field === 2 && wireType === 2) property.values.push(value.text);
  });
  return property;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { "user-agent": "poe2-market-dashboard/0.1" } });
  if (!response.ok) throw new Error(`Fetch failed ${response.status}: ${url}`);
  return response.json();
}

async function fetchBuffer(url) {
  const response = await fetch(url, { headers: { "user-agent": "poe2-market-dashboard/0.1" } });
  if (!response.ok) throw new Error(`Fetch failed ${response.status}: ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

function isNormalCurrentLeague(league) {
  if (!league.indexed) return false;
  if (league.hardcore) return false;
  if (/\b(Standard|Hardcore|HC|SSF|Ruthless|R )\b/i.test(league.name)) return false;
  if (/\(PL\d+\)/i.test(league.name)) return false;
  return true;
}

async function loadSearch(snapshot, params = {}) {
  const query = new URLSearchParams({ overview: snapshot.snapshotName, ...params });
  const result = decodeSearchEnvelope(
    await fetchBuffer(`${POE_NINJA}/poe2/api/builds/${snapshot.version}/search?${query.toString()}`),
  );
  const dictionaries = {};

  await Promise.all(
    result.dictionaryRefs.map(async (ref) => {
      dictionaries[ref.id] = decodeDictionary(await fetchBuffer(`${POE_NINJA}/poe2/api/builds/dictionary/${ref.hash}`));
    }),
  );

  return { ...result, dictionaries };
}

function rowsForDimension(searchData, dimensionId) {
  const dimension = searchData.dimensions.find((item) => item.id === dimensionId);
  if (!dimension) return [];
  const dictionary = searchData.dictionaries[dimension.dictionaryId];
  if (!dictionary) return [];
  const properties = new Map(dictionary.properties.map((property) => [property.id, property.values]));

  return dimension.counts
    .map((entry) => {
      const key = entry.key ?? 0;
      const props = {};
      for (const [id, values] of properties.entries()) props[id] = values[key] ?? "";
      return {
        key,
        name: dictionary.values[key] ?? "",
        count: entry.count,
        percentage: searchData.total ? (entry.count / searchData.total) * 100 : 0,
        props,
      };
    })
    .filter((entry) => entry.name)
    .sort((a, b) => b.count - a.count);
}

function rareRows(searchData) {
  return rowsForDimension(searchData, "items").filter((row) => row.props.color === "var(--item-rare)" || row.name.startsWith("Rare "));
}

function uniqueRows(searchData) {
  return rowsForDimension(searchData, "items")
    .filter((row) => {
      if (!row.name || row.name.startsWith("Rare ") || row.name.startsWith("Magic ")) return false;
      return row.props.color !== "var(--item-rare)" && row.props.color !== "var(--item-magic)";
    })
    .slice(0, 80);
}

function gemRows(searchData) {
  return rowsForDimension(searchData, "allskills").filter((row) => !isSupportGemRow(row)).slice(0, 120);
}

function isSupportGemRow(row) {
  const icon = row.props.icon ?? "";
  return /\/NewSupport\/|SupportGem|Lineage/i.test(icon);
}

function targetSlotWeight(name, type) {
  const label = `${name} ${type}`;
  if (/Amulet|Quarterstaff|Sceptre|Staff|Wand|Focus/i.test(label)) return 1;
  if (/Ring|Gloves|Body Armour/i.test(label)) return 0.92;
  if (/Boots|Belt|Helmet|Bow|Crossbow|Spear|Quiver|Shield/i.test(label)) return 0.72;
  if (/Jewel/i.test(label)) return 0.55;
  return 0.62;
}

function craftBudget(name, type) {
  const label = `${name} ${type}`;
  if (/Amulet|Quarterstaff|Sceptre|Staff|Wand|Focus|Body Armour/i.test(label)) return "5-20 div";
  if (/Jewel/i.test(label)) return "要確認";
  return "1-5 div";
}

function craftScope(name, type) {
  const label = `${name} ${type}`;
  if (/Amulet|Quarterstaff|Sceptre|Staff|Wand|Focus|Body Armour/i.test(label)) return "Omen tier";
  if (/Jewel/i.test(label)) return "Manual review";
  return "Essence/Omen";
}

function archetypeFor(className) {
  if (/Stormweaver|Chronomancer|Blood Mage|Lich|Oracle/i.test(className)) return "caster";
  if (/Deadeye|Witchhunter|Tactician|Gemling/i.test(className)) return "ranged";
  if (/Martial Artist|Titan|Smith|Warrior|Acolyte|Disciple/i.test(className)) return "attack";
  if (/Spirit Walker|Infernalist|Ritualist/i.test(className)) return "hybrid";
  return "hybrid";
}

function signatureFor(itemName, type, topClass) {
  const archetype = archetypeFor(topClass);
  const label = `${itemName} ${type}`;
  if (/Amulet/i.test(label)) {
    if (archetype === "caster") return ["+1 to Level of all Spell Skills", "+# to maximum Mana", "+#% to Critical Strike Chance"];
    if (archetype === "attack") return ["+1 to Level of all Attack Skills", "+# to Dexterity or Strength", "+#% to Global Critical Multiplier"];
    return ["+1 to Level of relevant Skills", "+# to Attributes", "+#% to Elemental Resistances"];
  }
  if (/Quarterstaff|Sceptre|Staff|Wand|Focus/i.test(label)) {
    if (archetype === "caster") return ["+2 to Level of all Spell Skills", "+#% increased Spell Damage", "+#% to Cast Speed"];
    return ["+#% increased Physical Damage", "+#% to Attack Speed", "Adds # to # Elemental Damage"];
  }
  if (/Ring/i.test(label)) return ["+# to maximum Life or Mana", "+#% to Elemental Resistances", "Damage, Accuracy, or Cast Speed suffix"];
  if (/Gloves/i.test(label)) return ["+#% to Attack or Cast Speed", "+# to maximum Life", "+#% to Elemental Resistances"];
  if (/Body Armour/i.test(label)) return ["+# to Armour/Evasion/Energy Shield", "+# to maximum Life", "+#% to Elemental or Chaos Resistance"];
  if (/Boots/i.test(label)) return ["+#% increased Movement Speed", "+# to maximum Life", "+#% to Elemental Resistances"];
  if (/Helmet/i.test(label)) return ["+# to maximum Life or Energy Shield", "+#% to Elemental Resistances", "reservation, attribute, or skill utility suffix"];
  if (/Belt/i.test(label)) return ["+# to maximum Life", "+#% to Elemental Resistances", "+# to Strength or Flask/Charm utility"];
  if (/Jewel/i.test(label)) return ["build-specific damage mod", "defensive or attribute mod", "corrupted or high-tier roll watch"];
  if (/Quiver/i.test(label)) return ["Adds # to # damage to attacks", "+#% to Attack Speed", "+# to Accuracy Rating"];
  return ["primary damage prefix", "life or defensive prefix", "resistance or speed suffix"];
}

function craftPlanFor(itemName, type) {
  const label = `${itemName} ${type}`;
  if (/Jewel/i.test(label)) return ["Filter by build-specific rolls", "Avoid generic low-tier rolls", "Price-check manually"];
  if (/Amulet|Quarterstaff|Sceptre|Staff|Wand|Focus/i.test(label)) return ["Essence start", "Omen-assisted refine", "Stop at 2-3 sellable key mods"];
  if (/Body Armour/i.test(label)) return ["Defence base first", "Essence or Regal into core defence", "Omen refine only if prefixes land"];
  return ["Good base + Essence", "Regal/Augment for missing suffix", "Omen refine if two key mods land"];
}

function riskFlagsFor(itemName, type) {
  const label = `${itemName} ${type}`;
  if (/Jewel/i.test(label)) return ["mod価値の判定が手動寄り", "似た低価格品が多い"];
  if (/Ring|Boots|Belt|Helmet/i.test(label)) return ["供給が多く価格競争になりやすい", "耐性だけの品は差別化しにくい"];
  if (/Amulet|Quarterstaff|Sceptre|Staff|Wand|Focus/i.test(label)) return ["高tier要求で失敗品が増えやすい", "完成条件を広げすぎると売れ残る"];
  return ["需要元ビルドの変化に注意"];
}

function statLine(label, target, why) {
  return { label, target, why };
}

function tradeFilter(id, min, label, tier = "商材") {
  return { id, min, label, tier };
}

function tierLine(label, tier, target, why) {
  return { label, tier, target, why };
}

function tradeCategoryFor(opportunity) {
  const label = `${opportunity.baseLabel} ${opportunity.slot}`;
  if (/Amulet|Talisman/i.test(label)) return "Accessory / Amulet";
  if (/Ring/i.test(label)) return "Accessory / Ring";
  if (/Belt/i.test(label)) return "Accessory / Belt";
  if (/Boots/i.test(label)) return "Armour / Boots";
  if (/Gloves/i.test(label)) return "Armour / Gloves";
  if (/Helmet/i.test(label)) return "Armour / Helmet";
  if (/Body Armour/i.test(label)) return "Armour / Body Armour";
  if (/Quiver/i.test(label)) return "Off-hand / Quiver";
  if (/Shield|Buckler|Focus/i.test(label)) return "Off-hand";
  if (/Jewel/i.test(label)) return "Jewel";
  if (/Bow|Crossbow|Quarterstaff|Sceptre|Staff|Wand|Spear|Mace/i.test(label)) return "Weapon";
  return opportunity.slot || "Item";
}

function tradeCategoryOptionFor(opportunity) {
  const label = `${opportunity.baseLabel} ${opportunity.slot}`;
  if (/Ring/i.test(label)) return "accessory.ring";
  if (/Amulet/i.test(label)) return "accessory.amulet";
  if (/Belt/i.test(label)) return "accessory.belt";
  if (/Talisman/i.test(label)) return "weapon.talisman";
  if (/Boots/i.test(label)) return "armour.boots";
  if (/Gloves/i.test(label)) return "armour.gloves";
  if (/Helmet/i.test(label)) return "armour.helmet";
  if (/Body Armour/i.test(label)) return "armour.chest";
  if (/Quiver/i.test(label)) return "armour.quiver";
  if (/Shield|Buckler/i.test(label)) return "armour.shield";
  if (/Focus/i.test(label)) return "armour.focus";
  if (/Jewel/i.test(label)) return "jewel";
  if (/Quarterstaff/i.test(label)) return "weapon.warstaff";
  if (/Sceptre/i.test(label)) return "weapon.sceptre";
  if (/Staff/i.test(label)) return "weapon.staff";
  if (/Wand/i.test(label)) return "weapon.wand";
  if (/Bow/i.test(label)) return "weapon.bow";
  if (/Crossbow/i.test(label)) return "weapon.crossbow";
  if (/Spear/i.test(label)) return "weapon.spear";
  if (/One Handed Mace/i.test(label)) return "weapon.onemace";
  if (/Two Handed Mace/i.test(label)) return "weapon.twomace";
  if (/Mace/i.test(label)) return "weapon.onemace";
  return null;
}

function tradeSearchConfigFor(opportunity) {
  const label = `${opportunity.baseLabel} ${opportunity.slot}`;
  const archetype = opportunity.archetype;
  const filters = [];
  let countMin = 2;

  if (/Ring/i.test(label)) {
    filters.push(
      tradeFilter(TRADE_STATS.flatPhysicalToAttacks, 9, "Flat physical to attacks 9+ avg", "T1-T2商材"),
      tradeFilter(TRADE_STATS.flatFireToAttacks, 18, "Flat fire to attacks 18+ avg", "T1-T2商材"),
      tradeFilter(TRADE_STATS.flatColdToAttacks, 16, "Flat cold to attacks 16+ avg", "T1-T2商材"),
      tradeFilter(TRADE_STATS.flatLightningToAttacks, 22, "Flat lightning to attacks 22+ avg", "T1-T2商材"),
      tradeFilter(TRADE_STATS.life, 80, "Life 80+", "T1-T2商材"),
      tradeFilter(TRADE_STATS.totalElementalResistance, 85, "Total elemental resistance 85+", "T1-T2商材"),
      tradeFilter(archetype === "caster" ? TRADE_STATS.castSpeed : TRADE_STATS.attackSpeed, 12, archetype === "caster" ? "Cast speed 12%+" : "Attack speed 12%+", "T1-T2商材"),
    );
    countMin = 2;
  } else if (/Boots/i.test(label)) {
    filters.push(
      tradeFilter(TRADE_STATS.movementSpeed, 30, "Movement speed 30%+", "T1-T2商材"),
      tradeFilter(TRADE_STATS.life, 80, "Life 80+", "T1-T2商材"),
      tradeFilter(TRADE_STATS.totalElementalResistance, 80, "Total elemental resistance 80+", "T1-T2商材"),
    );
  } else if (/Amulet|Talisman/i.test(label)) {
    filters.push(
      tradeFilter(archetype === "attack" ? TRADE_STATS.attackLevel : TRADE_STATS.spellLevel, 2, archetype === "attack" ? "+2 attack skills" : "+2 spell skills", "T1-T2商材"),
      tradeFilter(archetype === "attack" ? TRADE_STATS.meleeLevel : TRADE_STATS.projectileLevel, 1, archetype === "attack" ? "+1 melee skills" : "+1 projectile skills", "複合+3狙い"),
      tradeFilter(TRADE_STATS.criticalDamage, 35, "Critical damage 35%+", "T1-T2商材"),
      tradeFilter(archetype === "attack" ? TRADE_STATS.dexterity : TRADE_STATS.intelligence, 45, archetype === "attack" ? "Dexterity 45+" : "Intelligence 45+", "T1-T2商材"),
    );
  } else if (/Quarterstaff|Sceptre|Staff|Wand/i.test(label)) {
    if (archetype === "caster") {
      filters.push(
        tradeFilter(TRADE_STATS.spellLevel, 3, "+3 spell skills", "+3以上"),
        tradeFilter(TRADE_STATS.spellDamage, 100, "Spell damage 100%+", "T1-T2商材"),
        tradeFilter(TRADE_STATS.castSpeed, 14, "Cast speed 14%+", "T1-T2商材"),
      );
      countMin = 1;
    } else {
      filters.push(
        tradeFilter(TRADE_STATS.attackLevel, 3, "+3 attack skills", "+3以上"),
        tradeFilter(TRADE_STATS.physicalDamage, 120, "Physical damage 120%+", "T1-T2商材"),
        tradeFilter(TRADE_STATS.localAttackSpeed, 14, "Local attack speed 14%+", "T1-T2商材"),
        tradeFilter(TRADE_STATS.criticalChance, 60, "Critical chance 60%+", "T1-T2商材"),
      );
      countMin = 1;
    }
  } else if (/Focus/i.test(label)) {
    filters.push(
      tradeFilter(TRADE_STATS.spellLevel, 2, "+2 spell skills", "T1-T2商材"),
      tradeFilter(TRADE_STATS.spellDamage, 90, "Spell damage 90%+", "T1-T2商材"),
      tradeFilter(TRADE_STATS.energyShield, 90, "Energy Shield 90+", "T1-T2商材"),
      tradeFilter(TRADE_STATS.castSpeed, 12, "Cast speed 12%+", "T1-T2商材"),
    );
  } else if (/Gloves/i.test(label)) {
    filters.push(
      tradeFilter(archetype === "caster" ? TRADE_STATS.castSpeed : TRADE_STATS.attackSpeed, 12, archetype === "caster" ? "Cast speed 12%+" : "Attack speed 12%+", "T1-T2商材"),
      tradeFilter(TRADE_STATS.life, 80, "Life 80+", "T1-T2商材"),
      tradeFilter(TRADE_STATS.totalElementalResistance, 70, "Total elemental resistance 70+", "T1-T2商材"),
    );
  } else if (/Body Armour/i.test(label)) {
    filters.push(
      tradeFilter(TRADE_STATS.life, 100, "Life 100+", "T1-T2商材"),
      tradeFilter(TRADE_STATS.energyShield, 140, "Energy Shield 140+", "T1-T2商材"),
      tradeFilter(TRADE_STATS.armour, 300, "Armour 300+", "T1-T2商材"),
      tradeFilter(TRADE_STATS.evasion, 300, "Evasion 300+", "T1-T2商材"),
      tradeFilter(TRADE_STATS.totalElementalResistance, 70, "Total elemental resistance 70+", "T1-T2商材"),
    );
  } else if (/Helmet/i.test(label)) {
    filters.push(
      tradeFilter(TRADE_STATS.life, 80, "Life 80+", "T1-T2商材"),
      tradeFilter(TRADE_STATS.energyShield, 90, "Energy Shield 90+", "T1-T2商材"),
      tradeFilter(TRADE_STATS.totalElementalResistance, 75, "Total elemental resistance 75+", "T1-T2商材"),
      tradeFilter(TRADE_STATS.intelligence, 40, "Intelligence 40+", "T1-T2商材"),
    );
  } else if (/Belt/i.test(label)) {
    filters.push(
      tradeFilter(TRADE_STATS.life, 100, "Life 100+", "T1-T2商材"),
      tradeFilter(TRADE_STATS.totalElementalResistance, 85, "Total elemental resistance 85+", "T1-T2商材"),
      tradeFilter(TRADE_STATS.strength, 45, "Strength 45+", "T1-T2商材"),
    );
  } else if (/Jewel/i.test(label)) {
    filters.push(
      tradeFilter(TRADE_STATS.criticalDamage, 25, "Critical damage 25%+", "T1-T2商材"),
      tradeFilter(TRADE_STATS.attackSpeed, 8, "Attack speed 8%+", "T1-T2商材"),
      tradeFilter(TRADE_STATS.castSpeed, 8, "Cast speed 8%+", "T1-T2商材"),
    );
    countMin = 1;
  } else if (/Quiver/i.test(label)) {
    filters.push(
      tradeFilter(TRADE_STATS.flatPhysicalToAttacks, 9, "Flat physical to attacks 9+ avg", "T1-T2商材"),
      tradeFilter(TRADE_STATS.attackSpeed, 12, "Attack speed 12%+", "T1-T2商材"),
      tradeFilter(TRADE_STATS.accuracy, 180, "Accuracy 180+", "T1-T2商材"),
      tradeFilter(TRADE_STATS.criticalChance, 45, "Critical chance 45%+", "T1-T2商材"),
    );
  } else {
    filters.push(
      tradeFilter(TRADE_STATS.life, 80, "Life 80+", "T1-T2商材"),
      tradeFilter(TRADE_STATS.totalElementalResistance, 75, "Total elemental resistance 75+", "T1-T2商材"),
      tradeFilter(TRADE_STATS.attackSpeed, 12, "Attack speed 12%+", "T1-T2商材"),
      tradeFilter(TRADE_STATS.castSpeed, 12, "Cast speed 12%+", "T1-T2商材"),
    );
  }

  const officialCategory = tradeCategoryOptionFor(opportunity);
  const uniqueFilters = filters.filter((filter, index, array) => filter.id && array.findIndex((item) => item.id === filter.id) === index);
  return {
    officialCategory,
    filters: uniqueFilters,
    countMin: Math.min(countMin, uniqueFilters.length),
  };
}

function minimumTargetsFor(opportunity) {
  const label = `${opportunity.baseLabel} ${opportunity.slot}`;
  const archetype = opportunity.archetype;

  if (/Boots/i.test(label)) {
    return [
      tierLine("Movement Speed", "T1狙い", "30%+", "25%は妥協検索。売り物は30%から見たい"),
      tierLine("Life / ES", "T1-T2", "Life 80+ or ES 90+", "移動速度だけの靴は供給に埋もれやすい"),
      tierLine("Total resists", "T1-T2合算", "80%+", "耐性が薄いなら他に速度以外の強みが必要"),
    ];
  }

  if (/Ring/i.test(label)) {
    return [
      tierLine("Flat damage to attacks", "T1-T2", "phys avg 9+ / fire 18+ / cold 16+ / lightning 22+", "攻撃向け指輪は高tierフラットが商材ライン"),
      tierLine("Life", "T1-T2", "80+", "Life 50台は自用品寄り。売るなら高tierと組み合わせ"),
      tierLine("Total resists", "T1-T2合算", "85%+", "耐性だけなら高合算でないと価格が伸びにくい"),
      tierLine("Attack/Cast Speed", "T1-T2", "12%+", "フラットやLifeと同時に付くと差別化しやすい"),
    ];
  }

  if (/Amulet|Talisman/i.test(label)) {
    return [
      tierLine("+Skill Level", "商材", "+3以上 or +2 all + strong suffix", "+1単体は基本的に妥協検索"),
      tierLine("Critical Damage", "T1-T2", "35%+", "スキルレベルと並ぶ価格上振れ枠"),
      tierLine("Attribute", "T1-T2", "45+", "要求値解決を兼ねる高tierなら評価しやすい"),
    ];
  }

  if (/Quarterstaff|Sceptre|Staff|Wand/i.test(label)) {
    if (archetype === "caster") {
      return [
        tierLine("+Spell Level", "商材", "+3以上", "+1/+2は他modが相当強い時だけ"),
        tierLine("Spell Damage", "T1-T2", "100%+", "gem levelなしの低spell damageは候補外"),
        tierLine("Cast Speed", "T1-T2", "14%+", "高tier cast speedで完成品感が出る"),
      ];
    }
    return [
      tierLine("+Attack Level", "商材", "+3以上", "スキル武器は+3から見たい"),
      tierLine("Physical Damage", "T1-T2", "120%+", "武器はDPSが見えないと売り物にしにくい"),
      tierLine("Attack Speed", "T1-T2", "14%+", "低速武器は価格が落ちやすい"),
    ];
  }

  if (/Focus/i.test(label)) {
    return [
      tierLine("+Spell Level", "T1-T2", "+2以上", "Focusは+levelか高spell damageがないと弱い"),
      tierLine("Spell Damage", "T1-T2", "90%+", "盾との差別化枠"),
      tierLine("Energy Shield", "T1-T2", "90+", "防御値が薄いFocusは売りにくい"),
      tierLine("Cast Speed", "T1-T2", "12%+", "高tier suffixなら商材化しやすい"),
    ];
  }

  if (/Gloves/i.test(label)) {
    return [
      tierLine("Attack/Cast Speed", "T1-T2", "12%+", "速度が低い手袋は差別化しにくい"),
      tierLine("Life / ES", "T1-T2", "Life 80+ or ES 80+", "速度だけなら薄い"),
      tierLine("Total resists", "T1-T2合算", "70%+", "耐性で装備更新に入りやすくなる"),
    ];
  }

  if (/Body Armour/i.test(label)) {
    return [
      tierLine("Life / ES", "T1-T2", "Life 100+ or ES 140+", "胴は防御価値が見えないと厳しい"),
      tierLine("Local defence", "高ロール", "Armour/Evasion 300+目安", "ベース差が出るので数値が重要"),
      tierLine("Total resists", "T1-T2合算", "70%+", "防御+耐性で完成品に近づく"),
    ];
  }

  if (/Helmet/i.test(label)) {
    return [
      tierLine("Life / ES", "T1-T2", "Life 80+ or ES 90+", "防御床がないHelmetは弱い"),
      tierLine("Total resists", "T1-T2合算", "75%+", "耐性の合算が低いならユーティリティ必須"),
      tierLine("Attribute / utility", "T1-T2", "40+ or build utility", "ここが差別化枠"),
    ];
  }

  if (/Belt/i.test(label)) {
    return [
      tierLine("Life", "T1-T2", "100+", "BeltはLifeが主役"),
      tierLine("Total resists", "T1-T2合算", "85%+", "耐性合算で価格が見えやすい"),
      tierLine("Strength / utility", "T1-T2", "45+ or strong utility", "Life+resだけの量産品から抜ける枠"),
    ];
  }

  if (/Jewel/i.test(label)) {
    return [
      tierLine("Build-specific damage", "T1-T2", "2 lines以上", "Jewelは exact fit で見る"),
      tierLine("Speed/Crit", "T1-T2", "AS/CS 8%+ or crit damage 25%+", "汎用商材化しやすいライン"),
      tierLine("Corruption/high roll", "手動確認", "自動価格は後回し"),
    ];
  }

  if (/Quiver/i.test(label)) {
    return [
      tierLine("Flat damage", "T1-T2", "phys avg 9+ or high ele flat", "弓系は高tierフラットが重要"),
      tierLine("Attack Speed", "T1-T2", "12%+", "速度が価格の見える軸"),
      tierLine("Accuracy/Crit", "T1-T2", "Accuracy 180+ or crit 45%+", "命中/critで完成度を見る"),
    ];
  }

  return [
    statLine("Primary damage/defense roll", "high enough to notice", "sets the first search filter"),
    statLine("Life/resource or resistance", "one defensive anchor", "keeps the item wearable"),
    statLine("Build-facing suffix", "one useful suffix", "avoids generic low-value rares"),
  ];
}

function avoidTradeFiltersFor(opportunity) {
  const label = `${opportunity.baseLabel} ${opportunity.slot}`;
  const avoid = ["offline listings for manual checks", "low-tier single-mod rares"];
  if (/Ring|Boots|Belt|Helmet/i.test(label)) avoid.push("resistance-only items with no life/resource/damage hook");
  if (/Amulet|Quarterstaff|Sceptre|Staff|Wand|Focus/i.test(label)) avoid.push("items missing the premium first filter");
  if (/Jewel/i.test(label)) avoid.push("generic damage jewels with no exact build fit");
  return avoid;
}

function buildTradeProfile(opportunity, leagueName) {
  const searchConfig = tradeSearchConfigFor(opportunity);
  const required = opportunity.modSignature.slice(0, 2).map((mod, index) =>
    statLine(mod, index === 0 ? "main filter" : "second filter", index === 0 ? "start here when filtering" : "use Count >= 2 if supply is thin"),
  );
  const preferred = opportunity.modSignature.slice(2).map((mod) => statLine(mod, "nice to have", "raise price if the first filters hit"));
  const minimums = minimumTargetsFor(opportunity);
  const profile = {
    league: leagueName,
    status: "Online only",
    rarity: "Rare",
    category: tradeCategoryFor(opportunity),
    officialCategory: searchConfig.officialCategory,
    baseHint: opportunity.baseLabel,
    applied: searchConfig.filters.map((filter) => tierLine(filter.label, filter.tier, `${filter.min}+`, "official Trade URL filter")),
    required,
    preferred,
    minimums,
    avoid: avoidTradeFiltersFor(opportunity),
    searchMode: searchConfig.filters.length ? `Official URL / Count >= ${searchConfig.countMin}` : "Official URL / category only",
  };

  const lines = [
    "PoE2 trade manual tune memo",
    "用途: Tradeリンク確認後、結果が広すぎる/狭すぎる時の手動調整または共有用。貼り付け用検索式ではありません。",
    `League: ${profile.league}`,
    `Status: ${profile.status}`,
    `Rarity: ${profile.rarity}`,
    `Category: ${profile.category}`,
    `Base/type hint: ${profile.baseHint}`,
    `URL filters: ${profile.searchMode}`,
    "",
    "[Trade filters]",
    ...profile.applied.map((item) => `- ${item.label}${item.tier ? ` / ${item.tier}` : ""}`),
    "",
    "[Tighten first]",
    ...profile.required.map((item) => `- ${item.label} (${item.target})`),
    "",
    "[Manual target rolls]",
    ...profile.minimums.map((item) => `- ${item.label}: ${item.tier ? `${item.tier} / ` : ""}${item.target}`),
    "",
    "[Optional upside]",
    ...profile.preferred.map((item) => `- ${item.label} (${item.target})`),
    "",
    "[Avoid]",
    ...profile.avoid.map((item) => `- ${item}`),
  ];

  return { ...profile, copyText: lines.join("\n") };
}

function buildTradeRequest(opportunity) {
  const searchConfig = tradeSearchConfigFor(opportunity);
  const filters = {
    type_filters: {
      filters: {
        rarity: { option: "rare" },
      },
    },
  };

  if (searchConfig.officialCategory) {
    filters.type_filters.filters.category = { option: searchConfig.officialCategory };
  }

  const stats = [];
  if (searchConfig.filters.length) {
    stats.push({
      type: searchConfig.filters.length > 1 ? "count" : "and",
      value: searchConfig.filters.length > 1 ? { min: searchConfig.countMin } : undefined,
      filters: searchConfig.filters.map((filter) => ({
        id: filter.id,
        value: filter.min > 0 ? { min: filter.min } : undefined,
        disabled: false,
      })),
    });
  }

  return {
    query: {
      status: { option: "onlineleague" },
      stats,
      filters,
    },
    sort: { price: "asc" },
  };
}

function buildTradeSearch(leagueName, opportunity) {
  const profile = buildTradeProfile(opportunity, leagueName);
  return {
    url: `https://www.pathofexile.com/trade2/search/poe2/${encodeURIComponent(leagueName)}`,
    query: profile.copyText,
    profile,
  };
}

async function createOfficialTradeSearch(leagueName, opportunity) {
  const response = await fetch(`${POE_TRADE}/api/trade2/search/poe2/${encodeURIComponent(leagueName)}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": "poe2-market-dashboard/0.1",
    },
    body: JSON.stringify(buildTradeRequest(opportunity)),
  });

  if (!response.ok) {
    const error = new Error(`Trade search failed ${response.status}`);
    error.status = response.status;
    error.retryAfter = Number(response.headers.get("retry-after") ?? 0);
    throw error;
  }
  const payload = await response.json();
  if (!payload.id) throw new Error("Trade search response did not include an id.");
  return payload.id;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function attachOfficialTradeLinks(leagueName, opportunities) {
  let createdLinks = 0;
  let tradeRateLimited = false;
  for (const opportunity of opportunities) {
    if (createdLinks >= TRADE_LINK_LIMIT || tradeRateLimited) {
      opportunity.trade.linkStatus = "manual";
      opportunity.trade.linkError = tradeRateLimited
        ? "Filtered URL generation skipped because the official trade API rate limit was reached."
        : `Filtered URL generation skipped after top ${TRADE_LINK_LIMIT} candidates to avoid official trade rate limits.`;
      continue;
    }

    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const id = await createOfficialTradeSearch(leagueName, opportunity);
        opportunity.trade.searchId = id;
        opportunity.trade.url = `${POE_TRADE}/trade2/search/poe2/${encodeURIComponent(leagueName)}/${id}`;
        opportunity.trade.linkStatus = "filtered";
        createdLinks += 1;
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (error.status !== 429 || attempt === 1) {
          if (error.status === 429) tradeRateLimited = true;
          break;
        }
        const waitMs = Math.min(Math.max(error.retryAfter * 1000, 3000 * (attempt + 1)), TRADE_RETRY_MAX_WAIT_MS);
        console.warn(`Trade search rate-limited for ${opportunity.baseLabel}; retrying in ${waitMs}ms`);
        await sleep(waitMs);
      }
    }

    if (lastError) {
      opportunity.trade.linkStatus = "fallback";
      opportunity.trade.linkError = lastError.message;
    }

    await sleep(1250);
  }
}

function makeOpportunities({ allSearch, classSearches, classes }) {
  const classRareMaps = new Map();
  for (const classEntry of classes) {
    const search = classSearches[classEntry.name];
    if (!search) continue;
    classRareMaps.set(classEntry.name, new Map(rareRows(search).map((row) => [row.name, { ...row, total: search.total }])));
  }

  return rareRows(allSearch)
    .map((row) => {
      const classFits = classes
        .map((classEntry) => {
          const match = classRareMaps.get(classEntry.name)?.get(row.name);
          const percentage = match?.total ? (match.count / match.total) * 100 : 0;
          return { className: classEntry.name, count: match?.count ?? 0, percentage, classShare: classEntry.percentage };
        })
        .filter((fit) => fit.count > 0)
        .sort((a, b) => b.percentage - a.percentage)
        .slice(0, 4);

      const topClass = classFits[0]?.className ?? classes[0]?.name ?? "Unknown";
      const maxClassPct = classFits[0]?.percentage ?? row.percentage;
      const slotWeight = targetSlotWeight(row.name, row.props.type);
      const score = Math.max(1, Math.min(96, Math.round(Math.min(row.percentage, 100) * 0.45 + Math.min(maxClassPct, 100) * 0.4 + slotWeight * 15)));
      const baseLabel = row.name.replace(/^Rare\s+/i, "");
      const modSignature = signatureFor(row.name, row.props.type, topClass);
      const opportunity = {
        id: row.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
        itemName: row.name,
        baseLabel,
        slot: row.props.type || baseLabel,
        adoptionCount: row.count,
        adoptionPct: Number(row.percentage.toFixed(2)),
        score,
        verdict: score >= 78 ? "High" : score >= 54 ? "Watch" : "Avoid",
        budget: craftBudget(row.name, row.props.type),
        craftScope: craftScope(row.name, row.props.type),
        classFits: classFits.map((fit) => ({ ...fit, percentage: Number(fit.percentage.toFixed(2)) })),
        topClass,
        archetype: archetypeFor(topClass),
        modSignature,
        craftPlan: craftPlanFor(row.name, row.props.type),
        riskFlags: riskFlagsFor(row.name, row.props.type),
        targetSlot: targetSlotWeight(row.name, row.props.type) >= 0.9,
      };
      opportunity.trade = buildTradeSearch(allSearch.leagueName, opportunity);
      opportunity.poeNinjaUrl = `${POE_NINJA}/poe2/builds/${allSearch.leagueUrl}?items=${encodeURIComponent(row.name)}`;
      return opportunity;
    })
    .sort((a, b) => b.score - a.score || b.adoptionCount - a.adoptionCount);
}

function summarizeUniques(allSearch) {
  return uniqueRows(allSearch).slice(0, 40).map((row) => ({
    name: row.name,
    type: row.props.type || "Unknown",
    adoptionCount: row.count,
    adoptionPct: Number(row.percentage.toFixed(2)),
    note: row.percentage >= 10 ? "通常品も回転候補。上限roll/corrupt差を確認。" : "high roll / corrupt で上振れ候補。",
    poeNinjaUrl: `${POE_NINJA}/poe2/builds/${allSearch.leagueUrl}?items=${encodeURIComponent(row.name)}`,
  }));
}

function summarizeGems(allSearch) {
  return gemRows(allSearch).slice(0, 50).map((row) => ({
    name: row.name,
    adoptionCount: row.count,
    adoptionPct: Number(row.percentage.toFixed(2)),
    note: row.percentage >= 8 ? "21/20候補。価格差と供給数を手動確認。" : "採用率は中位。特定ビルド向け。",
    poeNinjaUrl: `${POE_NINJA}/poe2/builds/${allSearch.leagueUrl}?skills=${encodeURIComponent(row.name)}`,
  }));
}

async function main() {
  const indexState = await fetchJson(`${POE_NINJA}/poe2/api/data/index-state`);
  const league = indexState.buildLeagues.find(isNormalCurrentLeague);
  if (!league) throw new Error("Could not find an indexed normal current PoE2 league.");
  const snapshot = indexState.snapshotVersions.find((entry) => entry.url === league.url);
  if (!snapshot) throw new Error(`Could not find snapshot version for ${league.name}.`);

  const allSearch = await loadSearch(snapshot);
  allSearch.leagueName = league.name;
  allSearch.leagueUrl = league.url;

  const classes = rowsForDimension(allSearch, "class").slice(0, 8).map((row) => ({
    name: row.name,
    count: row.count,
    percentage: Number(row.percentage.toFixed(2)),
  }));

  const classSearches = Object.fromEntries(
    await Promise.all(
      classes.slice(0, 6).map(async (classEntry) => {
        const search = await loadSearch(snapshot, { class: classEntry.name });
        search.leagueName = league.name;
        search.leagueUrl = league.url;
        return [classEntry.name, search];
      }),
    ),
  );

  const rareOpportunities = makeOpportunities({ allSearch, classSearches, classes });
  await attachOfficialTradeLinks(league.name, rareOpportunities);

  const market = {
    generatedAt: new Date().toISOString(),
    source: {
      kind: "poe.ninja",
      indexStateUrl: `${POE_NINJA}/poe2/api/data/index-state`,
      searchApi: `${POE_NINJA}/poe2/api/builds/{version}/search`,
      caveat: "Rare slot demand and build usage are extracted from poe.ninja. Rare mod signatures and craft routes are rule-based recommendations, not direct item-mod exports.",
    },
    league: {
      name: league.name,
      url: league.url,
      displayName: league.displayName,
      snapshotName: snapshot.snapshotName,
      snapshotVersion: snapshot.version,
      totalCharacters: allSearch.total,
    },
    classes,
    rare: {
      opportunities: rareOpportunities,
    },
    unique: summarizeUniques(allSearch),
    gems: summarizeGems(allSearch),
  };

  market.rare.targetSlots = market.rare.opportunities.filter((item) => item.targetSlot).length;

  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, `${JSON.stringify(market, null, 2)}\n`, "utf8");
  console.log(`Wrote ${OUT_PATH}`);
  console.log(`${league.name} ${snapshot.version}: ${market.rare.opportunities.length} rare opportunities`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
