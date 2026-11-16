import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';

const root = path.resolve(process.argv[2] || process.cwd());
const { submissions } = await import(pathToFileURL(path.join(root, 'scripts/submission-definitions.mjs')));
const version = '20260905-1';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const col = index => { let result = ''; for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result; return result; };
const formatName = (f, el) => ({text: el ? 'Κείμενο' : 'Text', integer: el ? 'Ακέραιος' : 'Whole number', decimal: el ? 'Δεκαδικός' : 'Decimal', latitude:'WGS84', longitude:'WGS84', date:'YYYY-MM-DD', 'date-text':'YYYY-MM-DD (text)', yesno:'yes / no', YESNO:'YES / NO'}[f.type]) + (f.unit ? ` (${f.unit})` : '');
const clean = value => typeof value === 'string' && ['', '-', '_', 'nan', 'null', 'None'].includes(value.trim()) ? null : value ?? null;

async function exampleFor(config) {
    if (config.lang !== 'el') {
        const text = await fs.readFile(path.join(root, 'data', `${config.site}.jsonl`), 'utf8');
        const record = JSON.parse(text.replace(/^\uFEFF/, '').split(/\r?\n/).find(line => line.trim()));
        if (config.site !== 'beachrocks') record.country = 'Greece';
        if (config.site === 'lagoons') record.source = 'https://nkua.cloud/lagoons/';
        if (config.site === 'tombolos') record.reference = 'https://doi.org/10.3390/jmse12091578';
        return record;
    }
    const collection = JSON.parse(await fs.readFile(path.join(root, 'sites', config.site, 'data/events.geojson'), 'utf8'));
    const { properties: p, geometry } = collection.features[0];
    const iso = value => { const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value || ''); return match ? `${match[3]}-${match[2]}-${match[1]}` : value; };
    return {
        id:p.EVENT_ID, date_of_commencement:iso(p['ΗΜΕΡΟΜΗΝΙΑ_ΣΥΜΒΑΝΤΟΣ']), location_name:p['ΠΑΡΑΚΤΙΑ_ΠΕΡΙΟΧΗ'],
        latitude:geometry.coordinates[1], longitude:geometry.coordinates[0], damage_description:p['ΠΕΡΙΓΡΑΦΗ_ΖΗΜΙΩΝ'],
        reference:`https://diavgeia.gov.gr/search?query=${encodeURIComponent(p['ΑΔΑ_ΚΩΔΙΚΟΣ'])}`,
        decentralized_admin:p['ΑΠΟΚΕΝΤΡΩΜΕΝΗ_ΔΙΟΙΚΗΣΗ'], region_name:p['ΠΕΡΙΦΕΡΕΙΑ'], regional_unit:p['ΠΕΡΙΦΕΡΕΙΑΚΗ_ΕΝΟΤΗΤΑ'],
        municipality:p['ΔΗΜΟΣ'], municipal_unit:p['ΔΗΜΟΤΙΚΗ_ΕΝΟΤΗΤΑ'], community:p['ΚΟΙΝΟΤΗΤΑ'], short_damage:p.SHORT_DAMAGE,
        ada_code:p['ΑΔΑ_ΚΩΔΙΚΟΣ'], source:p['ΑΔΑ_ΔΙΟΙΚΗΤΙΚΗ_ΜΟΝΑΔΑ'], declaration_date:iso(p['ΗΜΕΡΟΜΗΝΙΑ_ΚΗΡΥΞΗΣ']),
        emergency_duration:p['ΔΙΑΡΚΕΙΑ_ΕΚΤΑΚΤΗΣ_ΑΝΑΓΚΗΣ'], natura_flag:p['ΕΝΤΟΣ_NATURA2000'], natura_code:p['NATURA2000_ΚΩΔΙΚΟΣ'], natura_name:p['NATURA2000_ΟΝΟΜΑ']
    };
}

function styleHeader(range) {
    range.format = { fill:'#243D43', font:{name:'Arial',size:11,bold:true,color:'#FFFFFF'}, wrapText:true, verticalAlignment:'center', rowHeight:42 };
}

async function workbookFor(config, example, directory) {
    const workbook = Workbook.create();
    const data = workbook.worksheets.add('Data');
    const guide = workbook.worksheets.add('Field guide');
    const instructions = workbook.worksheets.add('Instructions');
    const last = col(config.fields.length - 1);
    data.getRange(`A1:${last}101`).values = [config.fields.map(f => f.key), ...Array.from({length:100}, () => config.fields.map(() => null))];
    data.getRange(`A1:${last}101`).format.font = {name:'Arial',size:11,color:'#1C2B30'};
    data.getRange(`A2:${last}101`).format.rowHeight = 22;
    const table = data.tables.add(`A1:${last}101`, true, config.site === 'Κακοκαιρία-Φεβ-2026' ? 'StormSubmissions' : `${config.site}Submissions`);
    table.style = 'TableStyleLight9';
    styleHeader(data.getRange(`A1:${last}1`));
    data.freezePanes.freezeRows(1);
    data.freezePanes.freezeColumns(2);
    for (let i = 0; i < config.fields.length; i++) {
        const f = config.fields[i];
        const column = data.getRange(`${col(i)}1:${col(i)}101`);
        column.format.columnWidth = Math.min(34, Math.max(18, f.key.length + 2));
        const inputs = data.getRange(`${col(i)}2:${col(i)}101`);
        inputs.setNumberFormat(f.type === 'date' ? 'yyyy-mm-dd' : f.type === 'integer' ? '0' : ['latitude','longitude'].includes(f.type) ? '0.000000' : f.type === 'decimal' ? '0.000' : '@');
        if (f.type === 'yesno' || f.type === 'YESNO') inputs.dataValidation = {rule:{type:'list',values:f.type === 'yesno' ? ['yes','no'] : ['YES','NO']}};
        if (f.type === 'latitude' || f.type === 'longitude') {
            const limit = f.type === 'latitude' ? 90 : 180;
            inputs.dataValidation = {rule:{type:'decimal',operator:'between',formula1:-limit,formula2:limit}};
        }
        if (f.type === 'integer') inputs.dataValidation = {rule:{type:'whole',operator:'greaterThanOrEqual',formula1:0}};
    }

    const el = config.lang === 'el';
    const guideRows = config.fields.map(f => {
        let value = clean(example[f.key]);
        if (f.type === 'date' && value) value = new Date(`${value}T00:00:00Z`);
        return [f.key, f.label, f.required ? (el ? 'Ναι' : 'Yes') : (el ? 'Όχι' : 'No'), formatName(f,el), f.description, value];
    });
    guide.getRange(`A1:F${guideRows.length + 1}`).values = [[el ? 'Στήλη' : 'Column', el ? 'Πεδίο' : 'Field', el ? 'Υποχρεωτικό' : 'Required', el ? 'Μορφή και μονάδα' : 'Format and unit', el ? 'Οδηγίες' : 'What to provide', el ? 'Παράδειγμα υπάρχουσας εγγραφής' : 'Existing record example'], ...guideRows];
    guide.getRange(`A1:F${guideRows.length + 1}`).format = {font:{name:'Arial',size:11,color:'#1C2B30'},wrapText:true,verticalAlignment:'top',rowHeight:80};
    [30,30,14,23,75,45].forEach((width, i) => { guide.getRange(`${col(i)}1:${col(i)}${guideRows.length+1}`).format.columnWidth = width; });
    styleHeader(guide.getRange('A1:F1'));
    guide.freezePanes.freezeRows(1);
    guide.freezePanes.freezeColumns(1);
    guide.showGridLines = false;
    config.fields.forEach((f,i) => {
        if (f.type === 'date') guide.getRange(`F${i+2}`).setNumberFormat('yyyy-mm-dd');
        else if (['latitude','longitude'].includes(f.type)) guide.getRange(`F${i+2}`).setNumberFormat('0.000000');
    });

    const instructionRows = [
        [config.name, el ? 'Πρότυπο υποβολής δεδομένων' : 'Data submission template'],
        [el ? 'Ιστότοπος' : 'Website', `https://nkua.cloud/${encodeURIComponent(config.site)}/`],
        [el ? 'Επικοινωνία' : 'Contact', config.recipients.join(', ')],
        [el ? 'Περιεχόμενο' : 'Scope', config.intro],
        ...config.instructions.map((s,i) => [el ? `Βήμα ${i+1}` : `Step ${i+1}`, s]),
        ...config.notes.map(s => [el ? 'Ειδικές οδηγίες' : 'Site guidance', s]),
        [el ? 'Προέλευση παραδειγμάτων' : 'Example provenance', `https://nkua.cloud/${encodeURIComponent(config.site)}/`],
        [el ? 'Αναφορά παραδείγματος' : 'Example source', clean(example.reference || example.source) || `https://nkua.cloud/${encodeURIComponent(config.site)}/`]
    ];
    instructions.getRange(`A1:B${instructionRows.length}`).values = instructionRows;
    instructions.getRange(`A1:B${instructionRows.length}`).format = {font:{name:'Arial',size:11,color:'#1C2B30'},wrapText:true,verticalAlignment:'top',rowHeight:48};
    instructions.getRange(`A1:A${instructionRows.length}`).format.columnWidth = 32;
    instructions.getRange(`B1:B${instructionRows.length}`).format.columnWidth = 105;
    instructions.getRange('A1:B1').format.font = {name:'Arial',size:14,bold:true,color:'#243D43'};
    instructions.getRange('A1:B1').format.rowHeight = 44;
    instructions.showGridLines = false;
    await fs.mkdir(directory, {recursive:true});
    const authoringDirectory = path.join(os.tmpdir(), 'nkua-submissions', 'artifacts', config.site);
    await fs.mkdir(authoringDirectory, {recursive:true});
    const output = await SpreadsheetFile.exportXlsx(workbook);
    const authoredPath = path.join(authoringDirectory, `${config.template}.xlsx`);
    await output.save(authoredPath);
    await fs.copyFile(authoredPath, path.join(directory, `${config.template}.xlsx`));
    await fs.writeFile(path.join(directory, `${config.template}.csv`), '\uFEFF' + config.fields.map(f => `"${f.key}"`).join(',') + '\r\n', 'utf8');
}

function tableFor(fields, el) {
    return `<div class="template-table-wrapper"><table class="template-table submission-field-guide">
                            <thead><tr><th scope="col">${el?'Πεδίο και στήλη':'Field and column'}</th><th scope="col">${el?'Μορφή και μονάδα':'Format and unit'}</th><th scope="col">${el?'Τι συμπληρώνετε':'What to provide'}</th></tr></thead>
                            <tbody>${fields.map(f => `<tr><th scope="row">${escape(f.label)}<br><code>${escape(f.key)}</code></th><td>${escape(formatName(f,el))}</td><td>${escape(f.description)}</td></tr>`).join('\n                            ')}</tbody>
                        </table></div>`;
}

function modalFor(config) {
    const el = config.lang === 'el';
    const baseUrl = `/${encodeURIComponent(config.site)}/templates/${config.template}`;
    const body = el ? `Προς την ερευνητική ομάδα,\n\nΘα ήθελα να υποβάλω δεδομένα για ${config.name}.\n\nΟνόματα συντελεστών\n[Συμπληρώστε]\n\nΦορέας\n[Συμπληρώστε]\n\nEmail επικοινωνίας\n[Συμπληρώστε]\n\nΝέες εγγραφές ή διορθώσεις και περιοχή κάλυψης\n[Συμπληρώστε]\n\nΕπισυνάψτε το συμπληρωμένο XLSX ή CSV και τις πηγές. Οι φωτογραφίες και οι αποφάσεις προστίθενται χειροκίνητα.\n\nΣημειώσεις και δικαιώματα χρήσης συνημμένων\n[Συμπληρώστε]` : `Dear ${config.name} team,\n\nI would like to submit data for ${config.name}.\n\nContributor names\n[Please complete]\n\nAffiliation\n[Please complete]\n\nContact email\n[Please complete]\n\nNew records or corrections and geographic coverage\n[Please complete]\n\nPlease attach the completed XLSX or CSV and supporting sources manually.\n\nNotes and attachment reuse permissions\n[Please complete]`;
    const mailto = `mailto:${config.recipients.join(',')}?subject=${encodeURIComponent(el ? 'Υποβολή δεδομένων παράκτιων επιπτώσεων Φεβρουαρίου 2026' : `${config.name} data submission`)}&body=${encodeURIComponent(body)}`;
    const required = config.fields.filter(f => f.required);
    const optional = config.fields.filter(f => !f.required);
    return `<div id="submit-data-modal" class="modal submit-data-modal">
            <div class="modal-content">
                <div class="modal-header">
                    <h3>${el?'Υποβολή δεδομένων':`Submit ${escape(config.name)} data`}</h3>
                    <button class="modal-close" id="close-submit-data" aria-label="${el?'Κλείσιμο οδηγιών υποβολής':'Close submission instructions'}">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="submit-data-intro"><p>${escape(config.intro)}</p></div>
                    <div class="submit-data-section">
                        <h4>${el?'Προετοιμασία υποβολής':'Prepare your submission'}</h4>
                        <p>${el?'Συμπληρώστε το κενό φύλλο Data του XLSX. Το Field guide περιλαμβάνει όλες τις στήλες, τις μονάδες και παραδείγματα. Εναλλακτικά, χρησιμοποιήστε το CSV με τις ίδιες κεφαλίδες.':'Fill in the blank Data sheet in the XLSX workbook. The Field guide describes every column, its units and examples. You can also use the CSV with the same headers.'}</p>
                        <p class="submit-data-note">${el?'Αφήστε κενές τις άγνωστες τιμές. Για διόρθωση, συμπληρώστε το υπάρχον id και εξηγήστε την αλλαγή στο submission_notes.':'Leave unknown values blank. For a correction, include the existing id and explain the change in submission_notes.'}</p>
                        <div class="submit-data-actions">
                            <a class="btn-primary" href="${baseUrl}.xlsx?v=${version}" download="${config.template}.xlsx">${el?'Λήψη XLSX':'Download XLSX'}</a>
                            <a class="btn-primary" href="${baseUrl}.csv?v=${version}" download="${config.template}.csv">${el?'Λήψη CSV':'Download CSV'}</a>
                            <a class="btn-primary" href="${escape(mailto)}">${el?'Αποστολή με email':'Send by email'}</a>
                        </div>
                    </div>
                    <div class="submit-data-section">
                        <h4>${el?'Υποχρεωτικά πεδία':'Required fields'}</h4>
                        ${tableFor(required,el)}
                    </div>
                    <details class="submit-data-section submission-optional">
                        <summary>${el?'Προαιρετικά πεδία':'Optional fields'} (${optional.length})</summary>
                        ${tableFor(optional,el)}
                    </details>
                    <div class="submit-data-section">
                        <h4>${el?'Ειδικές οδηγίες':'Site guidance'}</h4>
                        <ul class="notes-list">${config.notes.map(note=>`<li>${escape(note)}</li>`).join('')}</ul>
                    </div>
                    <p class="submit-data-note">${el?'Στο email προσθέστε ονόματα συντελεστών, φορέα και στοιχεία επικοινωνίας. Επισυνάψτε το αρχείο και τις πηγές χειροκίνητα. Η ερευνητική ομάδα εξετάζει κάθε υποβολή πριν από τη δημοσίευση.':'Include contributor names, affiliation and contact details in your email. Attach the completed file and supporting sources manually. The research team reviews each submission before publication.'}</p>
                </div>
            </div>
        </div>`;
}

for (const config of submissions) {
    const example = await exampleFor(config);
    await workbookFor(config, example, path.join(root, 'sites', config.site, 'templates'));
    const filename = path.join(root, 'sites', config.site, 'index.html');
    let html = await fs.readFile(filename,'utf8');
    const start = html.indexOf('<div id="submit-data-modal"');
    if (start < 0) throw new Error(`Submission modal missing for ${config.site}`);
    const tags = /<div\b[^>]*>|<\/div\s*>/gi;
    tags.lastIndex = start;
    let depth = 0, end = -1, token;
    while ((token = tags.exec(html))) {
        depth += token[0].startsWith('</') ? -1 : 1;
        if (depth === 0) { end = tags.lastIndex; break; }
    }
    if (end < 0) throw new Error(`Submission modal boundary missing for ${config.site}`);
    html = html.slice(0,start) + modalFor(config) + html.slice(end);
    html = html.replace('/webgis-shared/lagoons-ui.css?v=20260905-3','/webgis-shared/lagoons-ui.css?v=20260905-4');
    await fs.writeFile(filename,html,'utf8');
    console.log(`Updated ${config.site} with ${config.fields.length} matching submission columns`);
}
