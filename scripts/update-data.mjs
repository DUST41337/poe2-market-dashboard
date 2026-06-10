import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_PATH = path.join(ROOT, "public", "data", "market.json");
const POE_NINJA = "https://poe.ninja";

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
  return rowsForDimension(searchData, "allskills").slice(0, 120);
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

function minimumTargetsFor(opportunity) {
  const label = `${opportunity.baseLabel} ${opportunity.slot}`;
  const archetype = opportunity.archetype;

  if (/Boots/i.test(label)) {
    return [
      statLine("Movement Speed", "25%+ preferred", "speed is the easiest buyer-side filter"),
      statLine("Life or ES", "mid/high tier", "avoid pure resistance boots unless very cheap"),
      statLine("Total useful resists", "60%+ if no premium mod", "keeps the listing from blending into bulk supply"),
    ];
  }

  if (/Ring/i.test(label)) {
    return [
      statLine("Life/Mana/ES", "one strong prefix", "rings without a core resource roll are hard to price up"),
      statLine("Total useful resists", "70%+ target", "resist rings are common, total value needs to be obvious"),
      statLine("Damage/speed suffix", "one build-facing suffix", "separates the item from generic fixer rings"),
    ];
  }

  if (/Amulet|Talisman/i.test(label)) {
    return [
      statLine("+Level", "+1 minimum, +2 watchlist", "most buyers start with a level filter"),
      statLine("Attributes or resource", "one strong support roll", "makes attribute-starved builds easier to fit"),
      statLine("Damage multiplier", "high tier if present", "premium upside for finished listings"),
    ];
  }

  if (/Quarterstaff|Sceptre|Staff|Wand/i.test(label)) {
    if (archetype === "caster") {
      return [
        statLine("+Spell level", "+2 target, +1 budget", "caster weapons are usually filtered by gem level first"),
        statLine("Spell damage", "80%+ target", "keeps low-roll caster weapons out"),
        statLine("Cast speed", "10%+ if available", "important second-pass buyer filter"),
      ];
    }
    return [
      statLine("Physical or elemental DPS", "clear high roll", "attack weapons need visible damage"),
      statLine("Attack speed", "10%+ target", "buyers filter speed aggressively"),
      statLine("Accuracy or crit", "one useful suffix", "helps justify price above essence failures"),
    ];
  }

  if (/Focus/i.test(label)) {
    return [
      statLine("+Spell level or spell damage", "one premium caster prefix", "focus buyers need a reason over shields"),
      statLine("Energy Shield or Mana", "one strong defense/resource roll", "keeps the item usable"),
      statLine("Cast speed / crit / res", "one useful suffix", "turns a stat stick into a sellable piece"),
    ];
  }

  if (/Gloves/i.test(label)) {
    return [
      statLine("Attack or Cast Speed", "10%+ target", "main reason to search gloves specifically"),
      statLine("Life or ES", "mid/high tier", "defensive floor for non-unique gloves"),
      statLine("Resists or attributes", "one strong suffix", "fit pressure sells"),
    ];
  }

  if (/Body Armour/i.test(label)) {
    return [
      statLine("Base defence", "high local defence", "buyers compare armour by defence first"),
      statLine("Life or ES", "high tier", "required for rare armour to beat cheap alternatives"),
      statLine("Resistance", "one strong suffix", "keeps it easy to equip"),
    ];
  }

  if (/Helmet/i.test(label)) {
    return [
      statLine("Life or ES", "mid/high tier", "generic helmets need a defensive floor"),
      statLine("Resists", "two useful suffixes or one premium suffix", "common buyer filter"),
      statLine("Utility suffix", "reservation, attribute, or skill utility", "the differentiator"),
    ];
  }

  if (/Belt/i.test(label)) {
    return [
      statLine("Life", "high tier", "belts are usually life-first searches"),
      statLine("Resists", "60%+ total target", "common fit pressure"),
      statLine("Strength or charm/flask utility", "one useful extra", "helps avoid bulk-pricing"),
    ];
  }

  if (/Jewel/i.test(label)) {
    return [
      statLine("Build-specific damage", "two relevant lines", "jewels are bought by exact build fit"),
      statLine("Defense or attribute", "one useful support line", "raises floor value"),
      statLine("Corruption/high tier", "manual watch", "automated pricing is intentionally deferred"),
    ];
  }

  if (/Quiver/i.test(label)) {
    return [
      statLine("Added damage", "high roll", "ranged builds filter damage first"),
      statLine("Attack speed", "10%+ target", "premium suffix"),
      statLine("Accuracy or crit", "one useful suffix", "keeps it build-facing"),
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
    baseHint: opportunity.baseLabel,
    required,
    preferred,
    minimums,
    avoid: avoidTradeFiltersFor(opportunity),
    searchMode: opportunity.craftScope === "Manual review" ? "Manual stat search" : "Stat filters + Count group",
  };

  const lines = [
    "PoE2 trade search recipe",
    `League: ${profile.league}`,
    `Status: ${profile.status}`,
    `Rarity: ${profile.rarity}`,
    `Category: ${profile.category}`,
    `Base/type hint: ${profile.baseHint}`,
    `Mode: ${profile.searchMode}`,
    "",
    "[Required filters]",
    ...profile.required.map((item) => `- ${item.label} (${item.target})`),
    "",
    "[Minimum targets]",
    ...profile.minimums.map((item) => `- ${item.label}: ${item.target}`),
    "",
    "[Preferred filters]",
    ...profile.preferred.map((item) => `- ${item.label} (${item.target})`),
    "",
    "[Avoid]",
    ...profile.avoid.map((item) => `- ${item}`),
  ];

  return { ...profile, copyText: lines.join("\n") };
}

function buildTradeSearch(leagueName, opportunity) {
  const profile = buildTradeProfile(opportunity, leagueName);
  return {
    url: `https://www.pathofexile.com/trade2/search/poe2/${encodeURIComponent(leagueName)}`,
    query: profile.copyText,
    profile,
  };
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
      opportunities: makeOpportunities({ allSearch, classSearches, classes }),
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
