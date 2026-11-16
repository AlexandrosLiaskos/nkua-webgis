// The submission tables, workbooks, and CSV headers are generated from these definitions.
const field = (key, label, type, description, required = false, unit = '') => ({ key, label, type, description, required, unit });
const identity = () => field('id', 'Existing record ID', 'integer', 'For a correction, copy the ID of the existing map record. Leave blank for a new record.');
const country = () => field('country', 'Country', 'text', 'Country containing the submitted site. Contributions are not limited to the current geographic coverage.', true);
const latitude = (key = 'latitude') => field(key, 'Latitude', 'latitude', 'WGS84 decimal latitude. Use a minus sign south of the equator.', true, 'degrees');
const longitude = (key = 'longitude') => field(key, 'Longitude', 'longitude', 'WGS84 decimal longitude. Use a minus sign west of Greenwich.', true, 'degrees');
const reference = (key = 'reference') => field(key, 'Supporting source', 'text', 'Traceable publication, DOI, report or source URL supporting this record. Include page or figure numbers where relevant.', true);
const notes = () => field('submission_notes', 'Submission notes', 'text', 'Explain corrections, coordinate accuracy, measurement methods, vertical datum and any uncertainty. Identify attachments here.');
const number = (key, label, description, unit = 'm') => field(key, label, 'decimal', description, false, unit);
const yesno = (key, label, description) => field(key, label, 'yesno', description + ' Enter yes or no only when established. Leave blank if unknown.');
const base = {
    recipients: ['alexliaskos@geol.uoa.gr', 'evelpidou@geol.uoa.gr'],
    instructions: [
        'Enter one record per row in the Data sheet. Keep the column headers unchanged. The Field guide describes every column.',
        'Required fields are identified in the Field guide and on the website. Optional measurements and classifications may remain blank.',
        'Use the existing map ID for corrections and explain the change in submission_notes. Leave the ID blank for new records.',
        'Leave unknown values blank. Do not replace missing information with zero, a dash, nan or an invented value.',
        'Enter coordinates as WGS84 decimal degrees. Keep latitude and longitude in their separate columns.',
        'Enter numeric measurements without unit text. The Field guide states the unit for each measurement.',
        'Attach supporting publications, source links and any geometry or photographs identified in submission_notes. State the reuse permission for attachments.',
        'The examples in the Field guide come from an existing record and are guidance only. The Data sheet is intentionally empty.',
        'Email the completed XLSX or the Data sheet exported as UTF-8 CSV. Include contributor names, affiliation and a contact email. Attachments are added manually in your email application.',
        'The research team reviews submissions before publication. Sending an email does not automatically add a record to the map.'
    ]
};

export const submissions = [
    {
        ...base, site: 'lagoons', name: 'Coastal Lagoons', template: 'lagoons-data-template', lang: 'en',
        intro: 'Submit a new coastal lagoon or a correction to an existing record. Include its location and supporting source. Add documented measurements and inundation assessments where available.',
        notes: [
            'Perimeter is measured in kilometres, despite the historical column name perimeter_km2. Area is measured in square kilometres.',
            'The scenario fields describe projections for 2100 under SSP1-2.6 and SSP5-8.5. The vec fields include vertical land movement. Supply the assessment source and method in submission_notes.',
            'Do not infer inundation from a single elevation value. Leave assessment fields blank when no documented assessment is available.',
            'Boundary geometry can be supplied as an additional GeoJSON file in WGS84, linked to the lagoon name or existing record ID.'
        ],
        fields: [
            identity(), field('name_en', 'Lagoon name', 'text', 'Lagoon name in English or its established international spelling.', true), country(),
            field('location_en', 'Administrative area or locality', 'text', 'Administrative area or nearest locality in English.', true),
            latitude('centroid_lat'), longitude('centroid_lng'), reference('source'),
            field('name_gr', 'Greek name', 'text', 'Greek name where applicable.'), field('island_en', 'Island', 'text', 'Island name where applicable. Leave blank for a mainland site.'),
            number('length_m', 'Length', 'Measured lagoon length.'), number('width_m', 'Width', 'Measured lagoon width.'),
            number('height_m', 'Height', 'Reported height used in the lagoon assessment. State the measured feature, method and vertical datum in submission_notes.'),
            number('perimeter_km2', 'Perimeter', 'Lagoon perimeter in kilometres. This column name is retained to match the catalogue.', 'km'),
            number('area_km2', 'Area', 'Lagoon surface area.', 'km²'),
            number('rcp2_6_slr', 'SSP1-2.6 sea level rise', 'Projected sea level rise by 2100 under SSP1-2.6.'),
            number('rcp8_5_slr', 'SSP5-8.5 sea level rise', 'Projected sea level rise by 2100 under SSP5-8.5.'),
            number('rcp2_6_vec_slr', 'SSP1-2.6 with land movement', 'Projected relative sea level rise by 2100 including vertical land movement.'),
            number('rcp8_5_vec_slr', 'SSP5-8.5 with land movement', 'Projected relative sea level rise by 2100 including vertical land movement.'),
            yesno('rcp2_6_inundated', 'SSP1-2.6 inundation', 'Documented inundation assessment for 2100 under SSP1-2.6.'),
            yesno('rcp8_5_inundated', 'SSP5-8.5 inundation', 'Documented inundation assessment for 2100 under SSP5-8.5.'),
            yesno('rcp2_6_vec_inundated', 'SSP1-2.6 inundation with land movement', 'Inundation assessment including vertical land movement.'),
            yesno('rcp8_5_vec_inundated', 'SSP5-8.5 inundation with land movement', 'Inundation assessment including vertical land movement.'),
            notes()
        ]
    },
    {
        ...base, site: 'beachrocks', name: 'Beachrocks', template: 'beachrocks-data-template', lang: 'en',
        intro: 'Submit a beachrock occurrence or a correction supported by a scientific source. Use one row per occurrence and source. Describe location accuracy and retain the terminology used in the cited study.',
        notes: [
            'Keep reported altitude, tidal range and water table values together with their units and vertical reference. Preserve reported ranges rather than inventing a single value.',
            'For ages, retain the reported uncertainty, unit, dating convention and calibration information. Record the dated material and method separately.',
            'Use reported mineralogy and formation interpretations. Leave unreported properties blank. The field area describes a locality, not a measured surface area.'
        ],
        fields: [
            identity(), field('site', 'Site', 'text', 'Name of the beachrock occurrence or site.', true), country(), latitude(), longitude(), reference(),
            field('record_no', 'Source record number', 'text', 'Identifier used in the source inventory, where available. This is separate from the website ID.'),
            field('area', 'Locality', 'text', 'Island, region or locality containing the occurrence. This is a place name.'),
            field('ocean_sea', 'Ocean or sea', 'text', 'Named ocean or sea adjoining the site.'),
            field('pos_type', 'Position accuracy', 'text', 'Describe whether the position was measured or approximated from a source map or locality.'),
            field('maximum_altitude', 'Maximum altitude', 'text', 'Reported upper elevation, including unit, datum and uncertainty.'),
            field('minimum_altitude', 'Minimum altitude', 'text', 'Reported lower elevation, including unit, datum and uncertainty.'),
            field('no_of_slabs', 'Number of slabs', 'integer', 'Number of distinct slabs reported at the occurrence.'),
            field('tidal_range', 'Tidal range', 'text', 'Reported tidal range, including unit and the tidal reference where stated.'),
            field('main_composition', 'Sediment composition', 'text', 'Main sediment or clast composition reported by the source.'),
            field('cement_type', 'Cement mineralogy', 'text', 'Reported cement mineralogy. Preserve the source terminology and explain abbreviations in submission_notes.'),
            field('cement_microstructure', 'Cement microstructure', 'text', 'Reported cement texture or microstructure.'),
            field('formation_process', 'Formation process', 'text', 'Formation process or mechanism reported by the cited study.'),
            field('formation_location', 'Formation environment', 'text', 'Reported coastal or tidal zone of formation.'),
            field('water_table', 'Water table', 'text', 'Reported water table position or behaviour, including units where relevant.'),
            field('dating_method', 'Dating method', 'text', 'Method used to date the material. Preserve the reported method.'),
            field('dated_sample', 'Dated material', 'text', 'Sample or material dated by the cited study.'),
            field('estimated_age', 'Reported age', 'text', 'Reported age, unit, uncertainty and calibration or reference convention. Do not convert an age to a publication year.'),
            field('publication_year', 'Publication year', 'integer', 'Year of publication of the supporting study.'),
            notes()
        ]
    },
    {
        ...base, site: 'tombolos', name: 'Tombolos', template: 'tombolos-data-template', lang: 'en',
        intro: 'Submit a tombolo or a correction to an existing landform. Include its location and supporting source, then add documented dimensions, connection type and submergence assessments.',
        notes: [
            'Use the local administrative area in prefecture_en. Submissions may cover countries beyond the current dataset.',
            'Document the vertical datum and the distinction between height and elevation in submission_notes. Do not interchange these measurements.',
            'RCP 2.6 and RCP 8.5 fields describe assessments for 2100. Keep present submergence separate from projected submergence and provide the source of the assessment.',
            'Boundary geometry can be attached as GeoJSON in WGS84, linked to the landform name or existing record ID.'
        ],
        fields: [
            identity(), field('name_en', 'Tombolo name', 'text', 'Landform name in English or its established international spelling.', true), country(),
            field('prefecture_en', 'Administrative area', 'text', 'Prefecture, region or equivalent administrative area in English.', true), latitude(), longitude(), reference(),
            field('name_gr', 'Greek name', 'text', 'Greek name where applicable.'),
            field('prefecture_gr', 'Greek administrative name', 'text', 'Greek administrative area name where applicable.'),
            field('island_en', 'Island or mainland', 'text', 'Name of the island or mainland containing the site.'),
            field('island_gr', 'Greek island name', 'text', 'Greek island name where applicable.'),
            number('length_m', 'Length', 'Measured tombolo length.'), number('width_tombolo_m', 'Tombolo width', 'Measured width of the connecting landform.'),
            number('width_continent_m', 'Mainland side width', 'Measured width at the mainland side where applicable.'),
            number('width_island_m', 'Island side width', 'Measured width at the island side where applicable.'),
            number('height_m', 'Height', 'Reported landform height. State its reference in submission_notes.'),
            number('elevation', 'Elevation', 'Reported landform elevation. State its vertical datum in submission_notes.'),
            field('tombolo_type', 'Type', 'text', 'Reported morphological type. Preserve the classification used by the supporting study.'),
            field('tombolo_category', 'Connection category', 'text', 'Reported coastal connection category. Explain codes and their source in submission_notes.'),
            yesno('submerged', 'Currently submerged', 'Present submergence documented at the observation date.'),
            yesno('sub_rcp26', 'RCP 2.6 submergence', 'Projected submergence by 2100 under RCP 2.6.'),
            yesno('sub_rcp85', 'RCP 8.5 submergence', 'Projected submergence by 2100 under RCP 8.5.'),
            number('elevation_rcp26', 'RCP 2.6 elevation', 'Projected relative elevation in 2100 under RCP 2.6. Negative values are valid.'),
            number('elevation_rcp85', 'RCP 8.5 elevation', 'Projected relative elevation in 2100 under RCP 8.5. Negative values are valid.'),
            notes()
        ]
    },
    {
        ...base, site: 'floods', name: 'Historic Floods', template: 'floods-data-template', lang: 'en',
        intro: 'Submit a historic flood event or correct an existing record. Use one row per affected location and event date, with a traceable source and documented impacts.',
        notes: [
            'Enter historic dates as YYYY-MM-DD text so dates before 1900 are preserved in Excel.',
            'Do not invent a day or month when the source gives only a year. Describe an uncertain date in submission_notes so the team can assess it.',
            'A blank death toll means unknown. Enter zero only when the source explicitly records no fatalities.',
            'Keep rainfall duration and rainfall height separate. Retain the reported units, period and any ranges or uncertainty.',
            'Place names may use their normal spelling. Uppercase text is not required.'
        ],
        fields: [
            identity(), field('date_of_commencement', 'Event start date', 'date-text', 'Documented start date as YYYY-MM-DD text, including dates before 1900. If the exact date is uncertain, explain the documented date in submission_notes.', true), country(),
            field('location_name', 'Administrative area or locality', 'text', 'Administrative area or locality affected by the flood.', true),
            field('flood_event_name', 'Affected place or event', 'text', 'Specific affected settlement, site or recognised event name.', true),
            latitude(), longitude(), reference('source'),
            field('deaths_toll_int', 'Recorded fatalities', 'integer', 'Number of recorded deaths. Blank means unknown. Zero means explicitly none.'),
            field('cause_of_flood', 'Reported cause', 'text', 'Cause of the flood as documented by the source.'),
            field('rainfall_duration', 'Rainfall duration', 'text', 'Reported duration including its unit, such as hours or days.'),
            field('rainfall_height', 'Rainfall amount', 'text', 'Reported precipitation depth including unit and measurement period.'),
            field('relevant_information', 'Documented impacts', 'text', 'Recorded damage, affected infrastructure and other relevant event details.'), notes()
        ]
    },
    {
        ...base, site: 'Κακοκαιρία-Φεβ-2026', name: 'Παράκτιες επιπτώσεις Φεβρουαρίου 2026', template: 'storm-events-data-template', lang: 'el',
        intro: 'Υποβάλετε νέο παράκτιο συμβάν ή διόρθωση για την κακοκαιρία του Φεβρουαρίου 2026 στην Ελλάδα. Χρησιμοποιήστε μία γραμμή ανά θέση και ημερομηνία συμβάντος, με τεκμηρίωση των επιπτώσεων.',
        instructions: [
            'Συμπληρώστε μία εγγραφή ανά γραμμή στο φύλλο Data, χωρίς αλλαγή των κεφαλίδων. Το Field guide περιγράφει κάθε στήλη.',
            'Τα υποχρεωτικά πεδία επισημαίνονται στον οδηγό πεδίων. Αφήστε κενές τις άγνωστες προαιρετικές τιμές.',
            'Για διόρθωση, συμπληρώστε το υπάρχον ID του χάρτη και εξηγήστε την αλλαγή στο submission_notes. Για νέο συμβάν αφήστε το ID κενό.',
            'Οι συντεταγμένες δίνονται σε δεκαδικές μοίρες WGS84. Μην αντικαθιστάτε άγνωστες τιμές με μηδέν, παύλα ή nan.',
            'Τα παραδείγματα του Field guide αφορούν υπάρχουσα εγγραφή και δεν υποβάλλονται ως νέα δεδομένα. Το φύλλο Data είναι κενό.',
            'Επισυνάψτε το συμπληρωμένο XLSX ή εξαγάγετε μόνο το Data ως CSV UTF-8. Προσθέστε ονόματα συντελεστών, φορέα, email επικοινωνίας και τις πηγές σας.',
            'Οι φωτογραφίες και οι αποφάσεις επισυνάπτονται χειροκίνητα στο email. Αναφέρετε τον δημιουργό και την άδεια επαναχρησιμοποίησης.',
            'Η ερευνητική ομάδα εξετάζει τις υποβολές πριν από τη δημοσίευση. Η αποστολή email δεν προσθέτει αυτόματα εγγραφή στον χάρτη.'
        ],
        notes: [
            'Η ημερομηνία συμβάντος διαφέρει από την ημερομηνία κήρυξης έκτακτης ανάγκης. Συμπληρώστε τις χωριστά και μόνο όταν τεκμηριώνονται.',
            'Συμπληρώστε έναν επαληθεύσιμο σύνδεσμο ή παραπομπή στο reference. Αν υπάρχει απόφαση, προσθέστε τον ακριβή κωδικό ΑΔΑ και τον φορέα της.',
            'Η ένδειξη Natura 2000 δηλώνει χωρική ένταξη σε προστατευόμενη περιοχή. Δεν αποτελεί αριθμό θυμάτων ή βαθμό σοβαρότητας.',
            'Χρησιμοποιήστε YES ή NO για το natura_flag μόνο με διαθέσιμη τεκμηρίωση. Η άγνωστη χωρική σχέση παραμένει κενή.'
        ],
        fields: [
            field('id', 'Υπάρχον ID', 'integer', 'ID της εγγραφής στον χάρτη μόνο για διόρθωση. Κενό για νέο συμβάν.'),
            field('date_of_commencement', 'Ημερομηνία συμβάντος', 'date', 'Τεκμηριωμένη ημερομηνία παράκτιων επιπτώσεων τον Φεβρουάριο 2026, σε μορφή YYYY-MM-DD.', true),
            field('location_name', 'Παράκτια θέση', 'text', 'Συγκεκριμένο παράκτιο μέτωπο, οικισμός ή θέση που επλήγη.', true),
            field('latitude', 'Γεωγραφικό πλάτος', 'latitude', 'Γεωγραφικό πλάτος σε δεκαδικές μοίρες WGS84.', true, 'μοίρες'),
            field('longitude', 'Γεωγραφικό μήκος', 'longitude', 'Γεωγραφικό μήκος σε δεκαδικές μοίρες WGS84.', true, 'μοίρες'),
            field('damage_description', 'Περιγραφή επιπτώσεων', 'text', 'Πλήρης τεκμηριωμένη περιγραφή διάβρωσης, ζημιών και άλλων παράκτιων επιπτώσεων.', true),
            field('reference', 'Πηγή τεκμηρίωσης', 'text', 'Επαληθεύσιμο URL, παραπομπή ή σύνδεσμος απόφασης ΑΔΑ.', true),
            field('decentralized_admin', 'Αποκεντρωμένη διοίκηση', 'text', 'Αρμόδια αποκεντρωμένη διοίκηση.'),
            field('region_name', 'Περιφέρεια', 'text', 'Περιφέρεια στην οποία βρίσκεται η θέση.'),
            field('regional_unit', 'Περιφερειακή ενότητα', 'text', 'Περιφερειακή ενότητα στην οποία βρίσκεται η θέση.'),
            field('municipality', 'Δήμος', 'text', 'Δήμος της θέσης.'), field('municipal_unit', 'Δημοτική ενότητα', 'text', 'Δημοτική ενότητα της θέσης.'),
            field('community', 'Κοινότητα', 'text', 'Δημοτική κοινότητα της θέσης.'),
            field('short_damage', 'Σύντομη περιγραφή', 'text', 'Σύντομη περίληψη των τεκμηριωμένων επιπτώσεων.'),
            field('ada_code', 'Κωδικός ΑΔΑ', 'text', 'Ακριβής κωδικός της σχετικής απόφασης στη Διαύγεια, όταν υπάρχει.'),
            field('source', 'Φορέας απόφασης', 'text', 'Διοικητική μονάδα ή φορέας που εξέδωσε την απόφαση. Ο σύνδεσμος τεκμηρίωσης μπαίνει στο reference.'),
            field('declaration_date', 'Ημερομηνία κήρυξης', 'date', 'Ημερομηνία κήρυξης έκτακτης ανάγκης, σε μορφή YYYY-MM-DD.'),
            field('emergency_duration', 'Διάρκεια έκτακτης ανάγκης', 'text', 'Διάρκεια και μονάδα όπως αναγράφονται στην απόφαση.'),
            field('natura_flag', 'Εντός Natura 2000', 'YESNO', 'YES ή NO μόνο εφόσον τεκμηριώνεται. Κενό αν η χωρική σχέση είναι άγνωστη.'),
            field('natura_code', 'Κωδικός Natura 2000', 'text', 'Επίσημος κωδικός ή κωδικοί των σχετικών προστατευόμενων περιοχών.'),
            field('natura_name', 'Όνομα Natura 2000', 'text', 'Επίσημη ονομασία της σχετικής προστατευόμενης περιοχής.'),
            field('submission_notes', 'Σημειώσεις υποβολής', 'text', 'Εξηγήστε διορθώσεις, αβεβαιότητες, πηγές χωρικής τεκμηρίωσης και τα συνημμένα αρχεία.')
        ]
    }
];
