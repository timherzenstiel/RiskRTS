// The six great powers.
export interface FactionDef { key:string; name:string; short:string; color:string; capital:string; the:string }
const def=(key:string,name:string,short:string,color:string,capital:string):FactionDef=>({key,name,short,color,capital,the:key==='AH'?name:'the '+name});
export const FACTIONS:FactionDef[]=[
  def('GB','British Empire','Britain','#c8392f','Britain'),
  def('FR','French Republic','France','#4f7fd4','France'),
  def('RU','Russian Empire','Russia','#56a85c','Petrograd'),
  def('DE','German Empire','Germany','#a8aeb6','Germany'),
  def('AH','Austria-Hungary','Austria','#e2bd3a','Austria-Hungary'),
  def('OT','Ottoman Empire','Ottomans','#ab66b9','Anatolia'),
  def('US','United States','America','#2fa8a0','Eastern States'),
];
export const NUM_FACTIONS=FACTIONS.length;
export const cap=(s:string)=>s[0].toUpperCase()+s.slice(1);
