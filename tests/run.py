import sys, time
from playwright.sync_api import sync_playwright
import http.server, threading, functools, os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
srv=http.server.ThreadingHTTPServer(('127.0.0.1',8765),functools.partial(http.server.SimpleHTTPRequestHandler,directory='.'))
threading.Thread(target=srv.serve_forever,daemon=True).start()
with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist'])
    pg=b.new_page(viewport={'width':1400,'height':850})
    errs=[]
    pg.on('console',lambda m: errs.append(f'{m.type}: {m.text}') if m.type in ('error','warning') else None)
    pg.on('pageerror',lambda e: errs.append('PAGEERROR '+str(e)))
    pg.goto('http://127.0.0.1:8765/index.html'); time.sleep(4)
    pg.screenshot(path='s1.png')
    pg.click('[data-pick="3"]'); time.sleep(.5); pg.screenshot(path='s2.png')
    pg.click('#m-go'); time.sleep(1)
    pg.evaluate("()=>{const G=window.__G; G.G.speed=0; for(let i=0;i<900;i++) G.step(0.05);}")  # 45s game time
    time.sleep(1); pg.screenshot(path='s3.png')
    info=pg.evaluate("()=>{const g=window.__G; return {battles:g.battles.length, armies:g.armies.length, owners:g.factions.map(f=>g.terrs.filter(t=>t.owner===f.id).length), sup:g.factions.map(f=>f.supply)}}")
    print(info)
    pg.evaluate("()=>{const g=window.__G; const b=g.battles.find(b=>!b.ended)||g.battles[0]; if(b){g.flyTo(b.t,7);} }")
    time.sleep(3); pg.screenshot(path='s4.png')
    pg.evaluate("()=>{const g=window.__G; g.select(g.terrs.find(t=>t.owner===g.G.player).id); g.cam.gdist=30;}")
    time.sleep(2); pg.screenshot(path='s5.png')
    print('\n'.join(errs[:30]))
    b.close()
srv.shutdown()
