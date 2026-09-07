import json, os, time
from collections import deque
from panda3d.core import loadPrcFileData
loadPrcFileData("", "window-type none"); loadPrcFileData("", "audio-library-name null")
from direct.showbase.ShowBase import ShowBase
from panda3d.core import *

base = ShowBase()
room = base.loader.loadModel("models/solidfloormazefinal")
room.reparentTo(base.render); room.setScale(.175); room.setPos(0,0,0)
room.setCollideMask(CollideMask.bit(0))
trav = CollisionTraverser(); q = CollisionHandlerQueue()
ray = CollisionRay(); cn = CollisionNode("r"); cn.addSolid(ray)
cn.setFromCollideMask(CollideMask.bit(0)); cn.setIntoCollideMask(CollideMask.allOff())
rnp = base.render.attachNewNode(cn); trav.addCollider(rnp, q)
Z = 3.137

def cast(ox, oy, dx, dy):
    ray.setOrigin(ox, oy, Z); ray.setDirection(dx, dy, 0)
    q.clearEntries(); trav.traverse(base.render)
    return [q.getEntry(k).getSurfacePoint(base.render) for k in range(q.getNumEntries())]

mn, mx = room.getTightBounds()
CELL = 2.0
x0, y0 = float(mn[0]) - CELL, float(mn[1]) - CELL
x1, y1 = float(mx[0]) + CELL, float(mx[1]) + CELL
W = int((x1 - x0) / CELL) + 1
H = int((y1 - y0) / CELL) + 1
print("grid %dx%d cell %s origin (%.2f, %.2f)" % (W, H, CELL, x0, y0))

grid = [[0] * W for _ in range(H)]   # 0 = open
def mark(px, py):
    i = int((px - x0) / CELL); j = int((py - y0) / CELL)
    if 0 <= i < W and 0 <= j < H:
        grid[j][i] = 1

t = time.time()
for j in range(H):                                  # horizontal scanlines
    for p in cast(x0 - 50, y0 + j*CELL + CELL/2, 1, 0):
        mark(p.getX(), p.getY())
for i in range(W):                                  # vertical scanlines
    for p in cast(x0 + i*CELL + CELL/2, y0 - 50, 0, 1):
        mark(p.getX(), p.getY())
print("wall cells: %d of %d  (%.1fs)" % (sum(sum(r) for r in grid), W*H, time.time()-t))

def cell(x, y): return int((x - x0)/CELL), int((y - y0)/CELL)
si, sj = cell(25, -1)
assert grid[sj][si] == 0, "spawn is a wall!"
seen = [[False]*W for _ in range(H)]
dq = deque([(si,sj)]); seen[sj][si] = True
while dq:
    i, j = dq.popleft()
    for di,dj in ((1,0),(-1,0),(0,1),(0,-1)):
        ni,nj = i+di, j+dj
        if 0<=ni<W and 0<=nj<H and not seen[nj][ni] and grid[nj][ni]==0:
            seen[nj][ni]=True; dq.append((ni,nj))
reach = 0
for j in range(H):
    for i in range(W):
        if grid[j][i]==0 and not seen[j][i]: grid[j][i]=1
        elif grid[j][i]==0: reach += 1
print("reachable open cells: %d (%.1f%% of grid)" % (reach, 100.0*reach/(W*H)))

ENT = {"ralph":[(25,-1)], "portal":[(-196,177)],
 "orbs":[(18,29),(-249,419),(-404,343),(-141,-69),(-277,356),(-102,-5),(-135,22),(-248,329),(-330,241),(-60,110)],
 "enemies":[(-249,419),(-404,343),(-141,-69),(-277,356),(-102,-5),(-133,83),(-246,280),(-330,241),(-60,110),(-75,52),(-75,141),(-302,202),(-303,304)],
 "donuts":[(0,0),(-330,250),(-141,-80),(-249,430),(-102,-10)]}
bad=[]
for k,pts in ENT.items():
    for (x,y) in pts:
        i,j = cell(x,y)
        if not(0<=i<W and 0<=j<H) or grid[j][i]!=0: bad.append((k,x,y))
print("entities blocked:", bad if bad else "none — all 30 in open space")

json.dump({"cell":CELL,"originX":x0,"originY":y0,"w":W,"h":H,
           "grid":["".join(map(str,r)) for r in grid]}, open(os.environ["OUT"],"w"))
p = PNMImage(W,H)
for j in range(H):
    for i in range(W):
        v = 0.08 if grid[j][i] else 1.0
        p.setXel(i, H-1-j, v,v,v)
p.write(Filename.fromOsSpecific(os.environ["PNG"]))
print("=== DONE ===")
