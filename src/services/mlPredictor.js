// src/services/mlPredictor.js
// Lightweight ML prediction layer using multivariate linear regression.
// Pure JS — no external ML frameworks needed.

/**
 * Simple Linear Regression with multiple features.
 * Features: [dayOfWeek (0-6), hourOfDay (0-23), historicalAvg, recentAvg]
 * Target: wait time in minutes
 */

// Model weights (initialized, updated via training)
const models = {}; // keyed by poiId

// Normalize features to 0-1 range
function normalize(val, min, max) {
    if (max === min) return 0;
    return (val - min) / (max - min);
}

/**
 * Train a simple linear regression model for a POI using its historical data.
 * Uses gradient descent on normalized features.
 */
function trainModel(poiId, historicalData, reports = []) {
    const dataPoints = [];

    // Extract training data from historical buckets
    for (const [timeKey, waitMinutes] of Object.entries(historicalData)) {
        const [day, hour] = timeKey.split('_').map(Number);
        dataPoints.push({
            features: [day / 6, hour / 23, waitMinutes / 60], // normalized
            target: waitMinutes,
        });
    }

    // Also include recent reports if available
    for (const report of reports.slice(-50)) {
        const ts = new Date(report.created_at || report.timestamp);
        const waitMins = mapCategory(report.wait_time_category || report.value);
        if (waitMins === null) continue;

        dataPoints.push({
            features: [ts.getUTCDay() / 6, ts.getUTCHours() / 23, waitMins / 60],
            target: waitMins,
        });
    }

    if (dataPoints.length < 3) {
        models[poiId] = null; // not enough data
        return;
    }

    // Simple gradient descent
    const numFeatures = 3;
    let weights = new Array(numFeatures).fill(0);
    let bias = 0;
    const lr = 0.01;
    const epochs = 200;

    for (let epoch = 0; epoch < epochs; epoch++) {
        let totalError = 0;
        for (const dp of dataPoints) {
            // Forward pass
            let predicted = bias;
            for (let i = 0; i < numFeatures; i++) {
                predicted += weights[i] * dp.features[i];
            }

            const error = predicted - dp.target;
            totalError += error * error;

            // Backward pass (gradient update)
            bias -= lr * error;
            for (let i = 0; i < numFeatures; i++) {
                weights[i] -= lr * error * dp.features[i];
            }
        }
    }

    models[poiId] = { weights, bias, dataPointCount: dataPoints.length };
}

/**
 * Predict wait time for a POI at a given day/hour.
 * Returns null if model hasn't been trained or has insufficient data.
 */
function predict(poiId, dayOfWeek, hourOfDay, historicalAvg = 0) {
    const model = models[poiId];
    if (!model) return null;

    const features = [dayOfWeek / 6, hourOfDay / 23, (historicalAvg || 0) / 60];

    let prediction = model.bias;
    for (let i = 0; i < features.length; i++) {
        prediction += model.weights[i] * features[i];
    }

    // Clamp to reasonable range
    return Math.max(0, Math.min(120, Math.round(prediction)));
}

/**
 * Check if a model exists and has enough data for a POI.
 */
function hasModel(poiId) {
    return models[poiId] && models[poiId].dataPointCount >= 5;
}

/**
 * Get model info for explainability.
 */
function getModelInfo(poiId) {
    const model = models[poiId];
    if (!model) return { trained: false };
    return {
        trained: true,
        dataPoints: model.dataPointCount,
        weights: model.weights.map(w => Math.round(w * 100) / 100),
    };
}

// Helper
function mapCategory(value) {
    if (value === 'SHORT') return 10;
    if (value === 'MEDIUM') return 25;
    if (value === 'LONG') return 45;
    return null;
}

module.exports = {
    trainModel,
    predict,
    hasModel,
    getModelInfo,
};
