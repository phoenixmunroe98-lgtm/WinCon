// WinCon — battle-sim-baseline.js (Simulated Win Rate)
//
// Expands one data/meta-baseline.json member ({name, item, role, moves,
// ability?}) into a WinCon-shaped build ({nature, item, moves, sp}) plus
// its resolved ability — the same shape a real user's own team.builds
// entry has, so battle-sim-ai.js/battle-sim-engine.js can treat a
// reference opponent exactly like a real built Pokémon without a second
// code path. Curating a full Nature + 66-point Stat-Point spread by hand
// for every meta-baseline member wasn't realistic for this build, so each
// member instead names one of a small set of role templates below — a
// deliberate, bounded curation-effort tradeoff specific to reference
// opponents; a real user's own team is always built by hand, one stat at
// a time, same as it always has been.
//
// Every spread totals exactly SP_TOTAL_CAP (66, see builder.js) with no
// single stat above 32 — the same constraints the Builder's own SP
// allocator enforces on a real build.

const WC_ROLE_SPREADS = {
  "fast-physical": { nature: "Jolly", sp: { hp: 2, attack: 32, defense: 0, sp_attack: 0, sp_defense: 0, speed: 32 } },
  "fast-special": { nature: "Timid", sp: { hp: 2, attack: 0, defense: 0, sp_attack: 32, sp_defense: 0, speed: 32 } },
  "bulky-physical": { nature: "Adamant", sp: { hp: 32, attack: 32, defense: 0, sp_attack: 0, sp_defense: 2, speed: 0 } },
  "bulky-special": { nature: "Modest", sp: { hp: 32, attack: 0, defense: 2, sp_attack: 32, sp_defense: 0, speed: 0 } },
  "support-bulky": { nature: "Calm", sp: { hp: 32, attack: 0, defense: 2, sp_attack: 0, sp_defense: 32, speed: 0 } },
  "trick-room": { nature: "Brave", sp: { hp: 32, attack: 32, defense: 2, sp_attack: 0, sp_defense: 0, speed: 0 } },
};

/** Fallback for a role not named above — a safe, neutral all-rounder spread. Should never actually be hit by a shipped meta-baseline.json entry. */
const WC_DEFAULT_ROLE_SPREAD = { nature: "Hardy", sp: { hp: 22, attack: 11, defense: 11, sp_attack: 11, sp_defense: 11, speed: 0 } };

function wcRoleSpread(role) {
  return WC_ROLE_SPREADS[role] || WC_DEFAULT_ROLE_SPREAD;
}

/**
 * @param member One data/meta-baseline.json member entry.
 * @param pokemonList data/pokemon.json.
 * @param baseStatsData data/base-stats.json.
 * @param abilitiesData data/abilities.json — used as the default ability
 *   (via wcAbilityOf, strategy.js) when the member doesn't name one.
 * @returns { name, types, baseStats, ability, build } or null if the
 *   species/base-stats can't be found (defensive — every shipped entry
 *   should resolve; see wcResolveBaselineTeam for how a bad entry is handled).
 */
function wcResolveBaselineMember(member, pokemonList, baseStatsData, abilitiesData) {
  const pokemon = pokemonList.find((p) => p.name === member.name);
  const baseStats = baseStatsData.find((b) => b.name === member.name);
  if (!pokemon || !baseStats) return null;
  const spread = wcRoleSpread(member.role);
  const ability = member.ability || wcAbilityOf(abilitiesData, member.name) || null;
  return {
    name: member.name,
    types: pokemon.types,
    baseStats,
    ability,
    build: {
      nature: spread.nature,
      item: member.item || "",
      moves: (member.moves || []).slice(0, 4),
      sp: { ...spread.sp },
    },
  };
}

/**
 * Resolves every member of one data/meta-baseline.json reference team.
 * Skips (never throws on) a member that fails to resolve, so one bad
 * data entry can't take down a whole simulation run.
 */
function wcResolveBaselineTeam(team, pokemonList, baseStatsData, abilitiesData) {
  const resolved = [];
  (team.members || []).forEach((m) => {
    const r = wcResolveBaselineMember(m, pokemonList, baseStatsData, abilitiesData);
    if (r) resolved.push(r);
    else if (typeof console !== "undefined") console.warn("wcResolveBaselineTeam: could not resolve meta-baseline member", team.id, m && m.name);
  });
  return resolved;
}
