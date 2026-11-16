import csv
import json
from pathlib import Path
from collection import REPO, clean, date_label, field, number, prepare

RAW = REPO.parent / 'research/2026-09-07-tsunamis'
BASE = 'https://www.ngdc.noaa.gov/hazel/view/hazards/tsunami/'
noaa_citation = 'NCEI / World Data Service: Global Historical Tsunami Database. NOAA National Centers for Environmental Information. DOI: 10.7289/V5PN93H7. Accessed 7 September 2026.'
sources = [
    dict(id='noaa-events',label='NOAA events',name='NOAA Global Historical Tsunami Database — events',provider='NOAA NCEI / World Data Service',color='#1e3a5f',citation=noaa_citation,license='NOAA public data; cite NCEI/WDS and the contributing references. Third-party source material retains its own rights.',url='https://www.ncei.noaa.gov/products/natural-hazards/tsunamis-earthquakes-volcanoes/tsunamis',note='Complete published event layer acquired on 7 September 2026. Historical reporting is uneven. Validity classes include doubtful and erroneous reports; these are preserved explicitly, not presented as independently confirmed events.'),
    dict(id='noaa-observations',label='NOAA observations',name='NOAA Global Historical Tsunami Database — coastal observations',provider='NOAA NCEI / World Data Service',color='#9a642b',citation=noaa_citation,license='NOAA public data; cite NCEI/WDS and the contributing references. Third-party source material retains its own rights.',url='https://noaa.maps.arcgis.com/home/item.html?id=33d29de9e6c34c44ab087d78c15e05d7',note='Complete published observation layer. A coastal measurement is not another tsunami. TSEVENT_ID links observations to the source event. Measurements include different instruments and field-survey methods.'),
    dict(id='greek-impact',label='Greek impact database',name='Greek Tsunami Impact Database 1800–2020',provider='Ioanna Triantafyllou; Gerassimos Papadopoulos',color='#0d9488',citation='Triantafyllou, I. and Papadopoulos, G. (2023). Greek Tsunami Impact Database 1800–2020, v1. Zenodo. DOI: 10.5281/zenodo.10199521.',license='CC BY 4.0. Changes: column normalization, explicit missing values and display coordinates; original attributes retained.',url='https://zenodo.org/records/10199521',note='Peer-reviewed studies and historical sources underpin the impact descriptions. The repository description mentions 16 events, but the downloadable CSV contains 15 populated event rows; blank rows are excluded. Reliability is the provider’s classification. Zero earthquake magnitudes for gravitative marine slides are not measured magnitudes.')
]
rows, details, events = [], {}, {}
for layer in ['events','observations']:
    raw = json.loads((RAW / (layer+'.json')).read_text(encoding='utf-8'))
    for feature in raw['features']:
        a = feature['attributes']; native = str(a['ID']); is_event = layer == 'events'
        event_id = native if is_event else str(a.get('TSEVENT_ID') or '')
        origin = a if is_event else events.get(event_id, {})
        if is_event:
            events[native] = a
        rid = ('noaa-event-' if is_event else 'noaa-observation-') + native
        r = dict(id=rid,nativeId=native,name=clean(a.get('LOCATION_NAME')) or ('Tsunami '+native),country=clean(a.get('COUNTRY')).title(),date=date_label(a.get('YEAR'),a.get('MONTH'),a.get('DAY')),year=number(a.get('YEAR')),source='noaa-'+layer,kind='Event origin' if is_event else 'Coastal observation',eventId='noaa-event-'+event_id if event_id else '',lat=number(a.get('LATITUDE')),lon=number(a.get('LONGITUDE')),cause=clean(origin.get('CAUSE')),validity=clean(origin.get('EVENT_VALIDITY')),measurementType=clean(a.get('TYPE_MEASUREMENT')),doubtful=('Flagged doubtful' if a.get('DOUBTFUL') in ['Y','y',1,True] else 'Not flagged by source') if not is_event else None)
        r.update(waterHeight=number(a.get('RUNUP_HT')),eventMaxHeight=number(a.get('MAX_EVENT_RUNUP'),True),inundation=number(a.get('RUNUP_HORIZ'),True),distance=number(a.get('DIST_FROM_SOURCE'),True),magnitudeMw=number(a.get('EQ_MAG_MW')) if is_event else None,depth=number(a.get('EQ_DEPTH'),True) if is_event else None,deaths=number(a.get('DEATHS'),True),injuries=number(a.get('INJURIES'),True),housesDestroyed=number(a.get('HOUSES_DESTROYED'),True),period=number(a.get('PERIOD'),True))
        hours, minutes = number(a.get('TRAV_HOURS'),True), number(a.get('TRAV_MINS'),True)
        r['travelMinutes'] = hours*60 + minutes if hours is not None and minutes is not None else None
        details[rid] = dict(attributes=a,geometry={'type':'Point','coordinates':[r['lon'],r['lat']]} if r['lon'] is not None and r['lat'] is not None else None,url=BASE+('event-more-info/' if is_event else 'runup-more-info/')+native,note=clean(a.get('COMMENTS')),geometryNote='Reported source-event location; not an inundated area.' if is_event else 'Reported coastal observation location. Consult the measurement type and source notes for interpretation.')
        rows.append(r)

with (RAW/'greek-impact.csv').open(encoding='utf-8-sig',newline='') as f:
    for a in csv.DictReader(f,delimiter=';'):
        a={str(k).strip():v for k,v in a.items() if k is not None}
        year=number(a.get('Year'))
        if year is None:
            continue
        date=date_label(year,number(a.get('Month')),number(a.get('Day')))
        rid='greek-impact-'+date
        r=dict(id=rid,nativeId=date,name=clean(a.get('Source subregion')) or clean(a.get('Region')),country='Greece',date=date,year=year,source='greek-impact',kind='Regional impact record',eventId=rid,lat=number(a.get('Latitude (N)')),lon=number(a.get('Longitude (E)')),cause={'ER':'Earthquake','EL':'Earthquake and landslide','ES':'Earthquake and marine slide','GS':'Gravitative marine slide'}.get(a.get('Source type'),clean(a.get('Source type'))),validity='Greek reliability class '+clean(a.get('Rel')),magnitudeMw=number(a.get('Mw')),depth=number(a.get('Depth'),True),greekIntensity=number(a.get('K')),deaths=number(a.get('Fatalities'),True),injuries=number(a.get('Injuries'),True))
        if r['magnitudeMw'] == 0:
            r['magnitudeMw']=None
        if a.get('Source type') == 'GS':
            r['depth']=None
        note=' '.join(clean(a.get(k)) for k in ['Short description','Other damage','Ref for tsunami impact'] if a.get(k))
        details[rid]=dict(attributes=a,geometry={'type':'Point','coordinates':[r['lon'],r['lat']]},url='https://zenodo.org/records/10199521',note=note,geometryNote='Provider’s source coordinates, usually the earthquake epicentre or marine-slide location. Impacts may occur at several coastal sites. Greek and NOAA source records are preserved separately where no shared identifier is provided.')
        rows.append(r)

config=dict(slug='tsunamis',title='Tsunamis',singular='tsunami',sources=sources,
    intro='Explore tsunami sources, coastal observations and documented impacts through maps, filters, search and statistics.',
    coverage='NOAA global historical event and observation layers, plus the Greek impact catalogue for 1800–2020. This is a dated research snapshot.',
    countNote='Counts describe source records. One tsunami can have many coastal observations and multiple historical accounts. NOAA event IDs link documented observations; Greek reports retain their own identity when there is no shared identifier. Records without coordinates remain searchable and included in relevant statistics.',
    statisticsNote='Statistics describe filtered source records, not independent disasters or a globally complete hazard frequency. Select a record type or source before interpreting distributions. Event maxima and local water heights are separate variables. Missing values and qualitative casualty ranges are excluded from numerical calculations; they are never treated as zero. Negative years denote BCE using the source year convention.',
    measurementNote='Reported water heights may use different measurement types and reference levels. Event and local impact figures must not be added together. Counts of casualties are source reports; unknown counts remain blank. Moment magnitude and Greek tsunami intensity use distinct scales.',
    methods='The complete NOAA feature layers were downloaded in stable object-ID order with pagination. Stable NOAA ID and TSEVENT_ID fields supply provenance and event–observation links. Original text, classifications and coordinates are preserved. Greek blank rows and zero magnitude placeholders are excluded from numerical measures. No proximity-based merges or invented inundation polygons are made.',
    definition='A tsunami is a series of long waves produced when a large volume of water is displaced abruptly, often by an earthquake, volcanic activity or a landslide. The waves can travel across an ocean and flood coastlines.',
    definitionUrl='https://tsunami.noaa.gov/tsunami-story',definitionSource='NOAA — The Tsunami Story',
    diagramAlt='Schematic cross-section showing a seafloor disturbance generating long waves that propagate towards a shallow coast.',
    diagramCaption='From a sudden water displacement to coastal flooding. Schematic cross-section; not to scale.',
    diagram='''<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700" viewBox="0 0 1200 700"><rect width="1200" height="700" fill="#f5f4ef"/><path d="M0 300H1030V590H0Z" fill="#c6dde6"/><path d="M0 555H340L420 520L550 555H740L1000 340L1100 280H1200V700H0Z" fill="#b8ad99"/><path d="M0 300Q100 278 200 300T400 300T600 300Q690 275 760 300Q810 330 850 290Q900 230 950 300Q980 332 1010 300" fill="none" stroke="#1e3a5f" stroke-width="8"/><path d="M400 530V410m-18 22 18-22 18 22M610 220H760m-22-16 22 16-22 16" fill="none" stroke="#1e3a5f" stroke-width="5"/><g font-family="Georgia,serif" fill="#172735"><text x="70" y="100" font-size="50">How a tsunami travels</text><text x="255" y="650" font-size="29">Sudden displacement</text><text x="525" y="180" font-size="29">Long waves cross the ocean</text><text x="930" y="200" font-size="29">Shallow coast</text></g></svg>''',
    fields=[
        field('waterHeight','Observed water height','Source-reported height at a coastal observation. Measurement types and vertical reference levels vary; use the measurement-type filter. Negative readings are retained.','m',scale='linear'),
        field('eventMaxHeight','Event maximum water height','Maximum reported water height in the NOAA event record. Kept separate from individual observations.','m'),
        field('inundation','Horizontal inundation distance','Reported horizontal extent of coastal inundation at the observation site. Missing values are excluded.','m'),
        field('travelMinutes','Observed travel time','Source travel hours and minutes converted to minutes when both components are supplied. Partial travel times remain in original attributes. This is an observation, not a new modelled arrival time.','min'),
        field('distance','Distance from source','Source-reported distance between the tsunami source and coastal observation.','km'),
        field('period','Reported wave period','Period reported at the observation; source measurement conventions apply.','min'),
        field('magnitudeMw','Source earthquake moment magnitude','Moment magnitude Mw only. Other magnitude scales remain in original attributes. Zero placeholders in the Greek slide records are excluded.',scale='linear'),
        field('depth','Source earthquake depth','Provider-reported earthquake depth. Not a water depth. Greek non-earthquake zero placeholders are excluded.','km'),
        field('greekIntensity','Greek tsunami intensity','Papadopoulos–Imamura 12-grade tsunami intensity from the Greek impact database only. Not earthquake intensity.',scale='linear'),
        field('deaths','Reported deaths','Numerical death counts as attributed by each source at its event or site scale. Never sum event counts with local counts or overlapping sources.','people'),
        field('injuries','Reported injuries','Numerical injury counts; qualitative reports remain in original attributes.','people'),
        field('year','Reported year','Year recorded by the provider. Negative years denote BCE. Reporting changes over time; this is not a hazard trend.',scale='linear',group='Chronology'),
        field('country','Country','Country named by the source, normalized to title case.',categorical=True,group='Location'),
        field('source','Source collection','Agency or research collection providing the record.',categorical=True),
        field('kind','Record type','An event origin, coastal observation or regional impact account.',categorical=True),
        field('cause','Reported cause','Cause from the event provider; coastal observations inherit the linked NOAA event cause.',categorical=True),
        field('validity','Provider validity classification','NOAA event validity and Greek reliability retain separate terminology. These are provider assessments, not NKUA verification.',categorical=True),
        field('measurementType','Measurement type','NOAA observation method, such as tide gauge or field survey.',categorical=True),
        field('doubtful','Observation doubt flag','NOAA observation-specific doubt flag. Not flagged does not establish independent validation.',categorical=True)
    ])
prepare(config,rows,details)
