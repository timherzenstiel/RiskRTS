// Region definitions for the 1914 world map.
export type ContKey='NA'|'SA'|'EU'|'AF'|'AS'|'OC';
export const CONT: Record<ContKey,{name:string;bonus:number}>={NA:{name:'North America',bonus:5},SA:{name:'South America',bonus:2},EU:{name:'Europe',bonus:6},AF:{name:'Africa',bonus:3},AS:{name:'Asia',bonus:8},OC:{name:'Oceania',bonus:2}};
export const CONT_KEYS=Object.keys(CONT) as ContKey[];
/** Region seeds: [name, continent, lon, lat]. Regions grow from these by flood fill. */
export const SEEDS: [string,ContKey,number,number][]=[
 ['Alaska','NA',-152,64],['Yukon','NA',-118,64],['Greenland','NA',-42,72],['Prairies','NA',-110,54],['Ontario','NA',-86,50],['Quebec','NA',-71,52],['Western States','NA',-113,40],['Eastern States','NA',-84,37],['Mexico','NA',-101,22],
 ['Gran Colombia','SA',-68,6],['Peru','SA',-75,-10],['Brazil','SA',-50,-10],['Argentina','SA',-65,-35],
 ['Iceland','EU',-19,65],['Britain','EU',-2,53],['Scandinavia','EU',15,62],['France','EU',2,47],['Iberia','EU',-4,40],['Germany','EU',10,51],['Italy','EU',13,42.5],['Austria-Hungary','EU',19,47],['Balkans','EU',22,43],['Poland','EU',21,52],['Petrograd','EU',32,59],['Ukraine','EU',34,49],
 ['Maghreb','AF',2,30],['West Africa','AF',-6,13],['Egypt','AF',29,26],['East Africa','AF',37,2],['Congo','AF',21,-3],['South Africa','AF',25,-26],['Madagascar','AF',46.5,-19],
 ['Anatolia','AS',33,39],['Mesopotamia','AS',42,33],['Arabia','AS',46,22],['Persia','AS',55,32],['Caucasus','AS',44.5,41.5],['Turkestan','AS',65,42],['India','AS',78,22],['Ural','AS',60,60],['Siberia','AS',85,63],['Irkutsk','AS',105,56],['Yakutsk','AS',125,65],['Kamchatka','AS',160,62],['Mongolia','AS',102,46],['China','AS',110,30],['Manchuria','AS',127,46],['Japan','AS',138,37],['Indochina','AS',102,16],
 ['East Indies','OC',113,0],['New Guinea','OC',142,-5],['Western Australia','OC',122,-25],['Eastern Australia','OC',145,-27],['New Zealand','OC',175,-39],
];
/** Sea lanes: pairs of region names that count as neighbours (troops sail). */
export const SEA: [string,string][]=[['Alaska','Kamchatka'],['Greenland','Yukon'],['Greenland','Quebec'],['Greenland','Iceland'],['Iceland','Britain'],['Iceland','Scandinavia'],['Britain','France'],['Britain','Scandinavia'],['Britain','Germany'],['Brazil','West Africa'],['Iberia','Maghreb'],['Italy','Maghreb'],['Egypt','Mesopotamia'],['East Africa','Madagascar'],['South Africa','Madagascar'],['East Africa','Arabia'],['Japan','Manchuria'],['Japan','Kamchatka'],['Indochina','East Indies'],['East Indies','New Guinea'],['East Indies','Western Australia'],['New Guinea','Eastern Australia'],['Eastern Australia','New Zealand'],['Scandinavia','Germany'],['Balkans','Anatolia']];

