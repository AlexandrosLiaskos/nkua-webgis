"""Download the complete public perimeter archives, without requesting email delivery."""
import shutil
import urllib.request
import zipfile
from collection import REPO

out=REPO.parent/'research/2026-09-07-wildfires'
out.mkdir(parents=True,exist_ok=True)
sources=[
 ('effis-current-burned-areas.zip','effis','https://maps.effis.emergency.copernicus.eu/effis?outputformat=SHAPEZIP&request=getfeature&service=WFS&typename=ms%3Amodis.ba.poly&version=1.1.0'),
 ('mtbs_perimeter_data.zip','mtbs','https://edcintl.cr.usgs.gov/downloads/sciweb1/shared/MTBS_Fire/data/composite_data/burned_area_extent_shapefile/mtbs_perimeter_data.zip')]
for name,folder,url in sources:
    target=out/name
    if not target.exists():
        temporary=target.with_suffix('.part')
        with urllib.request.urlopen(url,timeout=180) as response,temporary.open('wb') as handle:
            shutil.copyfileobj(response,handle)
        temporary.replace(target)
    with zipfile.ZipFile(target) as archive:
        for member in archive.infolist():
            destination=(out/folder/member.filename).resolve()
            if not destination.is_relative_to((out/folder).resolve()):
                raise RuntimeError('Archive entry escapes the acquisition folder')
        archive.extractall(out/folder)
    print(name,'archived and extracted',flush=True)
