import type { Rng } from './rng.js';

/** Synthetic names only: built from syllables so they never match a real club or player. */
const CITY_START = [
  'Al',
  'Bel',
  'Cor',
  'Dun',
  'El',
  'Far',
  'Gal',
  'Har',
  'Ist',
  'Jor',
  'Kel',
  'Lun',
  'Mor',
  'Nor',
  'Ost',
  'Pra',
  'Quin',
  'Ros',
  'Sel',
  'Tor',
  'Ul',
  'Ver',
  'Wes',
  'Yor',
  'Zan',
];
const CITY_END = [
  'ton',
  'ford',
  'burg',
  'vale',
  'mont',
  'ria',
  'grad',
  'stad',
  'port',
  'wick',
  'mere',
  'holm',
];
const CLUB_SUFFIX = ['FC', 'United', 'Athletic', 'Rovers', 'City', 'Sporting', 'Wanderers'];
const TEAM_SUFFIX = ['Wolves', 'Falcons', 'Comets', 'Titans', 'Storm', 'Hawks', 'Pilots', 'Owls'];
const SURNAME_START = [
  'Var',
  'Kol',
  'Ben',
  'Mar',
  'Dra',
  'Lis',
  'Tor',
  'Sev',
  'Rad',
  'Ost',
  'Nel',
  'Fil',
];
const SURNAME_END = ['ova', 'ic', 'en', 'sson', 'ari', 'ez', 'ski', 'ner', 'ini', 'ard'];
const INITIALS = 'ABCDEFGHIJKLMNOPRSTV';
const LEAGUE_KIND = [
  'Premier',
  'Cup',
  'Division One',
  'Open',
  'Championship',
  'Challenger',
  'Masters',
];

const city = (rng: Rng) => rng.pick(CITY_START) + rng.pick(CITY_END);

export function teamName(rng: Rng, sportId: number): string {
  if (sportId === 3 || sportId === 6) {
    // Individual sports: "K. Varsson"
    return `${rng.pick([...INITIALS])}. ${rng.pick(SURNAME_START)}${rng.pick(SURNAME_END)}`;
  }
  return sportId === 1
    ? `${city(rng)} ${rng.pick(CLUB_SUFFIX)}`
    : `${city(rng)} ${rng.pick(TEAM_SUFFIX)}`;
}

export function leagueName(rng: Rng): string {
  return `${city(rng)} ${rng.pick(LEAGUE_KIND)}`;
}
