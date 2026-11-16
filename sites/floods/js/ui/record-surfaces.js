/** Descriptive surfaces of catalogue records, never a flood-hazard model. */
export const EARTH_RADIUS_KM = 6371.0088;

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const TRUNCATION = 3;
const TRUNCATED_MASS = 1 - Math.exp(-(TRUNCATION ** 2) / 2);

/** Shortest spherical distance, including locations across the antimeridian. */
export function greatCircleDistanceKm(latA, lonA, latB, lonB) {
    const a = Math.sin((latB - latA) * RAD / 2) ** 2
        + Math.cos(latA * RAD) * Math.cos(latB * RAD)
        * Math.sin((lonB - lonA) * RAD / 2) ** 2;
    const bounded = Math.max(0, Math.min(1, a));
    return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(bounded), Math.sqrt(1 - bounded));
}

function abortIfRequested(signal) {
    if (!signal?.aborted) return;
    const error = new Error('Record surface generation was cancelled.');
    error.name = 'AbortError';
    throw error;
}

const yieldToBrowser = () => new Promise(resolve => setTimeout(resolve, 0));

function longitudeExtent(points) {
    const longitudes = points.map(point => ((point.lon % 360) + 360) % 360)
        .sort((a, b) => a - b);
    let largestGap = -1;
    let start = longitudes[0];
    for (let i = 0; i < longitudes.length; i++) {
        const next = i + 1 < longitudes.length ? longitudes[i + 1] : longitudes[0] + 360;
        const gap = next - longitudes[i];
        if (gap > largestGap) {
            largestGap = gap;
            start = next % 360;
        }
    }
    const span = 360 - largestGap;
    const shift = start + span / 2 > 180 ? -360 : 0;
    for (const point of points) {
        point.unwrappedLon = ((point.lon - start) % 360 + 360) % 360 + start + shift;
    }
    return [start + shift, start + shift + span];
}

function longitudeRadiusDegrees(latitude, angularRadius) {
    if (angularRadius >= Math.PI / 2 || Math.abs(latitude * RAD) + angularRadius >= Math.PI / 2) {
        return 180;
    }
    return Math.asin(Math.min(1, Math.sin(angularRadius) / Math.cos(latitude * RAD))) * DEG;
}

/**
 * Build pixel-centred, regular longitude/latitude grids. Row 0 is north and
 * column 0 is west; bounds are pixel edges. Longitude bounds may extend across
 * 180 degrees to keep an antimeridian collection together. A map renderer must
 * reproject these latitude rows when displaying the image in Web Mercator.
 *
 * Every valid source row contributes one Gaussian kernel, even when rows share
 * coordinates. The kernel is truncated at 3 bandwidths and normalized by its
 * retained mass. density is records / 10,000 km²; sourceFraction is the weighted
 * NKUA share. Dates are weighted only over rows with integer recorded years.
 * Missing dates and unsupported pixels use NaN; density is zero without support.
 *
 * @param {Iterable<{lat:number,lon:number,year?:number,source:'NKUA'|'HANZE'}>} records
 * @param {{bandwidthKm?:number,maxWidth?:number,signal?:AbortSignal,onProgress?:(fraction:number)=>void}} options
 */
export async function buildRecordSurfaces(records, {
    bandwidthKm = 75,
    maxWidth = 360,
    signal,
    onProgress,
} = {}) {
    if (!Number.isFinite(bandwidthKm) || bandwidthKm <= 0) {
        throw new RangeError('bandwidthKm must be a finite, positive distance.');
    }
    if (!Number.isFinite(maxWidth) || maxWidth < 1) {
        throw new RangeError('maxWidth must be at least 1.');
    }
    if (records == null || typeof records[Symbol.iterator] !== 'function') {
        throw new TypeError('records must be iterable.');
    }
    abortIfRequested(signal);
    onProgress?.(0);
    abortIfRequested(signal);

    const points = [];
    const sources = { NKUA: 0, HANZE: 0 };
    let minYear = Infinity;
    let maxYear = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    let datedRecordCount = 0;
    let invalidCoordinateCount = 0;
    let invalidSourceCount = 0;
    for (const record of records) {
        if (!record || !Number.isFinite(record.lat) || !Number.isFinite(record.lon)
            || Math.abs(record.lat) > 90 || Math.abs(record.lon) > 180) {
            invalidCoordinateCount++;
            continue;
        }
        if (record.source !== 'NKUA' && record.source !== 'HANZE') {
            invalidSourceCount++;
            continue;
        }
        const year = Number.isFinite(record.year) && Number.isInteger(record.year)
            ? record.year : NaN;
        points.push({ lat: record.lat, lon: record.lon, latRad: record.lat * RAD,
            cosLat: Math.cos(record.lat * RAD), year, nkua: record.source === 'NKUA' });
        sources[record.source]++;
        minLat = Math.min(minLat, record.lat);
        maxLat = Math.max(maxLat, record.lat);
        if (Number.isFinite(year)) {
            minYear = Math.min(minYear, year);
            maxYear = Math.max(maxYear, year);
            datedRecordCount++;
        }
    }

    const stats = {
        recordCount: points.length,
        datedRecordCount,
        minYear: datedRecordCount ? minYear : null,
        maxYear: datedRecordCount ? maxYear : null,
        maxDensity: 0,
        sources,
        bandwidthKm,
        invalidCoordinateCount,
        invalidSourceCount,
    };
    if (!points.length) {
        onProgress?.(1);
        return { bounds: [[-90, -180], [90, 180]], width: 1, height: 1,
            density: new Float32Array(1), meanYear: Float32Array.of(NaN),
            earliestYear: Float32Array.of(NaN), latestYear: Float32Array.of(NaN),
            sourceFraction: Float32Array.of(NaN), valid: new Uint8Array(1), stats };
    }

    const radiusKm = TRUNCATION * bandwidthKm;
    const angularRadius = Math.min(Math.PI, radiusKm / EARTH_RADIUS_KM);
    const latitudeRadius = angularRadius * DEG;
    const [dataWest, dataEast] = longitudeExtent(points);
    const longitudePadding = longitudeRadiusDegrees(Math.max(Math.abs(minLat), Math.abs(maxLat)), angularRadius);
    const south = Math.max(-90, minLat - latitudeRadius);
    const north = Math.min(90, maxLat + latitudeRadius);
    const centreLon = (dataWest + dataEast) / 2;
    const longitudeSpan = Math.min(360, dataEast - dataWest + 2 * longitudePadding);
    const west = centreLon - longitudeSpan / 2;
    const east = centreLon + longitudeSpan / 2;
    const latitudeSpan = north - south;
    const resolution = Math.min(400, Math.floor(maxWidth));
    const width = Math.max(1, Math.round(resolution * Math.min(1, longitudeSpan / latitudeSpan)));
    const height = Math.max(1, Math.round(resolution * Math.min(1, latitudeSpan / longitudeSpan)));
    const size = width * height;
    const density = new Float32Array(size);
    const meanYear = new Float32Array(size).fill(NaN);
    const earliestYear = new Float32Array(size).fill(NaN);
    const latestYear = new Float32Array(size).fill(NaN);
    const sourceFraction = new Float32Array(size).fill(NaN);
    const valid = new Uint8Array(size);

    // Geographic bins only choose candidates. All weights and the exact support
    // cutoff use great-circle distances, including at high latitudes.
    const binDegrees = Math.max(latitudeRadius, 0.000001);
    const maxLonBin = Math.floor((dataEast - dataWest) / binDegrees);
    const bins = new Map();
    for (let i = 0; i < points.length; i++) {
        const point = points[i];
        const latBin = Math.floor((point.lat + 90) / binDegrees);
        const lonBin = Math.floor((point.unwrappedLon - dataWest) / binDegrees);
        let row = bins.get(latBin);
        if (!row) bins.set(latBin, row = new Map());
        let bucket = row.get(lonBin);
        if (!bucket) row.set(lonBin, bucket = []);
        bucket.push(i);
    }

    const latitudeStep = latitudeSpan / height;
    const longitudeStep = longitudeSpan / width;
    const inverseTwiceVariance = 1 / (2 * bandwidthKm ** 2);
    const densityScale = 10000 / (2 * Math.PI * bandwidthKm ** 2 * TRUNCATED_MASS);
    const maximumHaversine = Math.sin(angularRadius / 2) ** 2;
    let lastYield = performance.now();
    await yieldToBrowser();
    for (let rowIndex = 0; rowIndex < height; rowIndex++) {
        abortIfRequested(signal);
        const latitude = north - (rowIndex + 0.5) * latitudeStep;
        const latitudeRad = latitude * RAD;
        const cosLatitude = Math.cos(latitudeRad);
        const lonRadius = longitudeRadiusDegrees(latitude, angularRadius);
        const firstLatBin = Math.floor((latitude - latitudeRadius + 90) / binDegrees);
        const lastLatBin = Math.floor((latitude + latitudeRadius + 90) / binDegrees);
        for (let column = 0; column < width; column++) {
            if ((column & 15) === 0 && performance.now() - lastYield >= 12) {
                onProgress?.((rowIndex * width + column) / size);
                abortIfRequested(signal);
                await yieldToBrowser();
                lastYield = performance.now();
            }
            const longitude = west + (column + 0.5) * longitudeStep;
            // Merge wrapped bin ranges so the same row is never counted twice.
            const ranges = [];
            for (const wrap of [-360, 0, 360]) {
                const lower = Math.max(dataWest, longitude + wrap - lonRadius);
                const upper = Math.min(dataEast, longitude + wrap + lonRadius);
                if (lower <= upper) ranges.push([
                    Math.max(0, Math.floor((lower - dataWest) / binDegrees)),
                    Math.min(maxLonBin, Math.floor((upper - dataWest) / binDegrees)),
                ]);
            }
            ranges.sort((a, b) => a[0] - b[0]);
            const merged = [];
            for (const range of ranges) {
                const previous = merged[merged.length - 1];
                if (previous && range[0] <= previous[1] + 1) previous[1] = Math.max(previous[1], range[1]);
                else merged.push(range);
            }
            let totalWeight = 0;
            let nkuaWeight = 0;
            let datedWeight = 0;
            let weightedYear = 0;
            let firstYear = Infinity;
            let lastYear = -Infinity;
            for (let latBin = firstLatBin; latBin <= lastLatBin; latBin++) {
                const binRow = bins.get(latBin);
                if (!binRow) continue;
                for (const [from, to] of merged) {
                    for (let lonBin = from; lonBin <= to; lonBin++) {
                        const bucket = binRow.get(lonBin);
                        if (!bucket) continue;
                        for (const pointIndex of bucket) {
                            const point = points[pointIndex];
                            const haversine = Math.sin((point.latRad - latitudeRad) / 2) ** 2
                                + cosLatitude * point.cosLat
                                * Math.sin((point.unwrappedLon - longitude) * RAD / 2) ** 2;
                            if (haversine > maximumHaversine + 1e-15) continue;
                            const a = Math.max(0, Math.min(1, haversine));
                            const distance = 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                            if (distance > radiusKm + 1e-9) continue;
                            const weight = Math.exp(-(distance ** 2) * inverseTwiceVariance);
                            totalWeight += weight;
                            if (point.nkua) nkuaWeight += weight;
                            if (Number.isFinite(point.year)) {
                                datedWeight += weight;
                                weightedYear += point.year * weight;
                                firstYear = Math.min(firstYear, point.year);
                                lastYear = Math.max(lastYear, point.year);
                            }
                        }
                    }
                }
            }
            if (!totalWeight) continue;
            const index = rowIndex * width + column;
            valid[index] = 1;
            density[index] = totalWeight * densityScale;
            sourceFraction[index] = nkuaWeight / totalWeight;
            stats.maxDensity = Math.max(stats.maxDensity, density[index]);
            if (datedWeight) {
                meanYear[index] = weightedYear / datedWeight;
                earliestYear[index] = firstYear;
                latestYear[index] = lastYear;
            }
        }
        if (performance.now() - lastYield >= 12) {
            onProgress?.((rowIndex + 1) / height);
            abortIfRequested(signal);
            await yieldToBrowser();
            lastYield = performance.now();
        }
    }
    abortIfRequested(signal);
    onProgress?.(1);
    return { bounds: [[south, west], [north, east]], width, height,
        density, meanYear, earliestYear, latestYear, sourceFraction, valid, stats };
}
