#!/usr/bin/env python3
"""Real region borders for the 1914 map (design: claude/design-graphics-classic-rts.md §4b).

Reads Natural Earth admin-0 outlines (world-atlas countries-50m TopoJSON, public domain), rasterises them onto the
game's 0.5 degree tile grid, assigns every country (or part of it, by 1914 cut rules) to one of the 54 regions and
writes packages/shared/src/data/regionTiles.ts: one value per tile (0 sea, region id + 1 land), run-length encoded.

The game keys corps by neighbour (RegionState.fr), so the regions must keep exactly the land contacts they had
before (tools/borders/adjacency.json). Real geography is assigned first, then a repair pass moves contact tiles to
a third region (or, for an isthmus with no alternative, cuts it) until the contact graph matches exactly.

Usage:  python3 tools/borders/build.py        (needs numpy and pillow; run `npm install` first for world-atlas)
"""
import base64, heapq, json, math, os, re, sys
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'node_modules', 'world-atlas', 'countries-50m.json')
OUT = os.path.join(ROOT, 'packages', 'shared', 'src', 'data', 'regionTiles.ts')
ADJ = os.path.join(os.path.dirname(__file__), 'adjacency.json')
REGIONS_TS = os.path.join(ROOT, 'packages', 'shared', 'src', 'data', 'regions.ts')
GEOM_TS = os.path.join(ROOT, 'packages', 'shared', 'src', 'world', 'geometry.ts')

RES, COLS, ROWS, LAT_TOP = .5, 720, 282, 84
SS = 4  # supersampling per tile edge

# ---------------------------------------------------------------- data
def seeds():
    txt = open(REGIONS_TS).read()
    return [(m[0], float(m[2]), float(m[3])) for m in re.findall(r"\['([^']+)','(NA|SA|EU|AF|AS|OC)',(-?[\d.]+),(-?[\d.]+)\]", txt)]

def lakes():
    """Big inland waters from the old outline set (Great Lakes, Aral, Baikal, Victoria); NE country shapes include them."""
    txt = open(GEOM_TS).read()
    body = txt[txt.index('export const WATER'):]
    body = body[body.index('=[') + 2:body.index('];')]
    rings = [list(map(float, r.split(','))) for r in re.findall(r'\[([-\d.,\s]+)\]', body)]
    return [r for r in rings if not (27 < r[0] < 42 and 40 < r[1] < 48) and not (46 < r[0] < 55 and 36 < r[1] < 48)]  # skip Black Sea / Caspian (not in NE land)

def countries():
    t = json.load(open(SRC))
    sc, tr = t['transform']['scale'], t['transform']['translate']
    arcs = [np.cumsum(np.array(a, np.float64), 0) * sc + tr for a in t['arcs']]
    def ring(ix):
        pts = []
        for i in ix:
            a = arcs[i] if i >= 0 else arcs[~i][::-1]
            pts.append(a if not pts else a[1:])
        return np.concatenate(pts)
    out = {}
    for g in t['objects']['countries']['geometries']:
        name = g.get('properties', {}).get('name', '?')
        polys = g['arcs'] if g['type'] == 'MultiPolygon' else [g['arcs']] if g['type'] == 'Polygon' else []
        out.setdefault(name, []).extend([[ring(r) for r in p] for p in polys])
    return out

# ---------------------------------------------------------------- country -> region
GROUPS = {
    'Alaska': [], 'Greenland': ['Greenland'], 'Iceland': ['Iceland'],
    'Mexico': ['Mexico', 'Guatemala', 'Belize', 'Honduras', 'El Salvador', 'Nicaragua', 'Costa Rica', 'Panama', 'Cuba', 'Jamaica', 'Haiti',
               'Dominican Rep.', 'Puerto Rico', 'Bahamas', 'Trinidad and Tobago', 'Cayman Is.', 'Turks and Caicos Is.'],
    'Gran Colombia': ['Colombia', 'Venezuela', 'Ecuador', 'Guyana', 'Suriname'],
    'Peru': ['Peru', 'Bolivia'], 'Brazil': ['Brazil'], 'Argentina': ['Argentina', 'Chile', 'Uruguay', 'Paraguay', 'Falkland Is.'],
    'Britain': ['United Kingdom', 'Ireland', 'Isle of Man', 'Faeroe Is.', 'Guernsey', 'Jersey'],
    'Scandinavia': ['Norway', 'Sweden', 'Åland'],
    'France': ['France', 'Belgium', 'Luxembourg', 'Monaco'],
    'Iberia': ['Spain', 'Portugal', 'Andorra', 'Gibraltar'],
    'Germany': ['Germany', 'Netherlands', 'Denmark', 'Switzerland'],
    'Italy': ['Italy', 'San Marino', 'Vatican', 'Malta'],
    'Austria-Hungary': ['Austria', 'Hungary', 'Czechia', 'Slovakia', 'Slovenia', 'Croatia', 'Bosnia and Herz.', 'Liechtenstein'],
    'Balkans': ['Serbia', 'Montenegro', 'Kosovo', 'Albania', 'Macedonia', 'North Macedonia', 'Greece', 'Bulgaria', 'Romania'],
    'Poland': ['Poland', 'Lithuania', 'Belarus'],
    'Petrograd': ['Finland', 'Estonia', 'Latvia'],
    'Ukraine': ['Ukraine', 'Moldova'],
    'Maghreb': ['Morocco', 'W. Sahara', 'Algeria', 'Tunisia'],
    'Egypt': ['Egypt', 'Libya', 'Sudan', 'S. Sudan'],
    'West Africa': ['Mauritania', 'Mali', 'Senegal', 'Gambia', 'Guinea-Bissau', 'Guinea', 'Sierra Leone', 'Liberia', "Côte d'Ivoire", 'Burkina Faso',
                    'Ghana', 'Togo', 'Benin', 'Niger', 'Nigeria', 'Chad', 'Cameroon', 'Cabo Verde'],
    'Congo': ['Dem. Rep. Congo', 'Congo', 'Gabon', 'Eq. Guinea', 'Central African Rep.', 'Angola', 'São Tomé and Principe'],
    'East Africa': ['Ethiopia', 'Eritrea', 'Djibouti', 'Somalia', 'Somaliland', 'Kenya', 'Uganda', 'Tanzania', 'Rwanda', 'Burundi'],
    'South Africa': ['South Africa', 'Namibia', 'Botswana', 'Zimbabwe', 'Mozambique', 'Zambia', 'Malawi', 'Lesotho', 'eSwatini'],
    'Madagascar': ['Madagascar', 'Comoros', 'Mauritius', 'Seychelles'],
    'Anatolia': ['Turkey', 'Cyprus', 'N. Cyprus'],
    'Mesopotamia': ['Syria', 'Iraq', 'Lebanon', 'Israel', 'Palestine', 'Jordan'],
    'Arabia': ['Saudi Arabia', 'Yemen', 'Oman', 'United Arab Emirates', 'Qatar', 'Kuwait', 'Bahrain'],
    'Persia': ['Iran', 'Afghanistan', 'Turkmenistan'],
    'Caucasus': ['Georgia', 'Armenia', 'Azerbaijan'],
    'Turkestan': ['Uzbekistan', 'Kyrgyzstan', 'Tajikistan'],
    'India': ['India', 'Pakistan', 'Bangladesh', 'Nepal', 'Bhutan', 'Sri Lanka', 'Myanmar', 'Siachen Glacier', 'Maldives'],
    'Mongolia': ['Mongolia'],
    'Manchuria': ['North Korea', 'South Korea'],
    'Japan': ['Japan', 'Taiwan'],
    'Indochina': ['Thailand', 'Laos', 'Vietnam', 'Cambodia', 'Singapore'],
    'East Indies': ['Philippines', 'Brunei', 'Timor-Leste'],
    'New Guinea': ['Papua New Guinea', 'Solomon Is.'],
    'New Zealand': ['New Zealand'],
    'Eastern Australia': ['New Caledonia', 'Vanuatu', 'Fiji'],
}
# countries split over several regions: region chosen per tile by rule (None = leave to the noise split below)
def rule(country, lon, lat):
    if country == 'France':
        if lon < -40: return 'Gran Colombia' if lat > 0 else None        # French Guiana
        if lon < -20: return 'Mexico'                                      # Antilles
        if lon > 40: return 'Madagascar'                                   # Réunion, Mayotte
        if 5.8 < lon < 8.3 and 47.55 < lat < 49.6 and lon + (lat - 48.6) * .2 > 6.1: return 'Germany'   # Alsace-Lorraine
        return 'France'
    if country == 'Netherlands' and lon < -30: return 'Mexico'
    if country == 'Spain' and lat < 30: return 'Maghreb'                   # Canaries
    if country == 'Portugal' and lon < -12: return 'Iberia'
    if country == 'Poland':
        if lon < 17.3 or (lat > 53.3 and lon < 22.8): return 'Germany'     # Posen, Silesia, East Prussia
        if lat < 50.3 and lon > 19: return 'Austria-Hungary'                # Galicia
        return 'Poland'
    if country == 'Ukraine' and 22 < lon < 26.5 and 47.7 < lat < 50.4: return 'Austria-Hungary'   # East Galicia, Bukovina
    if country == 'Romania' and lon < 25.6 and lat > 45.6: return 'Austria-Hungary'               # Transylvania
    if country == 'Turkey' and lon > 42.3: return 'Caucasus'                # Kars, Van: the Russian Caucasus front
    if country == 'United States of America':
        if lon < -140 and lat > 50: return 'Alaska'
        if lon < -150: return 'Western States'                             # Hawaii
        return None
    if country == 'Indonesia': return 'New Guinea' if lon > 130.8 else 'East Indies'
    if country == 'Malaysia': return 'Indochina' if lon < 105 else 'East Indies'
    if country == 'Kazakhstan':
        if lon < 56 or (lat > 50.5 and lon < 70): return 'Ural'
        return 'Turkestan'
    if country == 'China':
        if lon < 96 and lat > 35.5: return 'Turkestan'                     # Xinjiang
        if lat > 40.5 and lon > 118.5: return 'Manchuria'
        if lat > 27.5 and lon < 103: return 'Mongolia'                     # Tibet, Qinghai
        if lat > 41 and lon < 118.5: return 'Mongolia'                     # Inner Mongolia
        return 'China'
    if country in ('Hong Kong', 'Macao'): return 'China'
    if country == 'Russia':
        if lon < 23 and lat < 56: return 'Germany'                          # Königsberg
        if lon < 0 or lon > 165: return 'Kamchatka'                         # Chukotka across the date line
        if lon < 47:
            if lat < 47 and lon > 37: return 'Caucasus'
            if 43 <= lon and lat < 55.3: return 'Caucasus'                  # lower Volga ties the Caucasus to Petrograd
            return 'Ukraine' if lat < 55.3 else 'Petrograd'
        if lon < 70: return 'Ural'
        return None                                                         # Siberia / Irkutsk / Yakutsk / Kamchatka by noise split
    return None

SPLIT = {'United States of America': ['Western States', 'Eastern States'], 'Canada': ['Yukon', 'Prairies', 'Ontario', 'Quebec'],
         'Australia': ['Western Australia', 'Eastern Australia'], 'Russia': ['Siberia', 'Irkutsk', 'Yakutsk', 'Kamchatka']}

# ---------------------------------------------------------------- helpers
def vnoise(seed, scale):
    """Smooth value noise over the tile grid (deterministic)."""
    rng = np.random.default_rng(seed)
    gw, gh = int(COLS / scale) + 3, int(ROWS / scale) + 3
    g = rng.random((gh, gw))
    y, x = np.mgrid[0:ROWS, 0:COLS] / scale
    x0, y0 = x.astype(int), y.astype(int); fx, fy = x - x0, y - y0
    fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a, b, c, d = g[y0, x0], g[y0, x0 + 1], g[y0 + 1, x0], g[y0 + 1, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy

def nb4(i):
    c = i % COLS
    if c > 0: yield i - 1
    if c < COLS - 1: yield i + 1
    if i >= COLS: yield i - COLS
    if i + COLS < COLS * ROWS: yield i + COLS

def wrap(ring):
    """Rings crossing the date line (Chukotka, Fiji) are drawn twice, shifted by a full turn, so they don't smear across the map."""
    if ring[:, 0].max() - ring[:, 0].min() <= 180: return [np.zeros(2)]
    ring[:, 0] = np.where(ring[:, 0] < 0, ring[:, 0] + 360, ring[:, 0])
    return [np.zeros(2), np.array([-360., 0])]

def lon_of(c): return -180 + (c + .5) * RES
def lat_of(r): return LAT_TOP - (r + .5) * RES

# ---------------------------------------------------------------- build
def main():
    S = seeds(); names = [s[0] for s in S]; rid = {n: i for i, n in enumerate(names)}
    adj = json.load(open(ADJ))['land']
    assert list(adj) == names, 'adjacency.json does not match the region order in regions.ts'
    target = {(min(rid[a], rid[b]), max(rid[a], rid[b])) for a, ns in adj.items() for b in ns}

    cs = countries()
    cnames = sorted(cs); cid = {n: i + 1 for i, n in enumerate(cnames)}
    w, h = COLS * SS, ROWS * SS
    img = Image.new('I', (w, h), 0); d = ImageDraw.Draw(img)
    P = lambda a: [(float((x + 180) / RES * SS), float((LAT_TOP - y) / RES * SS)) for x, y in a]
    # largest countries first and without holes: enclaves (Lesotho, San Marino, ...) are drawn on top afterwards
    area = lambda n: sum(abs(np.dot(p[0][:-1, 0], p[0][1:, 1]) - np.dot(p[0][1:, 0], p[0][:-1, 1])) for p in cs[n])
    for n in sorted(cnames, key=area, reverse=True):
        if n in ('Antarctica', 'Fr. S. Antarctic Lands', 'Heard I. and McDonald Is.', 'S. Geo. and the Is.'): continue
        for poly in cs[n]:
            for shift in wrap(poly[0]):
                d.polygon(P(poly[0] + shift), fill=cid[n])
    for ring in lakes():
        d.polygon([(float((ring[k] + 180) / RES * SS), float((LAT_TOP - ring[k + 1]) / RES * SS)) for k in range(0, len(ring), 2)], fill=0)
    A = np.asarray(img, np.int32).reshape(ROWS, SS, COLS, SS).transpose(0, 2, 1, 3).reshape(ROWS, COLS, SS * SS)
    landfrac = (A > 0).mean(2)
    land = landfrac >= .45
    # majority country per land tile
    ctry = np.zeros((ROWS, COLS), np.int32)
    for r in range(ROWS):
        for c in range(COLS):
            if not land[r, c]: continue
            v = A[r, c][A[r, c] > 0]
            ctry[r, c] = np.bincount(v).argmax()
    land = land.reshape(-1); ctry = ctry.reshape(-1)
    N = COLS * ROWS

    terr = np.full(N, -1, np.int32)
    by_country = {}
    for g, cl in GROUPS.items():
        for c in cl: by_country[c] = g
    split_tiles = {k: [] for k in SPLIT}
    # cut lines inside big countries follow warped coordinates, so they meander like old provincial borders
    wx = (vnoise(11, 14) - .5) * 2 + (vnoise(12, 5) - .5) * .8
    wy = (vnoise(13, 14) - .5) * 2 + (vnoise(14, 5) - .5) * .8
    WARP = {'Russia': 2.4, 'China': 2.2, 'Kazakhstan': 2.2, 'Turkey': .9, 'Indonesia': 0, 'Malaysia': 0}
    for i in np.nonzero(land)[0]:
        cn = cnames[ctry[i] - 1]; r, c = divmod(int(i), COLS); lon, lat = lon_of(c), lat_of(r)
        k = WARP.get(cn, 0)
        g = rule(cn, lon + wx[r, c] * k, lat + wy[r, c] * k) if k else rule(cn, lon, lat)
        if g is None and cn in SPLIT: split_tiles[cn].append(int(i)); continue
        if g is None: g = by_country.get(cn)
        if g is not None: terr[i] = rid[g]
    # noise-warped split of big countries between their regions (organic, not straight Voronoi lines)
    noise = (vnoise(7, 9) * .65 + vnoise(8, 3.5) * .35).reshape(-1)
    for cn, regs in SPLIT.items():
        tiles = split_tiles[cn]
        if not tiles: continue
        tset = set(tiles); dist = {}; pq = []
        for g in regs:
            _, lon, lat = S[rid[g]]
            best = min(tiles, key=lambda i: (lon_of(i % COLS) - lon) ** 2 + (lat_of(i // COLS) - lat) ** 2)
            dist[best] = 0; terr[best] = rid[g]; heapq.heappush(pq, (0, best, rid[g]))
        while pq:
            dd, i, g = heapq.heappop(pq)
            if dd > dist.get(i, 1e18): continue
            for j in nb4(i):
                if j not in tset: continue
                nd = dd + .4 + 1.6 * noise[j]
                if nd < dist.get(j, 1e18): dist[j] = nd; terr[j] = g; heapq.heappush(pq, (nd, j, g))
    # land no country rule reached (tiny islands, unlisted territories): nearest assigned land, else nearest seed
    un = [int(i) for i in np.nonzero((terr < 0) & land)[0]]
    if un:
        q = [i for i in range(N) if terr[i] >= 0]; seen = set(q); head = 0
        while head < len(q):
            i = q[head]; head += 1
            for j in nb4(i):
                if land[j] and terr[j] < 0 and j not in seen: terr[j] = terr[i]; seen.add(j); q.append(j)
        for i in np.nonzero((terr < 0) & land)[0]:
            r, c = divmod(int(i), COLS); lon, lat = lon_of(c), lat_of(r)
            terr[i] = min(range(len(S)), key=lambda k: (S[k][1] - lon) ** 2 + (S[k][2] - lat) ** 2)

    repair(terr, land, target, names)

    # every region keeps land
    for k, n in enumerate(names):
        assert (terr == k).any(), f'{n} lost all its tiles'
    write(terr, land, names)

def contacts(terr, land):
    t = terr.reshape(ROWS, COLS); L = land.reshape(ROWS, COLS)
    pairs = {}
    for a, b, la, lb, off in ((t[:, :-1], t[:, 1:], L[:, :-1], L[:, 1:], 1), (t[:-1], t[1:], L[:-1], L[1:], COLS)):
        m = la & lb & (a != b)
        idx = np.nonzero(m.reshape(-1))[0]
        aa, bb = a.reshape(-1)[idx], b.reshape(-1)[idx]
        # flat index of the first tile in the original grid
        if off == 1:
            r, c = np.divmod(idx, COLS - 1); first = r * COLS + c
        else:
            first = idx
        for f, x, y in zip(first, aa, bb):
            k = (min(x, y), max(x, y)); pairs.setdefault(k, []).append((int(f), int(f) + off))
    return pairs

def repair(terr, land, target, names):
    allowed = lambda a, b: a == b or (min(a, b), max(a, b)) in target
    for it in range(400):
        pairs = contacts(terr, land)
        have = set(pairs)
        extra = sorted(have - target, key=lambda k: len(pairs[k])); missing = sorted(target - have)
        if not extra and not missing:
            print(f'adjacency matches after {it} repair passes'); return
        if it % 20 == 0: print(f'pass {it}: {len(extra)} extra, {len(missing)} missing', [f'{names[a]}-{names[b]}' for a, b in extra[:6]], [f'{names[a]}-{names[b]}' for a, b in missing[:6]])
        changed = False
        for (a, b) in extra:
            for (i, j) in pairs[(a, b)]:
                for t, other in ((i, j), (j, i)):
                    if terr[t] == terr[other]: continue
                    own = terr[t]; nbs = [terr[k] for k in nb4(t) if land[k]]
                    cands = sorted({terr[k] for k in nb4(t) if land[k]} | {terr[k] for k in diag(t) if land[k]}, key=lambda g: -nbs.count(g))
                    ok = [g for g in cands if g != own and all(allowed(g, x) for x in nbs) and (terr == own).sum() > 3]
                    if ok: terr[t] = ok[0]; changed = True; break
                else:
                    continue
                break
            else:
                # no region can take a contact tile: cut the smallest isthmus (the tile on the smaller side becomes sea)
                i, j = pairs[(a, b)][0]; t = i if (terr == terr[i]).sum() > (terr == terr[j]).sum() else j
                land[t] = False; terr[t] = -1; changed = True
                r, c = divmod(t, COLS); print(f'  cut {names[a]}-{names[b]} at {lon_of(c):.2f},{lat_of(r):.2f}')
        if extra: continue
        for (a, b) in missing:
            grow(terr, land, a, b, allowed); changed = True
        if not changed: break
    pairs = contacts(terr, land)
    raise SystemExit('could not repair adjacency: extra ' + str([f'{names[a]}-{names[b]}' for a, b in set(pairs) - target]) +
                     ' missing ' + str([f'{names[a]}-{names[b]}' for a, b in target - set(pairs)]))

def diag(i):
    c = i % COLS
    for dr in (-COLS, COLS):
        for dc in (-1, 1):
            j = i + dr + dc
            if 0 <= j < COLS * ROWS and 0 <= c + dc < COLS: yield j

def grow(terr, land, a, b, allowed):
    """Missing contact a-b: hand the cheapest path of tiles from a towards b to a (avoiding new forbidden contacts)."""
    N = COLS * ROWS; dist = {}; prev = {}; pq = []
    for i in np.nonzero(terr == a)[0]:
        i = int(i); dist[i] = 0; heapq.heappush(pq, (0, i))
    goal = -1
    while pq:
        dd, i = heapq.heappop(pq)
        if dd > dist[i]: continue
        if terr[i] == b: goal = i; break
        for j in nb4(i):
            if not land[j]: continue
            if terr[j] == b: nd = dd
            else:
                bad = sum(1 for k in nb4(j) if land[k] and not allowed(a, terr[k]) and terr[k] != b)
                nd = dd + 1 + 50 * bad
            if nd < dist.get(j, 1e18): dist[j] = nd; prev[j] = i; heapq.heappush(pq, (nd, j))
    if goal < 0: raise SystemExit('no land path for a missing contact')
    i = prev.get(goal)
    while i is not None and terr[i] != a:
        terr[i] = a; i = prev.get(i)

def write(terr, land, names):
    v = np.where(land, terr + 1, 0).astype(np.int64)
    out = bytearray(); i = 0; N = len(v)
    def varint(x):
        while True:
            b = x & 127; x >>= 7
            out.append(b | (128 if x else 0))
            if not x: break
    while i < N:
        j = i
        while j < N and v[j] == v[i]: j += 1
        varint(int(v[i])); varint(j - i); i = j
    b64 = base64.b64encode(bytes(out)).decode()
    lines = [b64[k:k + 120] for k in range(0, len(b64), 120)]
    counts = {n: int((terr == k).sum()) for k, n in enumerate(names)}
    with open(OUT, 'w') as f:
        f.write('// Generated by tools/borders/build.py from Natural Earth admin-0 outlines (public domain). Do not edit by hand.\n')
        f.write('// One value per tile of the 720x282 grid, row by row: 0 sea, region id + 1 land. Run-length encoded as\n')
        f.write('// (value, run) varint pairs, base64. Region land contacts match tools/borders/adjacency.json exactly.\n')
        f.write(f'export const REGION_TILES_COLS = {COLS}, REGION_TILES_ROWS = {ROWS};\n')
        f.write('export const REGION_TILES =\n' + ' +\n'.join(f"  '{l}'" for l in lines) + ';\n')
    print(f'wrote {OUT}: {len(out)} bytes, {int(land.sum())} land tiles')
    print('smallest regions:', sorted(counts.items(), key=lambda x: x[1])[:6])

if __name__ == '__main__':
    main()
