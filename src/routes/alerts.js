// src/routes/alerts.js
const express = require('express');
const router = express.Router();
const db = require('../config/db');

// POST /api/alerts/subscribe
router.post('/subscribe', (req, res) => {
    const { userId, poiId, thresholdMins } = req.body;
    
    if (!userId || !poiId || !thresholdMins) {
        return res.status(400).json({ error: "Invalid data. Provide userId, poiId, and thresholdMins." });
    }

    const poiExists = db.pois.find(p => p.id === parseInt(poiId));
    if (!poiExists) {
         return res.status(404).json({ error: "POI not found." });
    }
    
    // Ensure user obj exists in DB
    if (!db.users[userId]) {
        db.users[userId] = { trustScore: 1.0, actions: [], timeSavedMins: 0 };
    }

    db.alerts.push({
        userId,
        poiId: parseInt(poiId),
        thresholdMins: parseInt(thresholdMins)
    });

    res.status(201).json({ message: "Subscribed to alerts successfully" });
});

module.exports = router;
