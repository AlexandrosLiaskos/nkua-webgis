"""Archive the explicitly scoped USGS significant-earthquake query."""
import json
import urllib.parse
import urllib.request
from collection import REPO

out=REPO.parent/'research/2026-09-07-earthquakes'
out.mkdir(parents=True,exist_ok=True)
for year in range(1900,2027,10):
    stop=f'{year+10}-01-01' if year+10<2027 else '2026-09-07T00:00:00'
    params=dict(format='geojson',starttime=f'{year}-01-01',endtime=stop,minsig=600,eventtype='earthquake',orderby='time-asc',limit=20000)
    url='https://earthquake.usgs.gov/fdsnws/event/1/query?'+urllib.parse.urlencode(params)
    target=out/f'usgs-{year}.json'
    if not target.exists():
        with urllib.request.urlopen(url,timeout=90) as response:
            data=response.read()
        json.loads(data)
        target.write_bytes(data)
    print(year,'archived',flush=True)
