// The 1914 rail network on the 54-region map: links between land neighbours (and the Bosporus ferry of the Berlin–Baghdad line).
// Dense in Europe; the Trans-Siberian; Berlin–Baghdad with its unfinished Anatolia–Mesopotamia leg; North American
// transcontinentals; the Cape and Cairo stubs in Africa; China, Manchuria and Indochina; the Trans-Australian (opened 1917).
export const RAIL_LINKS: [string, string][] = [
  // Europe
  ['France', 'Iberia'], ['France', 'Germany'], ['France', 'Italy'], ['Germany', 'Italy'], ['Germany', 'Austria-Hungary'], ['Germany', 'Poland'],
  ['Italy', 'Austria-Hungary'], ['Austria-Hungary', 'Balkans'], ['Austria-Hungary', 'Poland'], ['Austria-Hungary', 'Ukraine'],
  ['Poland', 'Petrograd'], ['Poland', 'Ukraine'], ['Petrograd', 'Ukraine'], ['Petrograd', 'Scandinavia'], ['Balkans', 'Ukraine'],
  // Russia and the Trans-Siberian
  ['Petrograd', 'Ural'], ['Ukraine', 'Caucasus'], ['Petrograd', 'Caucasus'], ['Ural', 'Siberia'], ['Ural', 'Turkestan'], ['Siberia', 'Irkutsk'],
  ['Irkutsk', 'Manchuria'], ['Manchuria', 'China'], ['China', 'Indochina'],
  // Berlin–Baghdad (Bosporus ferry) and the Hejaz railway
  ['Balkans', 'Anatolia'], ['Mesopotamia', 'Arabia'],
  // Africa: Cape to Cairo stubs
  ['Egypt', 'East Africa'], ['South Africa', 'Congo'],
  // North America
  ['Prairies', 'Ontario'], ['Ontario', 'Quebec'], ['Prairies', 'Western States'], ['Western States', 'Eastern States'], ['Ontario', 'Eastern States'],
  ['Quebec', 'Eastern States'], ['Eastern States', 'Mexico'], ['Western States', 'Mexico'], ['Yukon', 'Alaska'],
  // Oceania
  ['Western Australia', 'Eastern Australia'],
];
/** Rail links that run over a sea lane (train ferries). */
export const RAIL_FERRIES: [string, string][] = [['Balkans', 'Anatolia']];
/** Supply to build one rail link, and how many days it takes. */
export const RAIL_BUILD = { cost: 5, days: 21 } as const;
/** Days a rail link stays cut after an air strike or sabotage. */
export const RAIL_CUT = { air: 14, spy: 21 } as const;
