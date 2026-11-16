// Scoped integrity audit requested for the flood record cards. No upstream truth claim.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import CatalogueDataManager from '../sites/floods/js/data/CatalogueDataManager.js';
import { mapHanzeRecord, groupEventPins, hasRecordValue } from '../sites/floods/js/data/recordValues.js';
import { renderRecordSections } from '../sites/floods/js/ui/FloodRecordDetails.js';
import { escapeHtml } from '../sites/floods/js/utils/helpers.js';

const root = new URL('../', import.meta.url);
const readJSON = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const readJSONL = async path => (await readFile(new URL(path, root), 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
const greek = await readJSONL('../research/2026-09-05-global-expansion/preparation-batch-1/modal-audit/live-greek-records.jsonl');
const sourceHanze = await readJSONL('../research/2026-09-05-global-expansion/preparation-batch-1/records/hanze-outside-greece.jsonl');
const index = await readJSON('sites/floods/data/hanze/v2.1.1/map-records.json');
const links = await readJSON('sites/floods/data/event-reconciliation.json');
const bibliography = new Map((await readJSON('sites/floods/data/hanze/v2.1.1/bibliography.json')).records.map(row => [row['No.'], row]));
const original = new Map(sourceHanze.map(row => [row.source_event_id, row]));
const manager = new CatalogueDataManager({ emit() {} }, { get() {}, set() {}, clear() {} }, { set() {} });
manager.reconciliation = links;
manager.hanzeRecords = index.records.map(mapHanzeRecord);
manager.hanzeById = new Map(manager.hanzeRecords.map(row => [row.id, row]));
const greekById = new Map(greek.map(row => [row.id, row]));
manager.greek.fetchFloodDetails = async id => ({ ...greekById.get(Number(id)), reference: 'https://doi.org/10.3390/cli11110226' });

const counts = { greek_records_checked: 0, hanze_records_checked: 0, blank_rows: 0, fields: {}, reviewed_duplicate_groups: links.groups.length };
function auditHTML(record, html) {
    assert(!/<div class="detail-value">\s*<\/div>/.test(html), `Empty row: ${record.id}`);
    assert(!/<div class="detail-value">(?:_|—|Not reported|null|undefined)<\/div>/.test(html), `Placeholder: ${record.id}`);
    assert(!/<section[^>]*>[^]*?<div class="lagoon-modal-details-grid"><\/div>/.test(html), `Empty section: ${record.id}`);
    assert(!html.includes('javascript:'), `Unsafe URL: ${record.id}`);
}
function field(html, key, expected, id) {
    const actual = html.includes(`data-field="${key}"`);
    assert.equal(actual, expected, `Field ${key} visibility for ${id}`);
    if (actual) counts.fields[key] = (counts.fields[key] || 0) + 1;
}
for (const raw of greek) {
    const record = await manager.fetchFloodDetails(raw.id);
    const html = renderRecordSections(record);
    auditHTML(record, html);
    // Mandra's wider regional context has its own fields: audit the local block separately.
    const local = html.split('Evidence for the wider event')[0];
    for (const key of ['date_of_commencement','year','location_name','flood_event_name','deaths_toll_int','rainfall_duration','rainfall_height','cause_of_flood','relevant_information']) {
        field(local, key, hasRecordValue(raw[key]), raw.id);
        if (hasRecordValue(raw[key])) {
            const value = typeof raw[key] === 'number' && key !== 'year' ? raw[key].toLocaleString('en-GB', { maximumFractionDigits: 12 }) : String(raw[key]).trim();
            assert(local.includes(escapeHtml(value)), `Lost Greek value ${raw.id} ${key}`);
        }
    }
    if (hasRecordValue(raw.source)) assert(html.includes(escapeHtml(raw.source)), `Lost reference ${raw.id}`);
    assert(!local.includes('data-field="persons_affected"'), `HANZE field leaked into Greek block ${raw.id}`);
    counts.greek_records_checked++;
}
for (const p of index.records) {
    const source = original.get(p.source_event_id);
    assert(source, `Unknown source record ${p.source_event_id}`);
    assert.equal(p.start_date, source.time.start);
    assert.equal(p.end_date, source.time.end);
    assert.equal(p.country_name_source, source.country_name_source);
    assert.equal(p.event_type_source, source.event_type_source);
    assert.equal(p.cause, source.cause_source);
    assert.equal(p.notes || null, source.notes_source || null);
    assert.equal(p.references, source.references_source.join('; '));
    assert.equal(p.flood_sources, source.raw_source_record['Flood source'] || null);
    for (const citation of p.source_citations) {
        const entry = bibliography.get(citation.bibliography_record_number);
        assert(entry, `Missing bibliography entry ${p.source_event_id}`);
        assert(source.references_source.includes(citation.label), `Citation not present in source record ${p.source_event_id}`);
        assert.equal(citation.title, entry.Name);
        assert.equal(citation.url, entry.URL);
    }
    for (const [key, value] of Object.entries(source.impacts)) assert.equal(p[key], value, `${p.source_event_id} ${key}`);
    const record = mapHanzeRecord(p);
    const html = renderRecordSections(record);
    auditHTML(record, html);
    for (const key of ['source_record_id','country','date_interval','date_qualification','flood_type','flood_sources','location_name','deaths_toll_int','persons_affected','reported_inundated_area_km2','losses_nominal','losses_2020_eur','cause_of_flood','relevant_information','source','reference','publication','license']) {
        field(html, key, hasRecordValue(record[key]), record.id);
        if (hasRecordValue(record[key])) {
            const expected = typeof record[key] === 'number' ? record[key].toLocaleString('en-GB', { maximumFractionDigits: 12 }) : String(record[key]).trim();
            assert(html.includes(escapeHtml(expected)), `Lost HANZE value ${record.id} ${key}`);
        }
    }
    assert(!html.includes('data-field="rainfall_duration"'), `Greek field leaked into HANZE ${record.id}`);
    if (hasRecordValue(p.currency)) assert(html.includes(escapeHtml(p.currency)), `Currency missing ${record.id}`);
    counts.hanze_records_checked++;
}
for (const group of links.groups) {
    const members = group.record_ids.map(id => greekById.get(id));
    const comparable = row => Object.fromEntries(Object.entries(row).filter(([key]) => !['id', 'source'].includes(key)));
    assert.deepEqual(comparable(members[0]), comparable(members[1]), `Reviewed identity changed: ${group.record_ids}`);
    const html = renderRecordSections(await manager.fetchFloodDetails(group.record_ids[1]));
    for (const member of members) assert(html.includes(escapeHtml(member.source)), `Group lost source ${member.id}`);
}
manager.greekAvailable = true;
manager.greek.fetchFloodData = async () => greek;
const loaded = await manager.fetchFloodData();
assert.equal(loaded.length, 4404, 'Source records must remain available for statistics');
const pins = groupEventPins(loaded.filter(row => row.dataset === 'Greek flood catalogue'));
assert.equal(pins.length, 1990);
assert.equal(pins.reduce((sum, row) => sum + row.source_record_count, 0), 1992);
assert.equal(groupEventPins(loaded.filter(row => row.id === 323))[0].id, 322, 'Filtered secondary member must use canonical pin');
const mandra = await manager.fetchFloodDetails(1743);
assert.equal(mandra.deaths_toll_int, 23);
assert.equal(mandra.regional_context.deaths_toll_int, 24);
assert.equal(mandra.regional_context.source_record_id, '2135');
assert.equal(mandra.regional_context.losses_nominal, 33000000);
assert(!manager.hanzeById.has('hanze-2135'), 'Mandra context must not add a duplicate pin');
assert.equal(mandra.date_of_commencement, null, 'Publication interval must not invent a catalogue commencement day');
const conflict = { ...greekById.get(322), field_observations: { deaths_toll_int: [{value: 0, record_id: 322}, {value: 2, record_id: 323}] } };
assert(renderRecordSections(conflict).includes('0 <small>(record 322)</small>'));
assert(renderRecordSections(conflict).includes('2 <small>(record 323)</small>'));
const escaped = renderRecordSections({ id: 1, source: '<img src=x onerror=alert(1)>', reference: 'javascript:alert(1)', year: 2000 });
assert(!escaped.includes('<img') && !escaped.includes('href="javascript:'), 'Unsafe source text must not become executable markup');
const nonmissing = value => hasRecordValue(value);
assert([0, '0', '0.75'].every(nonmissing));
assert([null, undefined, '', ' ', '_', '__', '—'].every(value => !nonmissing(value)));
counts.displayed_pins = pins.length + index.records.length;
counts.source_records = greek.length + index.records.length;
counts.linked_bibliography_entries = index.records.reduce((sum, row) => sum + row.source_citations.length, 0);
counts.scientific_limit = 'Checks confirm source-to-card fidelity, not the truth of every upstream report or exhaustive event identity.';
const output = new URL('../research/2026-09-05-global-expansion/preparation-batch-1/modal-audit/render-audit.json', root);
await writeFile(output, JSON.stringify(counts, null, 2) + '\n');
console.log(JSON.stringify(counts, null, 2));
console.log(`Audit saved to ${fileURLToPath(output)}`);
