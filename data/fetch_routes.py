"""One-time build step: fetch real road polylines for the demo fleet.

Hits the public OSRM demo server once per leg (polite: 1 req/s), writes
data/routes.json. The app never calls OSRM at runtime — routes ship static.
Customer names/addresses below are fictional.
"""
import json
import time
import urllib.request

DEPOT = {"name": "Manifest Depot — Downtown Tampa", "lon": -82.4572, "lat": 27.9506}

RUNS = [
    {
        "id": "run-a",
        "label": "South Tampa",
        "driver": "Marcus R.",
        "stops": [
            {"name": "Dana Whitfield", "address": "808 W Azeele St", "lon": -82.4680, "lat": 27.9370},
            {"name": "Luis Herrera", "address": "3607 W San Jose St", "lon": -82.4930, "lat": 27.9210},
            {"name": "Kelsey Tran", "address": "6210 S MacDill Ave", "lon": -82.4790, "lat": 27.8890},
            {"name": "Robert Anders", "address": "120 Biscayne Ave", "lon": -82.4520, "lat": 27.9280},
        ],
    },
    {
        "id": "run-b",
        "label": "Seminole Heights",
        "driver": "Aisha M.",
        "stops": [
            {"name": "Priya Nair", "address": "1004 W Coral St", "lon": -82.4700, "lat": 27.9700},
            {"name": "Tom Callahan", "address": "4311 N Ola Ave", "lon": -82.4640, "lat": 28.0040},
            {"name": "Jade Simmons", "address": "1210 W Henry Ave", "lon": -82.4900, "lat": 27.9860},
            {"name": "Walter Briggs", "address": "7402 N Boulevard", "lon": -82.4750, "lat": 28.0180},
        ],
    },
    {
        "id": "run-c",
        "label": "Ybor / East",
        "driver": "Devon K.",
        "stops": [
            {"name": "Maria Castellanos", "address": "1810 E 7th Ave", "lon": -82.4370, "lat": 27.9600},
            {"name": "Andre Wilson", "address": "3402 N 29th St", "lon": -82.4190, "lat": 27.9760},
            {"name": "Sofia Reyes", "address": "645 S 22nd St", "lon": -82.4330, "lat": 27.9350},
        ],
    },
]


def fetch_leg(a, b):
    url = (
        "https://router.project-osrm.org/route/v1/driving/"
        f"{a['lon']},{a['lat']};{b['lon']},{b['lat']}"
        "?overview=full&geometries=geojson&steps=false"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "manifest-demo-precompute/1.0 (one-time build step)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.load(r)
    if data.get("code") != "Ok" or not data.get("routes"):
        raise RuntimeError(f"OSRM error for {a['name']}->{b['name']}: {data.get('code')}")
    route = data["routes"][0]
    return {
        "distance_m": round(route["distance"]),
        "duration_s": round(route["duration"]),
        "coords": [[round(lon, 5), round(lat, 5)] for lon, lat in route["geometry"]["coordinates"]],
    }


def main():
    out = {"depot": DEPOT, "runs": []}
    for run in RUNS:
        waypoints = [DEPOT] + run["stops"] + [DEPOT]
        legs = []
        for a, b in zip(waypoints, waypoints[1:]):
            leg = fetch_leg(a, b)
            leg["from"] = a["name"]
            leg["to"] = b["name"]
            legs.append(leg)
            print(f"{run['id']}: {a['name']} -> {b['name']}  {leg['distance_m']}m {leg['duration_s']}s", flush=True)
            time.sleep(1.2)
        out["runs"].append({**run, "legs": legs})
    with open("routes.json", "w") as f:
        json.dump(out, f)
    total = sum(len(r["legs"]) for r in out["runs"])
    print(f"WROTE routes.json ({total} legs)")


if __name__ == "__main__":
    main()
