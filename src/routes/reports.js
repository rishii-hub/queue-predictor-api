// src/routes/reports.js

const express = require('express');
const router = express.Router();

const reportController = require('../controllers/reportController');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');


// 🔒 Rate Limiter (IPv6-safe + user-aware)
const reportLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 50, // limit each user/IP to 5 requests per hour

    keyGenerator: (req) => {
        // Prefer userId if available (logged-in users)
        if (req.body && req.body.userId) {
            return `user-${req.body.userId}`;
        }

        // Fallback to IP (safe for IPv6)
        return ipKeyGenerator(req);
    },

    standardHeaders: true,   // return rate limit info in headers
    legacyHeaders: false,    // disable old headers

    message: {
        error: "Rate limit exceeded. Try again later."
    },
});


// 📌 POST /api/reports/wait-time
router.post(
    '/wait-time',
    reportLimiter,
    reportController.handleWaitTimeReport
);


module.exports = router;