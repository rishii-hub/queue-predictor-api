// src/services/poiRegistry.js
// Dynamic POI Registry — manages real-world POIs discovered via external APIs.
// Same place always maps to the same internal record using place_id/osm_id as key.

const db = require('../config/db');

/**
 * Lookup a POI by its external ID (osm_id, place_id, or legacy numeric id).
 * Returns the POI object or null.
 */
const findPoi = (externalId) => {
    const id = String(externalId);
    return db.pois.find(p => String(p.id) === id) || null;
};

/**
 * Register a new POI or return the existing one if already registered.
 * Accepts a POI object from the frontend (with id, name, type, lat, lng, etc.)
 * Returns the canonical POI record from the registry.
 */
const registerPoi = (poiData) => {
    const id = String(poiData.id || poiData.osmId || poiData.place_id);
    
    // Check if already registered
    const existing = findPoi(id);
    if (existing) {
        // Update lat/lng/name if changed (places can rename)
        existing.name = poiData.name || existing.name;
        existing.lat = poiData.lat ?? existing.lat;
        existing.lng = poiData.lng ?? existing.lng;
        return existing;
    }

    // Create new POI entry
    const newPoi = {
        id: id,
        name: poiData.name,
        type: poiData.type || 'OTHER',
        lat: poiData.lat,
        lng: poiData.lng,
        address: poiData.address || '',
        distanceKm: poiData.distanceKm || null,
        source: poiData.source || 'external',
        rushAlert: poiData.rushAlert || null,
        registeredAt: Date.now(),
    };

    db.pois.push(newPoi);

    // Initialize empty historical data bucket for this POI
    if (!db.historicalData[id]) {
        db.historicalData[id] = {};
    }

    return newPoi;
};

/**
 * Register an array of POIs in batch. Returns the registered POI records.
 */
const registerBatch = (poisArray) => {
    return poisArray.map(p => registerPoi(p));
};

/**
 * Get all reports for a specific POI ID (handles both string and numeric IDs).
 */
const getReportsForPoi = (poiId) => {
    const id = String(poiId);
    return db.reports.filter(r => String(r.poi_id) === id);
};

/**
 * Get historical data for a specific POI ID.
 */
const getHistoryForPoi = (poiId) => {
    const id = String(poiId);
    // Also check numeric key for legacy compatibility
    return db.historicalData[id] || db.historicalData[parseInt(id)] || {};
};

/**
 * Get all registered POIs (both static seed data and dynamically discovered).
 */
const getAllPois = () => {
    return db.pois;
};

/**
 * Simple in-memory cache for external API responses (keyed by lat_lng_radius).
 * Entries expire after 5 minutes.
 */
const _apiCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const getCachedResult = (key) => {
    const entry = _apiCache.get(key);
    if (!entry) {
        console.log(`🔍 Cache MISS: ${key}`);
        return null;
    }
    if (Date.now() - entry.timestamp > CACHE_TTL) {
        _apiCache.delete(key);
        console.log(`🔍 Cache EXPIRED: ${key} (age: ${Math.round((Date.now() - entry.timestamp) / 1000)}s)`);
        return null;
    }
    console.log(`✅ Cache HIT: ${key} (${entry.data.length} POIs, age: ${Math.round((Date.now() - entry.timestamp) / 1000)}s)`);
    return entry.data;
};

const setCachedResult = (key, data) => {
    _apiCache.set(key, { data, timestamp: Date.now() });
    console.log(`💾 Cache SET: ${key} (${data.length} POIs, TTL: ${CACHE_TTL / 1000}s)`);
};

module.exports = {
    findPoi,
    registerPoi,
    registerBatch,
    getReportsForPoi,
    getHistoryForPoi,
    getAllPois,
    getCachedResult,
    setCachedResult,
};
