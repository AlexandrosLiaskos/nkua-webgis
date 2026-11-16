"""Apply the supplied MTBS DBF encoding to prepared text, preserving geometries."""
import gzip
import json
import sys
from collection import REPO, clean, write_json, render_shell
sys.path.insert(0,str(REPO.parent/'research/2026-09-07-landslides/python-packages'))
import shapefile

site=REPO/'sites/wildfires'
reader=shapefile.Reader(str(REPO.parent/'research/2026-09-07-wildfires/mtbs/mtbs_perims_DD.shp'),encoding='iso_8859_1')
attributes=list(reader.iterRecords())
with gzip.open(site/'data/catalogue.json.gz','rt',encoding='utf-8') as f:
    catalogue=json.load(f)
rows=catalogue['records']
mtbs_index=0
for offset in range(0,len(rows),250):
    part=rows[offset:offset+250]
    if not any(r['source']=='mtbs' for r in part):
        continue
    path=site/f'data/records/{offset//250}.json.gz'
    with gzip.open(path,'rt',encoding='utf-8') as f:
        details=json.load(f)
    for r in part:
        if r['source']!='mtbs':continue
        a=attributes[mtbs_index].as_dict();mtbs_index+=1
        r['name']=clean(a.get('incid_name')).title() or ('Burned area '+r['nativeId'])
        r['fireType']=clean(a.get('incid_type'));r['assessment']=clean(a.get('asmnt_type'))
        details[r['id']]['attributes']=a;details[r['id']]['note']=clean(a.get('comment'))
    write_json(path,details)
write_json(site/'data/catalogue.json.gz',catalogue)
config=json.loads((site/'data/manifest.json').read_text(encoding='utf-8'))
config['definitionUrl']='https://www.nps.gov/subjects/fire/types-of-wildland-fire.htm'
config['definitionSource']='National Park Service — Types of Wildland Fire'
config['methods']+=' MTBS text uses the ISO-8859-1 encoding declared in its accompanying CPG file.'
write_json(site/'data/manifest.json',config)
render_shell(config,site)
print('Restored provider-declared text encoding for',mtbs_index,'MTBS records; geometries retained.',flush=True)
