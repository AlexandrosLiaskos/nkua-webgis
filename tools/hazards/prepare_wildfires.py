import json
import calendar
import logging
import sys
from datetime import date
from collection import REPO, clean, field, number, prepare, write_json
sys.path.insert(0, str(REPO.parent / 'research/2026-09-07-landslides/python-packages'))
import shapefile
from shapely.geometry import shape, mapping
from shapely.ops import transform
from pyproj import CRS, Transformer, Geod

RAW = REPO.parent / 'research/2026-09-07-wildfires'
SITE = REPO / 'sites/wildfires'
logging.getLogger('shapefile').setLevel(logging.ERROR)
geod = Geod(ellps='WGS84')
countries = dict(AL='Albania',AT='Austria',BA='Bosnia and Herzegovina',BE='Belgium',BG='Bulgaria',BY='Belarus',CH='Switzerland',CY='Cyprus',CZ='Czechia',DE='Germany',DK='Denmark',DZ='Algeria',EE='Estonia',EG='Egypt',ES='Spain',FI='Finland',FR='France',GB='United Kingdom',UK='United Kingdom',GE='Georgia',GR='Greece',EL='Greece',HR='Croatia',HU='Hungary',IE='Ireland',IL='Israel',IQ='Iraq',IR='Iran',IS='Iceland',IT='Italy',JO='Jordan',LB='Lebanon',LI='Liechtenstein',LT='Lithuania',LU='Luxembourg',LV='Latvia',LY='Libya',MA='Morocco',MD='Moldova',ME='Montenegro',MK='North Macedonia',MT='Malta',NL='Netherlands',NO='Norway',PL='Poland',PT='Portugal',RO='Romania',RS='Serbia',RU='Russia',SE='Sweden',SI='Slovenia',SK='Slovakia',SY='Syria',TN='Tunisia',TR='Türkiye',UA='Ukraine',XK='Kosovo',PS='Palestine',SA='Saudi Arabia')
sources=[
    dict(id='effis',label='EFFIS',name='EFFIS Rapid Damage Assessment — burned areas',provider='European Commission Joint Research Centre / Copernicus EMS',color='#9a642b',citation='European Commission, Joint Research Centre. European Forest Fire Information System (EFFIS), Rapid Damage Assessment burned-area polygons, WFS modis.ba.poly. Downloaded 7 September 2026.',license='CC BY 4.0, European Union. Changes: display anchors, normalized attributes and derived geometry measurements. Original source attributes retained.',url='https://forest-fire.emergency.copernicus.eu/applications/data-and-services',note='Complete publicly downloadable WFS boundary archive at acquisition. Coverage is primarily Europe, the Middle East and North Africa. Mapped boundaries and detection dates can be revised; coverage is limited by sensor resolution, monitoring methods and available imagery. These are burned-area observations, not a complete census of ignitions.'),
    dict(id='mtbs',label='USGS / USFS MTBS',name='Monitoring Trends in Burn Severity — national burned-area boundaries',provider='U.S. Geological Survey / USDA Forest Service',color='#1e3a5f',citation='U.S. Geological Survey and USDA Forest Service (2026). Monitoring Trends in Burn Severity Burned Areas Boundaries for 1984–2026. Metadata publication date 6 September 2026. Downloaded 7 September 2026.',license='U.S. federal public data. Credit USGS, USDA Forest Service and MTBS. The derived GeoJSON uses WGS84; original NAD83 shapefiles remain available from the provider.',url='https://burnseverity.cr.usgs.gov/direct-download',note='Complete published national perimeter archive. Includes wildfires and prescribed fires, with the original fire type retained. Monitoring targets fires larger than 1,000 acres in the western U.S. and 500 acres in the eastern U.S.; omitted or unmappable burns and smaller fires prevent complete occurrence coverage.')
]
rows, shard, invalid, duplicates = [], {}, 0, 0
seen=set()
for source, filename in [('effis', RAW/'effis/modis.ba.poly.shp'),('mtbs', RAW/'mtbs/mtbs_perims_DD.shp')]:
    crs=CRS.from_wkt(filename.with_suffix('.prj').read_text())
    transformer=Transformer.from_crs(crs,4326,always_xy=True)
    reader=shapefile.Reader(str(filename),encoding='utf-8' if source=='effis' else 'iso_8859_1',encodingErrors='replace')
    for index, feature in enumerate(reader.iterShapeRecords()):
        a=feature.record.as_dict()
        native=str(a.get('id') if source=='effis' else a.get('map_id'))
        rid=source+'-'+native
        if rid in seen:
            duplicates+=1;rid+='-row-'+str(index+1)
        seen.add(rid)
        date_string=clean(a.get('FIREDATE') if source=='effis' else a.get('ig_date'))[:10]
        final=clean(a.get('FINALDATE'))[:10] if source=='effis' else ''
        year=number(date_string[:4]);month=number(date_string[5:7])
        country=countries.get(a.get('COUNTRY'),clean(a.get('COUNTRY'))) if source=='effis' else 'United States'
        locality=', '.join(dict.fromkeys(clean(a.get(k)) for k in ['COMMUNE','PROVINCE'] if clean(a.get(k)) not in ['', 'N.A.','N/A','Unknown'])) if source=='effis' else clean(a.get('incid_name')).title()
        r=dict(id=rid,nativeId=native,source=source,name=locality or ('Burned area '+native),country=country,date=date_string,year=year,month=month,kind='Burned area',fireType=clean(a.get('incid_type')) if source=='mtbs' else 'Satellite-mapped burned area',eventId=('mtbs-'+clean(a.get('event_id'))) if source=='mtbs' and a.get('event_id') else rid,assessment=clean(a.get('asmnt_type')) if source=='mtbs' else clean(a.get('CLASS')),areaHa=number(a.get('AREA_HA'),True) if source=='effis' else (number(a.get('burnbndac'),True)*0.40468564224 if number(a.get('burnbndac'),True) is not None else None),lat=None,lon=None,computedAreaHa=None,perimeter=None,intervalDays=None)
        if final and date_string:
            try:
                days=(date.fromisoformat(final)-date.fromisoformat(date_string)).days
                if days>=0:r['intervalDays']=days
            except ValueError:pass
        geometry=None
        geometry_note='Source boundary transformed from '+crs.name+' to WGS84 using pyproj. The pin is an interior display anchor, not an ignition location.'
        try:
            original=shape(feature.shape.__geo_interface__)
            geom=transform(transformer.transform,original)
            if not geom.is_empty:
                anchor=geom.representative_point();r['lat']=number(anchor.y);r['lon']=number(anchor.x)
                geometry=mapping(geom)
                if geom.is_valid and geom.geom_type in ['Polygon','MultiPolygon']:
                    parts=list(geom.geoms) if geom.geom_type=='MultiPolygon' else [geom]
                    area=perimeter=0.0
                    for poly in parts:
                        lon,lat=poly.exterior.xy;pa,pp=geod.polygon_area_perimeter(lon,lat);area+=abs(pa);perimeter+=pp
                        for ring in poly.interiors:
                            lon,lat=ring.xy;pa,pp=geod.polygon_area_perimeter(lon,lat);area-=abs(pa);perimeter+=pp
                    r['computedAreaHa']=round(area/10000,6);r['perimeter']=round(perimeter,3)
                else:
                    invalid+=1;geometry_note+=' Invalid or nonpolygon geometry: excluded from derived area and perimeter statistics; source geometry is retained.'
            else:
                invalid+=1;geometry_note+=' Empty geometry; no mapped pin or derived measurements.'
        except (ValueError,TypeError,KeyError):
            invalid+=1;geometry_note+=' Geometry could not be converted; original shapefile remains available from the provider.'
        note=clean(a.get('comment')) if source=='mtbs' else 'First and final EFFIS detection dates are observations; their interval is not a measured duration of active burning. Upstream text encoding artefacts are retained in original attributes.'
        shard[rid]=dict(attributes=a,geometry=geometry,url=sources[0 if source=='effis' else 1]['url'],note=note,geometryNote=geometry_note)
        rows.append(r)
        if len(rows)%250==0:
            write_json(SITE/f'data/records/{(len(rows)-1)//250}.json.gz',shard);shard={}
        if len(rows)%5000==0:print('wildfire boundaries prepared',len(rows),flush=True)
if shard:write_json(SITE/f'data/records/{(len(rows)-1)//250}.json.gz',shard)
years=[r['year'] for r in rows if r['year'] is not None]
config=dict(slug='wildfires',title='Wildfires',homepageTitle='Wildfires & Burned Areas',singular='wildfire',sources=sources,coverageLabel='Europe, MENA & U.S.',
    intro='Explore EFFIS and MTBS burned-area boundaries, wildfires and prescribed burns with source evidence, mapped extent and statistics.',
    coverage=f'Published source records span {min(years)}–{max(years)}. EFFIS covers its monitored regions; MTBS covers the United States. This is a dated archive, not a live fire feed.',
    countNote='Counts describe mapped source boundaries, not independently deduplicated fires. MTBS event identifiers connect related assessments. Prescribed burns remain distinct from wildfires. A pin marks an interior point of a boundary; it does not locate the ignition.',
    statisticsNote='Statistics apply to complete source records matching the filters. Differences in monitoring thresholds, resolution, coverage and fire type prevent direct interpretation as global hazard trends. Unknown values remain missing. Perimeter measurements depend on map detail. Overlapping footprints must not be summed as a unique burned area.',
    measurementNote='Reported area is kept separate from area calculated from the geometry. MTBS acres are converted using 1 acre = 0.40468564224 ha. EFFIS date intervals span detection dates, not continuous active burning. Prescribed fires are identified by their original source type.',
    methods=f'All {len(rows):,} downloaded source shapes are retained as records. Source geometries are converted to WGS84; representative points supply map anchors. Valid polygons are measured on the WGS84 ellipsoid, subtracting holes for area and including inner boundaries in perimeter. {invalid:,} invalid, empty or unsupported geometries are excluded from derived measurements. {duplicates} repeated native identifiers receive a source-row suffix while retaining their original ID. Original shapefile archives and metadata remain available at the linked providers.',
    definition='A wildfire is an unplanned fire burning in vegetation such as forests, grasslands or shrublands. A burned-area boundary maps the affected footprint. Prescribed fires are planned burns and are identified separately in this collection.',
    definitionUrl='https://www.nps.gov/subjects/fire/types-of-wildland-fire.htm',definitionSource='National Park Service — Types of Wildland Fire',
    diagramAlt='A plan-view schematic distinguishes an ignition point, a burned-area boundary and surviving unburned patches inside it.',diagramCaption='A mapped burned-area footprint can contain unburned patches. The overview pin is a display anchor. Schematic; not a real fire.',
    diagram='''<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700" viewBox="0 0 1200 700"><rect width="1200" height="700" fill="#f5f4ef"/><path d="M250 225Q340 125 470 200T700 210Q860 190 920 320T825 535Q670 625 560 520T315 490Q185 370 250 225Z" fill="#dfb689" stroke="#9a642b" stroke-width="6"/><path d="M465 280Q550 230 615 310T555 410Q455 380 465 280Z" fill="#d9e1cf" stroke="#687c59" stroke-width="3"/><circle cx="365" cy="375" r="10" fill="#1e3a5f"/><path d="M150 385H346M880 235L1050 180M580 350L1030 370" stroke="#394b54" stroke-width="3" fill="none"/><g font-family="Georgia,serif" fill="#172735"><text x="70" y="90" font-size="50">Reading a burned-area boundary</text><text x="60" y="430" font-size="27">Display anchor</text><text x="900" y="145" font-size="27">Mapped perimeter</text><text x="880" y="420" font-size="27">Unburned patch</text><text x="70" y="650" font-size="26">A map boundary does not show the ignition point or fire progression.</text></g></svg>''',
    fields=[field('areaHa','Reported burned area','Area supplied by the provider. EFFIS hectares are retained; MTBS acres are converted to hectares. Overlapping assessments are not deduplicated.','ha'),field('computedAreaHa','Measured boundary area','WGS84 ellipsoidal area of valid polygon geometry, subtracting holes. May differ from the provider’s area because of mapping and calculation methods.','ha'),field('perimeter','Mapped perimeter','Ellipsoidal length of outer and inner polygon boundaries. Depends strongly on mapping detail and fragmentation.','m'),field('intervalDays','Detection date interval','Days from first to final EFFIS detection date. Not a measured duration of continuous burning.','days'),field('year','Reported year','EFFIS first-detection year or MTBS ignition year. Different observation systems and coverage affect chronology.',scale='linear',group='Chronology'),field('month','Seasonality: reported month','Calendar month of EFFIS first detection or MTBS ignition. Coverage and source method affect seasonality. Month is categorical because the calendar is cyclic.',categorical=True,valueLabels={str(i):calendar.month_name[i] for i in range(1,13)},group='Chronology'),field('country','Country','Provider country, with EFFIS ISO codes expanded where known.',categorical=True,group='Location'),field('source','Source collection','Source agency and inventory.',categorical=True),field('fireType','Reported fire type','MTBS distinguishes wildfires from prescribed fires. EFFIS polygons do not establish an ignition cause.',categorical=True),field('assessment','Source assessment','Provider assessment type or monitoring class; these are not interchangeable quality grades.',categorical=True),field('kind','Record geometry','A mapped burned-area boundary represented by an interior display pin.',categorical=True)])
prepare(config,rows,None)
