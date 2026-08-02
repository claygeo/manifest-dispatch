"""One-time build step: pairwise leg matrix between depot + every seeded stop.

Enables user-planned sequences on real roads (the /plan sandbox) and same-day
feasibility arithmetic without ever calling OSRM at runtime. Polite: 1.2s/req.
Directed pairs are fetched both ways (one-way streets make A->B != B->A).
"""
import itertools
import json
import time
import urllib.request

routes = json.load(open("routes.json"))
DEPOT = routes["depot"]

nodes = [{"id": "depot", "name": DEPOT["name"], "lon": DEPOT["lon"], "lat": DEPOT["lat"]}]
for run in routes["runs"]:
    for i, s in enumerate(run["stops"]):
        nodes.append({"id": f"{run['id']}-{i + 1}", "name": s["name"], "lon": s["lon"], "lat": s["lat"]})

print(f"{len(nodes)} nodes -> {len(nodes) * (len(nodes) - 1)} directed legs")


def fetch(a, b):
    url = (
        "https://router.project-osrm.org/route/v1/driving/"
        f"{a['lon']},{a['lat']};{b['lon']},{b['lat']}"
        "?overview=full&geometries=geojson&steps=false"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "manifest-demo-precompute/1.0 (one-time build step)"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.load(r)
            if data.get("code") == "Ok" and data.get("routes"):
                rt = data["routes"][0]
                return {
                    "distance_m": round(rt["distance"]),
                    "duration_s": round(rt["duration"]),
                    "coords": [[round(lon, 5), round(lat, 5)] for lon, lat in rt["geometry"]["coordinates"]],
                }
        except Exception as e:
            print(f"  retry {attempt + 1} {a['id']}->{b['id']}: {e}", flush=True)
            time.sleep(3)
    raise RuntimeError(f"failed leg {a['id']}->{b['id']}")


matrix = {}
for a, b in itertools.permutations(nodes, 2):
    key = f"{a['id']}|{b['id']}"
    matrix[key] = fetch(a, b)
    print(f"{key}  {matrix[key]['duration_s']}s", flush=True)
    time.sleep(1.2)

out = {"nodes": nodes, "legs": matrix}
with open("matrix.json", "w") as f:
    json.dump(out, f)
import os
print(f"WROTE matrix.json ({len(matrix)} legs, {round(os.path.getsize('matrix.json')/1024)} KB)")
