const db = require('../config/db');
const { predictWaitTime } = require('../services/predictionEngine');
const registry = require('../services/poiRegistry');
const socketService = require('../services/socketService');
const mlPredictor = require('../services/mlPredictor');

// Convert labels → minutes
function mapWaitTime(value) {
  if (value === "SHORT") return 10;
  if (value === "MEDIUM") return 25;
  return 45; // LONG
}

// Auto-Learning System: Updates historical data using EMA
const updateHistoricalStats = (poiId, waitTimeStr, reportDate) => {
    const id = String(poiId);
    const day = reportDate.getUTCDay();
    const hour = reportDate.getUTCHours();
    const timeKey = `${day}_${hour}`;
    
    if (!db.historicalData[id]) {
        db.historicalData[id] = {};
    }
    
    const currentAvg = db.historicalData[id][timeKey];
    const newWaitMins = mapWaitTime(waitTimeStr);
    
    if (currentAvg === undefined) {
        db.historicalData[id][timeKey] = newWaitMins;
    } else {
        const ALPHA = 0.2;
        const updatedAvg = (newWaitMins * ALPHA) + (currentAvg * (1 - ALPHA));
        db.historicalData[id][timeKey] = Math.round(updatedAvg);
    }
};

const handleWaitTimeReport = (req, res) => {
    const { userId, poiId, waitTime } = req.body;
    
    if (!userId || !poiId || !['SHORT', 'MEDIUM', 'LONG'].includes(waitTime)) {
        return res.status(400).json({ error: "Invalid data. Provide userId, poiId, and waitTime (SHORT, MEDIUM, LONG)." });
    }

    const id = String(poiId);
    const poiExists = registry.findPoi(id);
    if (!poiExists) {
         return res.status(404).json({ error: "POI not found." });
    }
    
    if (!db.users[userId]) {
        db.users[userId] = { trustScore: 1.0, actions: [], timeSavedMins: 0 };
    }

    const newReport = {
        id: db.reports.length + 1,
        user_id: userId,
        poi_id: id,
        wait_time_category: waitTime,
        created_at: new Date(),
        userTrust: db.users[userId].trustScore
    };
    
    db.reports.push(newReport);

    // Time Saved Engine
    const currentDay = newReport.created_at.getUTCDay();
    const currentHour = newReport.created_at.getUTCHours();
    const timeKey = `${currentDay}_${currentHour}`;
    const history = registry.getHistoryForPoi(id);
    const historicalAvg = history[timeKey];

    const waitTimeMins = mapWaitTime(waitTime);
    if (historicalAvg && waitTimeMins < historicalAvg) {
        db.users[userId].timeSavedMins += (historicalAvg - waitTimeMins);
    }
    
    // Trigger Auto-Learning (EMA)
    updateHistoricalStats(id, waitTime, newReport.created_at);

    // Retrain ML model for this POI (incremental)
    try {
        const updatedHistory = registry.getHistoryForPoi(id);
        const poiReports = registry.getReportsForPoi(id);
        mlPredictor.trainModel(id, updatedHistory, poiReports);
    } catch (e) { /* ML not critical */ }

    // Compute updated prediction and broadcast via WebSocket
    const poiReports = registry.getReportsForPoi(id);
    const poiHistory = registry.getHistoryForPoi(id);
    const prediction = predictWaitTime({
        reports: poiReports,
        historicalData: poiHistory,
        currentDay,
        currentHour,
        poiId: id,
    });

    // Broadcast real-time update to all clients
    socketService.broadcastPredictionUpdate(id, {
        ...prediction,
        poiName: poiExists.name,
    });
    socketService.broadcastNewReport(newReport);

    // Surge alert broadcast
    if (prediction.surgeDetected) {
        socketService.broadcastSurgeAlert(id, poiExists.name);
    }

    // Process Sticky Loop Alerts
    db.alerts.forEach(alert => {
        if (String(alert.poiId) === id) {
            if (prediction.waitTime <= alert.thresholdMins) {
                console.log(`[ALERT] Notifying ${alert.userId}: Queue is low at POI ${id}! Time is ${prediction.waitTime}m.`);
            }
        }
    });

    res.status(201).json({ 
        message: "Report added successfully",
        report: newReport,
        prediction,
        timeSavedMins: db.users[userId].timeSavedMins 
    });
};

module.exports = {
    handleWaitTimeReport
};
