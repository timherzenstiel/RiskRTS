import time, http.server, threading, functools, os
from playwright.sync_api import sync_playwright
os.chdir(os.path.dirname(os.path.abspath(__file__)))
srv=http.server.ThreadingHTTPServer(('127.0.0.1',8766),functools.partial(http.server.SimpleHTTPRequestHandler,directory='.'))
threading.Thread(target=srv.serve_forever,daemon=True).start()
with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist'])
    pg=b.new_page(viewport={'width':1400,'height':850})
    errs=[]
    pg.on('console',lambda m: errs.append(f'{m.type}: {m.text}') if m.type in ('error','warning') and 'GPU stall' not in m.text else None)
    pg.on('pageerror',lambda e: errs.append('PAGEERROR '+str(e)))
    t0=time.time(); pg.goto('http://127.0.0.1:8766/index.html'); pg.wait_for_function("()=>window.__G",timeout=60000); print('boot',round(time.time()-t0,1)); print(pg.evaluate('()=>performance.now()')); time.sleep(3)
    pg.screenshot(path='h1.png')
    pg.evaluate("()=>{document.querySelector('[data-pick=\"3\"]').click(); document.querySelector('#m-go').click();}"); time.sleep(1)
    pg.evaluate("()=>{const g=window.__G; g.G.speed=0; for(let i=0;i<700;i++) g.step(0.05);}")
    pg.evaluate("()=>{const g=window.__G; g.cam.gdist=g.cam.dist=34;}"); time.sleep(6); pg.screenshot(path='h2.png')
    pg.evaluate("()=>{const g=window.__G; const t=g.terrs.find(t=>t.name==='France'); g.cam.gx=g.cam.tx=t.cx; g.cam.gz=g.cam.tz=t.cz; g.cam.gdist=g.cam.dist=12;}"); time.sleep(6); pg.screenshot(path='h3.png')
    pg.evaluate("()=>{const g=window.__G; const b=g.battles.filter(b=>!b.ended).sort((a,b)=>b.agents.length-a.agents.length)[0]; if(b){g.cam.gx=g.cam.tx=b.cx; g.cam.gz=g.cam.tz=b.cz; g.cam.gdist=g.cam.dist=5;} g.G.speed=1;}")
    time.sleep(8); pg.screenshot(path='h4.png')
    print(pg.evaluate("()=>{const g=window.__G; return {battles:g.battles.length, owners:g.factions.map(f=>g.terrs.filter(t=>t.owner===f.id).length)}}"))
    print('\n'.join(errs[:20]))
    b.close()
srv.shutdown()
