// src/routes/pois.js
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { predictWaitTime } = require('../services/predictionEngine');
const registry = require('../services/poiRegistry');
const externalPlaces = require('../services/externalPlaces');

// GET /api/pois — return all registered POIs or discover new ones via lat/lng
// Supports ?lat=xx&lng=yy&preference=fastest|nearest&radius=5
router.get('/', async (req, res) => {
    const { lat, lng, radius, preference, mockDate: reqMockDate } = req.query;
    
    let poisToProcess = [];

    if (lat && lng) {
        try {
            // 1. Check if we have cached results for this area to avoid hitting Overpass too often
            const cacheKey = `${lat}_${lng}_${radius || 5}`;
            const cached = registry.getCachedResult(cacheKey);
            
            if (cached) {
                poisToProcess = cached;
            } else {
                // 2. Fetch from External API (OSM Overpass)
                const externalPois = await externalPlaces.fetchNearbyFromOverpass(
                    parseFloat(lat), 
                    parseFloat(lng), 
                    parseFloat(radius) || 5
                );
                
                // 3. Register in Dynamic Registry (Deduplicates + Persistent Tracking)
                poisToProcess = registry.registerBatch(externalPois);
                
                // 4. Cache the discovery results for 5 mins
                registry.setCachedResult(cacheKey, poisToProcess);
            }
        } catch (err) {
            console.error('Discovery failed, falling back to all registered POIs:', err.message);
            poisToProcess = registry.getAllPois();
        }
    } else {
        // Return all registered POIs (default behavior)
        poisToProcess = registry.getAllPois();
    }

    const mockDate = reqMockDate ? new Date(reqMockDate) : new Date();
    const currentDay = mockDate.getUTCDay(); 
    const currentHour = mockDate.getUTCHours();

    const poisWithPredictions = poisToProcess.map(poi => {
        const id = String(poi.id);
        const reports = registry.getReportsForPoi(id);
        let historicalData = registry.getHistoryForPoi(id);
        
        // HEURISTIC FALLBACK: If no historical data exists for this POI,
        // use type-based heuristic defaults (e.g., hospitals busy in mornings).
        // This ensures predictions work even with zero users.
        if (!historicalData || Object.keys(historicalData).length === 0) {
            const { getHeuristicDefault, HEURISTIC_DEFAULTS } = require('../config/db');
            const typeDefaults = HEURISTIC_DEFAULTS[poi.type];
            if (typeDefaults) {
                historicalData = typeDefaults;
            }
        }
        
        const prediction = predictWaitTime({
            reports,
            historicalData,
            currentDay,
            currentHour,
            poiId: id,
            poiType: poi.type,
        });

        // Add isFirstReport flag for "be the first" incentive UX
        prediction.isFirstReport = reports.length === 0;

        const bestTime = getBestTimeToVisit(id);
        const peakHours = getPeakHours(id, currentDay);
        const nearbyAlt = getNearbyAlternative(poi, currentDay, currentHour, prediction, preference);
        
        return {
            ...poi,
            currentPrediction: prediction,
            bestTimeToVisit: bestTime,
            peakHoursToday: peakHours,
            nearbyAlternative: nearbyAlt
        };
    });
    
    // sorting by preference
    if (preference === 'nearest') {
        poisWithPredictions.sort((a, b) => (a.distanceKm || 999) - (b.distanceKm || 999));
    } else {
        // default: fastest (but only if they have data)
        poisWithPredictions.sort((a, b) => (a.currentPrediction.waitTime || 999) - (b.currentPrediction.waitTime || 999));
    }

    res.json(poisWithPredictions);
});

// GET /api/pois/:id — single POI detail
router.get('/:id', (req, res) => {
    const id = String(req.params.id);
    const poi = registry.findPoi(id);
    
    if (!poi) {
        return res.status(404).json({ error: "POI not found" });
    }
    
    const now = new Date();
    const currentDay = now.getDay();
    const currentHour = now.getHours();
    
    const reports = registry.getReportsForPoi(id);
    const historicalData = registry.getHistoryForPoi(id);
    
    const prediction = predictWaitTime({
        reports,
        historicalData,
        currentDay,
        currentHour,
        poiId: id,
    });
        
    const bestTime = getBestTimeToVisit(id);
    const peakHours = getPeakHours(id, currentDay);
    const nearbyAlt = getNearbyAlternative(poi, currentDay, currentHour, prediction, req.query.preference);
    
    res.json({
        ...poi,
        currentPrediction: prediction,
        bestTimeToVisit: bestTime,
        peakHoursToday: peakHours,
        nearbyAlternative: nearbyAlt
    });
});

// POST /api/pois/nearby — accept real POIs from frontend, register + enrich
router.post('/nearby', (req, res) => {
    const { pois: incomingPois } = req.body;
    if (!Array.isArray(incomingPois)) {
        return res.status(400).json({ error: "pois array is required" });
    }

    // Register all incoming POIs in the registry (deduplicates automatically)
    const registeredPois = registry.registerBatch(incomingPois);

    const now = new Date();
    const currentDay = now.getDay();
    const currentHour = now.getHours();

    const enrichedPois = registeredPois.map(poi => {
        const id = String(poi.id);
        const reports = registry.getReportsForPoi(id);
        const historicalData = registry.getHistoryForPoi(id);

        const hasData = reports.length > 0 || Object.keys(historicalData).length > 0;

        let prediction;
        if (hasData) {
            prediction = predictWaitTime({
                reports,
                historicalData,
                currentDay,
                currentHour,
            });
        } else {
            prediction = {
                waitTime: null,
                avgWait: 'UNKNOWN',
                confidence: 0,
                surgeDetected: false,
                queueTrend: 'STABLE',
                decisionRecommendation: null,
                explanation: '📡 No live data yet — be the first to report!',
            };
        }

        const bestTime = getBestTimeToVisit(id);
        
        // Find nearby alternative among the same batch
        const nearbyAlt = hasData
            ? getNearbyAlternativeFromList(poi, registeredPois, currentDay, currentHour, prediction)
            : null;

        return {
            ...poi,
            // Carry through the distance from the original payload
            distanceKm: incomingPois.find(p => String(p.id) === id)?.distanceKm || poi.distanceKm,
            currentPrediction: prediction,
            bestTimeToVisit: bestTime,
            peakHoursToday: null,
            nearbyAlternative: nearbyAlt,
        };
    });

    res.json(enrichedPois);
});

// ─── Helper Functions ─────────────────────────────────────────

// Find nearby alternative from a given list of POIs (for dynamic /nearby endpoint)
const getNearbyAlternativeFromList = (targetPoi, allPois, currentDay, currentHour, targetPrediction) => {
    const alternatives = allPois.filter(p => p.type === targetPoi.type && String(p.id) !== String(targetPoi.id));
    if (alternatives.length === 0) return null;

    const candidates = alternatives.map(alt => {
        const altReports = registry.getReportsForPoi(String(alt.id));
        const altHistory = registry.getHistoryForPoi(String(alt.id));
        
        if (altReports.length === 0 && Object.keys(altHistory).length === 0) return null;

        const prediction = predictWaitTime({ reports: altReports, historicalData: altHistory, currentDay, currentHour });
        
        return {
            id: alt.id,
            name: alt.name,
            waitTime: prediction.waitTime,
            avgWait: prediction.avgWait,
        };
    }).filter(c => c && c.waitTime !== null && c.waitTime < targetPrediction.waitTime);

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.waitTime - b.waitTime);
    return candidates[0];
};

// Find nearby alternative from all registered POIs (for static /pois endpoint)
const getNearbyAlternative = (targetPoi, currentDay, currentHour, targetPrediction, preference = 'fastest') => {
    const allPois = registry.getAllPois();
    const alternatives = allPois.filter(p => p.type === targetPoi.type && String(p.id) !== String(targetPoi.id));
    if (alternatives.length === 0) return null;

    let candidates = alternatives.map(alt => {
        const altReports = registry.getReportsForPoi(String(alt.id));
        const altHistory = registry.getHistoryForPoi(String(alt.id));
        const prediction = predictWaitTime({ reports: altReports, historicalData: altHistory, currentDay, currentHour });
        
        const distance = Math.sqrt(Math.pow(targetPoi.lat - alt.lat, 2) + Math.pow(targetPoi.lng - alt.lng, 2));
        
        return {
            id: alt.id,
            name: alt.name,
            waitTime: prediction.waitTime,
            avgWait: prediction.avgWait,
            distance
        };
    });

    candidates = candidates.filter(c => c.waitTime < targetPrediction.waitTime || preference === 'nearest');
    if (candidates.length === 0) return null;

    if (preference === 'nearest') {
        candidates.sort((a, b) => a.distance - b.distance);
    } else {
        candidates.sort((a, b) => a.waitTime - b.waitTime);
    }
    
    return {
        id: candidates[0].id,
        name: candidates[0].name,
        waitTime: candidates[0].waitTime,
        avgWait: candidates[0].avgWait
    };
};

// Historical fallback
const getHistoricalFallback = (poiId, forcedDate) => {
    const id = String(poiId);
    const now = forcedDate || new Date();
    const current_day = forcedDate ? now.getUTCDay() : now.getDay();
    const current_hour = forcedDate ? now.getUTCHours() : now.getHours();
    
    const timeKey = `${current_day}_${current_hour}`;
    const history = registry.getHistoryForPoi(id);
    const historicalAvg = history[timeKey];
    
    if (historicalAvg !== undefined) {
        return {
            avgWait: invertWeights(historicalAvg),
            avgWaitMinutes: historicalAvg,
            confidence: 'HISTORICAL',
            reportCount: 0
        };
    }
    
    return { avgWait: 'UNKNOWN', confidence: 'LOW', reportCount: 0 };
};

// Best Time to Visit
const getBestTimeToVisit = (poiId) => {
    const id = String(poiId);
    const history = registry.getHistoryForPoi(id);
    if (!history || Object.keys(history).length === 0) return [];
    
    const slots = [];
    for (const [timeKey, waitMinutes] of Object.entries(history)) {
        slots.push({ timeKey, waitMinutes });
    }
    
    slots.sort((a, b) => a.waitMinutes - b.waitMinutes);
    const topSlots = slots.slice(0, 3);
    
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    return topSlots.map(slot => {
        const [day, hour] = slot.timeKey.split('_');
        const h = parseInt(hour, 10);
        const timeFormatted = `${h % 12 || 12}:00 ${h >= 12 ? 'PM' : 'AM'}`;
        
        return {
            day: dayNames[parseInt(day)],
            time: timeFormatted,
            avgWaitMinutes: slot.waitMinutes,
            avgWait: invertWeights(slot.waitMinutes)
        };
    });
};

// Peak Hours for today
const getPeakHours = (poiId, currentDay) => {
    const id = String(poiId);
    const history = registry.getHistoryForPoi(id);
    if (!history || Object.keys(history).length === 0) return "Data unavailable";
    
    const todaySlots = [];
    for (const [timeKey, waitMinutes] of Object.entries(history)) {
        const [day, hour] = timeKey.split('_');
        if (parseInt(day) === currentDay) {
            todaySlots.push({ hour: parseInt(hour, 10), waitMinutes });
        }
    }
    
    if (todaySlots.length === 0) return "Data unavailable";
    
    const maxWait = Math.max(...todaySlots.map(s => s.waitMinutes));
    const peakHours = todaySlots.filter(s => s.waitMinutes === maxWait).map(s => s.hour).sort((a,b) => a-b);
    
    if (peakHours.length === 0) return "Data unavailable";
    
    const startHour = peakHours[0];
    const endHour = peakHours[peakHours.length - 1];
    
    const formatHour = (h) => `${h % 12 || 12} ${h >= 12 ? 'PM' : 'AM'}`;
    
    if (startHour === endHour) {
         return `Peak hour today: ${formatHour(startHour)} (avoid)`;
    } else {
         return `Peak hours today: ${formatHour(startHour)} - ${formatHour(endHour + 1)} (avoid)`;
    }
};

// Minutes → category
const invertWeights = (minutes) => {
    if (minutes === null) return 'UNKNOWN';
    if (minutes <= 15) return 'SHORT';
    if (minutes <= 35) return 'MEDIUM';
    return 'LONG';
};

module.exports = router;
module.exports.getHistoricalFallback = getHistoricalFallback;
module.exports.invertWeights = invertWeights;
