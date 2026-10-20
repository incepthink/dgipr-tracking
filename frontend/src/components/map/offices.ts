/**
 * DGIPR office codes (config/organisation.yaml) to map district ids (maharashtra-geometry.json).
 *
 * Explicit rather than matched by name: the boundary file and the office list are kept by different people, and a
 * name match would silently drop a district the day either is respelt. tests/test_insights.py checks that every
 * active district office is here and that every id exists. The two Mumbai shapes have no district office (Mumbai
 * is the मुख्यालय) and the विमाका / headquarters units are not districts; they are shown as chips under the map.
 */
export const OFFICE_GEO: Record<string, string> = {
  bhandara: "bhandara",
  gondia: "gondia",
  wardha: "wardha",
  nagpur: "nagpur",
  chandrapur: "chandrapur",
  gadchiroli: "gadchiroli",
  pune: "pune",
  solapur: "solapur",
  satara: "satara",
  chh_sambhajinagar: "chhatrapati-sambhajinagar",
  jalna: "jalna",
  parbhani: "parbhani",
  beed: "beed",
  raigad: "raigad",
  thane: "thane",
  ratnagiri: "ratnagiri",
  palghar: "palghar",
  kolhapur: "kolhapur",
  sangli: "sangli",
  sindhudurg: "sindhudurg",
  nashik: "nashik",
  ahilyanagar: "ahilyanagar",
  jalgaon: "jalgaon",
  dhule: "dhule",
  nandurbar: "nandurbar",
  amravati: "amravati",
  akola: "akola",
  washim: "washim",
  buldhana: "buldhana",
  yavatmal: "yavatmal",
  latur: "latur",
  dharashiv: "dharashiv",
  nanded: "nanded",
  hingoli: "hingoli",
};

/** Map shapes with no office of their own: drawn neutral and labelled as the headquarters. */
export const HQ_GEO = new Set(["mumbai-city", "mumbai-suburban"]);

export const GEO_OFFICE: Record<string, string> = Object.fromEntries(Object.entries(OFFICE_GEO).map(([o, g]) => [g, o]));

/** Marathi / English names for the shapes, for the headquarters ones (the rest use the office's own name). */
export const GEO_NAMES: Record<string, { mr: string; en: string }> = {
  "mumbai-city": { mr: "मुंबई शहर", en: "Mumbai City" },
  "mumbai-suburban": { mr: "मुंबई उपनगर", en: "Mumbai Suburban" },
};
