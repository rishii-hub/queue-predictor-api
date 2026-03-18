// src/config/db.js
// ──────────────────────────────────────────────────────────────
// In-memory data store with rich seed data for demo stability.
// Ensures the system works beautifully even with zero live users.
//
// HEURISTIC DEFAULTS: Each POI type has baseline wait times derived
// from real-world patterns (hospital mornings busy, bank salary days, etc.)
// These serve as priors until crowd reports arrive.
// ──────────────────────────────────────────────────────────────

// Heuristic baseline wait times by POI type and time slot
// Based on real-world patterns in Indian public services
const HEURISTIC_DEFAULTS = {
    HOSPITAL: {
        // Mornings are busiest, afternoons moderate, evenings quieter
        "0_9": 35, "0_10": 40, "0_11": 45, "0_14": 30, "0_16": 20,
        "1_9": 40, "1_10": 45, "1_11": 50, "1_14": 35, "1_16": 25,
        "2_9": 35, "2_10": 40, "2_11": 45, "2_14": 30, "2_16": 20,
        "3_9": 38, "3_10": 42, "3_11": 48, "3_14": 32, "3_16": 22,
        "4_9": 40, "4_10": 45, "4_11": 50, "4_14": 35, "4_16": 25,
        "5_9": 45, "5_10": 50, "5_11": 55, "5_14": 40, "5_16": 30,
        "6_9": 30, "6_10": 35, "6_11": 40, "6_14": 25, "6_16": 15,
    },
    BANK: {
        // Salary days (1st, 15th), lunch hours busy
        "0_10": 15, "0_12": 25, "0_15": 20,
        "1_10": 25, "1_12": 35, "1_15": 30,
        "2_10": 20, "2_12": 30, "2_15": 25,
        "3_10": 20, "3_12": 30, "3_15": 25,
        "4_10": 25, "4_12": 35, "4_15": 30,
        "5_10": 30, "5_12": 40, "5_15": 35,
        "6_10": 10, "6_12": 15, "6_15": 10,
    },
    TEMPLE: {
        // Weekends and evenings busiest, especially Tuesdays
        "0_6": 45, "0_9": 40, "0_18": 50,
        "1_6": 20, "1_9": 15, "1_18": 25,
        "2_6": 50, "2_9": 45, "2_18": 60, // Tuesday special puja
        "3_6": 20, "3_9": 15, "3_18": 25,
        "4_6": 25, "4_9": 20, "4_18": 30,
        "5_6": 30, "5_9": 25, "5_18": 35,
        "6_6": 55, "6_9": 50, "6_18": 60,
    },
};

const memDb = {
    pois: [
        { id: '1', name: 'City General Hospital', type: 'HOSPITAL', lat: 28.6139, lng: 77.2090, rushAlert: "High rush expected due to viral fever season" },
        { id: '2', name: 'State Bank Branch A', type: 'BANK', lat: 28.6145, lng: 77.2105, rushAlert: "High rush expected due to salary day (1st of month)" },
        { id: '3', name: 'Grand Temple', type: 'TEMPLE', lat: 28.6150, lng: 77.2150, rushAlert: "High rush expected due to Tuesday Special Puja" },
        { id: '4', name: 'HDFC Branch B', type: 'BANK', lat: 28.6146, lng: 77.2107 }
    ],
    reports: [],

    cache: {
        poi_wait_times: {}
    },

    // Historical data enriched with heuristic defaults for demo stability
    historicalData: {
        '1': { "1_10": 20, "1_14": 40, "2_10": 15, "3_9": 38, "4_10": 45, "5_11": 55, "0_16": 20 },
        '2': { "3_15": 10, "5_12": 30, "1_10": 25, "2_12": 30, "4_15": 30, "0_10": 15 },
        '3': { "6_18": 60, "0_09": 45, "2_18": 60, "6_6": 55, "0_6": 45, "5_18": 35 },
        '4': { "3_15": 5, "5_12": 15, "1_10": 20, "2_12": 25 }
    },

    users: {
        "user1": { trustScore: 1.0, actions: [], timeSavedMins: 0 }
    },

    alerts: [],
};
[
    {
        "id": "2",
        "name": "State Bank Branch A",
        "type": "BANK",
        "lat": 28.6145,
        "lng": 77.2105,
        "rushAlert": "High rush expected due to salary day (1st of month)",
        "currentPrediction": {
            "waitTime": 11,
            "avgWait": "SHORT",
            "confidence": 0,
            "uncertainty": "±10 min",
            "surgeDetected": false,
            "isTrendingUp": false,
            "queueTrend": "STABLE",
            "decisionRecommendation": "WAIT",
            "explanation": "📊 Estimated based on typical patterns for this category.",
            "predictionSource": "baseline",
            "reportCount": 0,
            "lastReportAge": null,
            "dataFreshness": "none",
            "dataReliability": "LOW",
            "mlContribution": 18,
            "accuracyTrend": "building",
            "isFirstReport": true
        },
        "bestTimeToVisit": [
            {
                "day": "Wednesday",
                "time": "3:00 PM",
                "avgWaitMinutes": 10,
                "avgWait": "SHORT"
            },
            {
                "day": "Sunday",
                "time": "10:00 AM",
                "avgWaitMinutes": 15,
                "avgWait": "SHORT"
            },
            {
                "day": "Monday",
                "time": "10:00 AM",
                "avgWaitMinutes": 25,
                "avgWait": "MEDIUM"
            }
        ],
        "peakHoursToday": "Peak hour today: 3 PM (avoid)",
        "nearbyAlternative": null
    },
    {
        "id": "3",
        "name": "Grand Temple",
        "type": "TEMPLE",
        "lat": 28.615,
        "lng": 77.215,
        "rushAlert": "High rush expected due to Tuesday Special Puja",
        "currentPrediction": {
            "waitTime": 14,
            "avgWait": "SHORT",
            "confidence": 0,
            "uncertainty": "±10 min",
            "surgeDetected": false,
            "isTrendingUp": false,
            "queueTrend": "STABLE",
            "decisionRecommendation": "WAIT",
            "explanation": "📊 Estimated based on typical patterns for this category.",
            "predictionSource": "baseline",
            "reportCount": 0,
            "lastReportAge": null,
            "dataFreshness": "none",
            "dataReliability": "LOW",
            "mlContribution": 26,
            "accuracyTrend": "building",
            "isFirstReport": true
        },
        "bestTimeToVisit": [
            {
                "day": "Friday",
                "time": "6:00 PM",
                "avgWaitMinutes": 35,
                "avgWait": "MEDIUM"
            },
            {
                "day": "Sunday",
                "time": "9:00 AM",
                "avgWaitMinutes": 45,
                "avgWait": "LONG"
            },
            {
                "day": "Sunday",
                "time": "6:00 AM",
                "avgWaitMinutes": 45,
                "avgWait": "LONG"
            }
        ],
        "peakHoursToday": "Data unavailable",
        "nearbyAlternative": null
    },
    {
        "id": "4",
        "name": "HDFC Branch B",
        "type": "BANK",
        "lat": 28.6146,
        "lng": 77.2107,
        "currentPrediction": {
            "waitTime": 15,
            "avgWait": "SHORT",
            "confidence": 0,
            "uncertainty": "±10 min",
            "surgeDetected": false,
            "isTrendingUp": false,
            "queueTrend": "STABLE",
            "decisionRecommendation": "WAIT",
            "explanation": "📊 Estimated based on typical patterns for this category.",
            "predictionSource": "baseline",
            "reportCount": 0,
            "lastReportAge": null,
            "dataFreshness": "none",
            "dataReliability": "LOW",
            "mlContribution": null,
            "accuracyTrend": "building",
            "isFirstReport": true
        },
        "bestTimeToVisit": [
            {
                "day": "Wednesday",
                "time": "3:00 PM",
                "avgWaitMinutes": 5,
                "avgWait": "SHORT"
            },
            {
                "day": "Friday",
                "time": "12:00 PM",
                "avgWaitMinutes": 15,
                "avgWait": "SHORT"
            },
            {
                "day": "Monday",
                "time": "10:00 AM",
                "avgWaitMinutes": 20,
                "avgWait": "MEDIUM"
            }
        ],
        "peakHoursToday": "Peak hour today: 3 PM (avoid)",
        "nearbyAlternative": null
    },
    {
        "id": "1",
        "name": "City General Hospital",
        "type": "HOSPITAL",
        "lat": 28.6139,
        "lng": 77.209,
        "rushAlert": "High rush expected due to viral fever season",
        "currentPrediction": {
            "waitTime": 18,
            "avgWait": "MEDIUM",
            "confidence": 0,
            "uncertainty": "±10 min",
            "surgeDetected": false,
            "isTrendingUp": false,
            "queueTrend": "STABLE",
            "decisionRecommendation": "WAIT",
            "explanation": "📊 Estimated based on typical patterns for this category.",
            "predictionSource": "baseline",
            "reportCount": 0,
            "lastReportAge": null,
            "dataFreshness": "none",
            "dataReliability": "LOW",
            "mlContribution": 21,
            "accuracyTrend": "building",
            "isFirstReport": true
        },
        "bestTimeToVisit": [
            {
                "day": "Tuesday",
                "time": "10:00 AM",
                "avgWaitMinutes": 15,
                "avgWait": "SHORT"
            },
            {
                "day": "Monday",
                "time": "10:00 AM",
                "avgWaitMinutes": 20,
                "avgWait": "MEDIUM"
            },
            {
                "day": "Sunday",
                "time": "4:00 PM",
                "avgWaitMinutes": 20,
                "avgWait": "MEDIUM"
            }
        ],
        "peakHoursToday": "Peak hour today: 9 AM (avoid)",
        "nearbyAlternative": null
    }
]
/**
 * Get heuristic default wait time for a POI type at a given day/hour.
 * Returns null if no heuristic available.
 */
function getHeuristicDefault(poiType, day, hour) {
    const typeDefaults = HEURISTIC_DEFAULTS[poiType];
    if (!typeDefaults) return null;
    return typeDefaults[`${day}_${hour}`] || null;
}

module.exports = memDb;
module.exports.getHeuristicDefault = getHeuristicDefault;
module.exports.HEURISTIC_DEFAULTS = HEURISTIC_DEFAULTS;
