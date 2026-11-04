/** Small deterministic PRNG (mulberry32). The state is a single uint32 so it can live inside GameState. */
export class Rng{
  constructor(public s:number){ this.s=s>>>0; }
  next():number{ this.s=(this.s+0x6D2B79F5)>>>0; let t=this.s; t=Math.imul(t^(t>>>15),t|1); t^=t+Math.imul(t^(t>>>7),t|61); return ((t^(t>>>14))>>>0)/4294967296; }
  range(a:number,b:number){ return a+(b-a)*this.next(); }
  int(n:number){ return Math.floor(this.next()*n); }
  pick<T>(a:T[]):T{ return a[this.int(a.length)]; }
  shuffle<T>(a:T[]):T[]{ for(let i=a.length-1;i>0;i--){ const j=this.int(i+1); [a[i],a[j]]=[a[j],a[i]]; } return a; }
}
export function hash2(x:number,y:number){ let h=Math.imul(x|0,374761393)^Math.imul(y|0,668265263); h=Math.imul(h^(h>>>13),1274126177); h^=h>>>16; return (h>>>0)/4294967296; }
export function vnoise(x:number,y:number){ const xi=Math.floor(x),yi=Math.floor(y),xf=x-xi,yf=y-yi; const s=(t:number)=>t*t*(3-2*t);
  const a=hash2(xi,yi),b=hash2(xi+1,yi),c=hash2(xi,yi+1),d=hash2(xi+1,yi+1); const u=s(xf),v=s(yf);
  return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v; }
