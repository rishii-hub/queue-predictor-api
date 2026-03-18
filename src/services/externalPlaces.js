// src/services/externalPlaces.js
// ──────────────────────────────────────────────────────────────
// Production-grade POI data pipeline for Q-Predict.
//
// Pipeline stages:
//   1. Fetch from Overpass API (expanded tags, retry logic)
//   2. Category-aware filtering
//   3. Name normalization (fallback priority chain)
//   4. Category normalization (religion-aware)
//   5. Weighted quality scoring (reject score < 2.5)
//   6. Haversine proximity deduplication (50m threshold)
//   7. Distance sort + limit (max 30)
// ──────────────────────────────────────────────────────────────

const axios = require('axios');

const MAX_RETRIES = 3;
const BASE_TIMEOUT = 10000;
const MAX_RESULTS = 30;
const DEDUP_THRESHOLD_KM = 0.05; // 50 meters

// Generic names that get a -1 penalty (case-insensitive)
const GENERIC_NAMES = /^(hospital|bank|temple|church|mosque|clinic|pharmacy|atm|doctor|place of worship|unnamed|unknown|null)$/i;

// Completely invalid names — rejected outright
const REJECT_NAMES = /^(unnamed|unknown|null|undefined|n\/a|test|todo|fixme|\s*)$/i;

// ─── Retry with Exponential Backoff ──────────────

async function withRetry(fn, retries = MAX_RETRIES) {
    let lastError;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;
            if (attempt < retries) {
                const backoff = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
                console.log(`⏳ Retry ${attempt}/${retries} after ${backoff}ms: ${err.message}`);
                await new Promise(r => setTimeout(r, backoff));
            }
        }
    }
    throw lastError;
}

// ─── Stage 1: Fetch (Expanded OSM Tags) ──────────

async function fetchRawFromOverpass(lat, lng, radiusKm = 5) {
    const overpassUrl = 'https://overpass-api.de/api/interpreter';
    const r = radiusKm * 1000;
  
    // Expanded: hospitals, clinics, doctors, banks, ATMs, pharmacies, worship places
    const query = `
        [out:json][timeout:25];
        (
            node["amenity"="hospital"](around:${r},${lat},${lng});
            node["amenity"="clinic"](around:${r},${lat},${lng});
            node["healthcare"="clinic"](around:${r},${lat},${lng});
            node["healthcare"="doctor"](around:${r},${lat},${lng});
            node["amenity"="bank"](around:${r},${lat},${lng});
            node["amenity"="atm"](around:${r},${lat},${lng});
            node["amenity"="pharmacy"](around:${r},${lat},${lng});
            node["amenity"="place_of_worship"](around:${r},${lat},${lng});
            way["amenity"="hospital"](around:${r},${lat},${lng});
            way["building"="hospital"](around:${r},${lat},${lng});
            way["amenity"="bank"](around:${r},${lat},${lng});
            way["amenity"="place_of_worship"](around:${r},${lat},${lng});
        );
        out center;
    `;

    const response = await withRetry(async () => {
        return axios.post(overpassUrl, `data=${encodeURIComponent(query)}`, {
            timeout: BASE_TIMEOUT,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
    });
    
    if (!response.data || !response.data.elements) return [];
    return response.data.elements;
}

// ─── Stage 2: Category-Aware Filtering ───────────

const SUPPORTED_TAGS = new Set([
    'hospital', 'clinic', 'bank', 'atm', 'pharmacy', 'place_of_worship'
]);
const SUPPORTED_HEALTHCARE = new Set(['clinic', 'doctor']);

function filterValidElements(elements) {
    return elements.filter(el => {
        if (!el.tags) return false;

        const amenity = el.tags.amenity;
        const healthcare = el.tags.healthcare;
        const building = el.tags.building;

        const supported = SUPPORTED_TAGS.has(amenity) 
            || SUPPORTED_HEALTHCARE.has(healthcare)
            || building === 'hospital';

        if (!supported) return false;

        // Must have coordinates
        const lat = el.lat || (el.center && el.center.lat);
        const lng = el.lon || (el.center && el.center.lon);
        if (!lat || !lng) return false;

        return true;
    });
}

// ─── Stage 3: Name Normalization ─────────────────

function normalizeName(tags) {
    const candidates = [
        tags.name,
        tags.brand,
        tags.operator,
        tags['name:en'],
        tags.religion 
            ? `${capitalize(tags.religion)} ${capitalize(getPlaceLabel(tags))}` 
            : null,
        tags.denomination 
            ? `${capitalize(tags.denomination)} Place` 
            : null,
    ];

    for (const name of candidates) {
        if (name && name.trim().length >= 3 && !REJECT_NAMES.test(name.trim())) {
            return name.trim();
        }
    }

    return null; // Will be rejected
}

function getPlaceLabel(tags) {
    const amenity = tags.amenity || tags.healthcare || '';
    if (amenity === 'place_of_worship') return 'Temple';
    if (amenity === 'hospital' || amenity === 'clinic') return 'Hospital';
    if (amenity === 'bank') return 'Bank';
    return 'Place';
}

function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

// ─── Stage 4: Category Normalization ─────────────

function normalizeCategory(tags) {
    const amenity = tags.amenity;
    const healthcare = tags.healthcare;
    const building = tags.building;

    if (amenity === 'hospital' || amenity === 'clinic' || healthcare === 'clinic' 
        || healthcare === 'doctor' || building === 'hospital') {
        return 'HOSPITAL';
    }
    if (amenity === 'bank' || amenity === 'atm') return 'BANK';
    if (amenity === 'pharmacy') return 'PHARMACY';
    
    if (amenity === 'place_of_worship') {
        const religion = (tags.religion || '').toLowerCase();
        if (religion === 'muslim' || religion === 'islam') return 'MOSQUE';
        if (religion === 'christian' || religion === 'christianity') return 'CHURCH';
        if (religion === 'sikh') return 'GURUDWARA';
        return 'TEMPLE'; // Default for India
    }
    
    return 'OTHER';
}

// ─── Stage 5: Weighted Quality Scoring ───────────

function scoreQuality(poi, tags) {
    let score = 0;
    
    // +2 for a valid, non-generic name
    if (poi.name && poi.name.length > 3 && !GENERIC_NAMES.test(poi.name)) {
        score += 2;
    }
    // +1 for brand/operator (institutional backing)
    if (tags.operator || tags.brand) score += 1;
    // +0.5 for contact info
    if (tags.phone || tags['contact:phone']) score += 0.5;
    // +0.5 for web presence
    if (tags.website || tags['contact:website']) score += 0.5;
    // +0.5 for street address
    if (tags['addr:street'] || tags['addr:full']) score += 0.5;
    // +0.5 for opening hours
    if (tags.opening_hours) score += 0.5;
    // -1 for generic-only name
    if (poi.name && GENERIC_NAMES.test(poi.name)) score -= 1;

    poi.qualityScore = Math.max(0, score);
    return poi.qualityScore;
}

// ─── Stage 6: Haversine Proximity Dedup (50m) ────

function deduplicateByProximity(pois) {
    const clusters = [];
    const assigned = new Set();
    
    for (let i = 0; i < pois.length; i++) {
        if (assigned.has(i)) continue;
        
        let best = pois[i];
        assigned.add(i);
        
        for (let j = i + 1; j < pois.length; j++) {
            if (assigned.has(j)) continue;
            
            const dist = calculateDistance(best.lat, best.lng, pois[j].lat, pois[j].lng);
            if (dist < DEDUP_THRESHOLD_KM) {
                assigned.add(j);
                // Keep the higher quality POI
                if (pois[j].qualityScore > best.qualityScore) {
                    best = pois[j];
                }
            }
        }
        
        clusters.push(best);
    }
    
    return clusters;
}

// ─── Haversine Distance (km) ─────────────────────

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// ═══════════════════════════════════════════════════
// MAIN PIPELINE
// ═══════════════════════════════════════════════════

const fetchNearbyFromOverpass = async (lat, lng, radiusKm = 5) => {
    // Stage 1: Fetch raw
    const rawElements = await fetchRawFromOverpass(lat, lng, radiusKm);
    
    // Stage 2: Filter
    const validElements = filterValidElements(rawElements);
    
    // Stages 3-5: Transform + score
    const processedPois = [];
    
    for (const el of validElements) {
        const tags = el.tags;
        
        // Stage 3: Name
        const name = normalizeName(tags);
        if (!name) continue;
        
        // Stage 4: Category
        const type = normalizeCategory(tags);
        
        const poiLat = el.lat || (el.center && el.center.lat);
        const poiLng = el.lon || (el.center && el.center.lon);
        const distance = calculateDistance(lat, lng, poiLat, poiLng);
        
        const poi = {
            id: `osm_${el.id}`,
            osmId: el.id,
            name,
            type,
            lat: poiLat,
            lng: poiLng,
            address: tags['addr:street'] || tags['addr:full'] || '',
            distanceKm: parseFloat(distance.toFixed(2)),
            source: 'osm',
        };
        
        // Stage 5: Quality score (threshold: 2.5)
        const score = scoreQuality(poi, tags);
        if (score < 2.5) continue;
        
        processedPois.push(poi);
    }
    
    // Stage 6: Proximity dedup (50m)
    const deduped = deduplicateByProximity(processedPois);
    
    // Stage 7: Distance sort + limit
    deduped.sort((a, b) => a.distanceKm - b.distanceKm);
    const result = deduped.slice(0, MAX_RESULTS);
    
    console.log(`📍 POI Pipeline: ${rawElements.length} raw → ${validElements.length} valid → ${processedPois.length} scored → ${deduped.length} deduped → ${result.length} final`);
    
    return result;
};

module.exports = {
    fetchNearbyFromOverpass,
};
