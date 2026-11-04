// Unit statistics and costs. Tune game balance here.
export type UnitType='inf'|'mg'|'art'|'tank';
export const UNIT_TYPES:UnitType[]=['inf','mg','art','tank'];
export interface UnitStats{ name:string; short:string; hp:number; range:number; dmg:number; rof:number; acc:number; speed:number; power:number; splash?:number }
export const UT:Record<UnitType,UnitStats>={
  inf:{name:'Infantry',short:'INF',hp:10,range:7,dmg:2.2,rof:1.1,acc:.55,speed:1.25,power:1},
  mg:{name:'Machine gun',short:'MG',hp:12,range:9.5,dmg:1.1,rof:.28,acc:.34,speed:.75,power:1.6},
  art:{name:'Field gun',short:'ART',hp:9,range:22,dmg:7,rof:3.4,acc:.5,speed:.5,power:2.2,splash:2.4},
  tank:{name:'Tank',short:'TNK',hp:45,range:8,dmg:5,rof:1.8,acc:.6,speed:.9,power:4},
};
export type Units=Record<UnitType,number>;
export const emptyUnits=():Units=>({inf:0,mg:0,art:0,tank:0});
export const totalUnits=(u:Units)=>u.inf+u.mg+u.art+u.tank;
export const unitPower=(u:Units)=>u.inf*UT.inf.power+u.mg*UT.mg.power+u.art*UT.art.power+u.tank*UT.tank.power;
export const COST={inf:1,mg:2,art:3,tank:5,factory:6,barracks:4} as const;
export const TRENCH_COST=[3,5,8] as const;
export const MAX_TRENCH=3;
/** Seconds between supply convoys. Every power receives supply at the same instant. */
export const TICK_SECONDS=20;
