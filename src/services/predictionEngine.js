// src/services/predictionEngine.js
// ──────────────────────────────────────────────────────────────
// Core prediction engine for Q-Predict.
// Combines real-time crowd reports, historical patterns, ML regression,
// and category-based baseline bootstrapping into a single prediction
// with uncertainty quantification and data reliability scoring.
//
// Architecture: Pure computation — no I/O, no side effects.
// All data is passed in, making this horizontally scalable.
// ──────────────────────────────────────────────────────────────

const DECAY_CONSTANT = 30;
const MAX_AGE = 120;

// ─── Category-based baseline estimates (minutes) ──
// Used when no reports AND no historical data exist.
const CATEGORY_BASELINES = {
  HOSPITAL: 25,
  BANK: 15,
  TEMPLE: 20,
  MOSQUE: 20,
  CHURCH: 15,
  GURUDWARA: 20,
  PHARMACY: 10,
  OTHER: 15,
};

function mapWaitTime(value) {
  if (value === "SHORT") return 10;
  if (value === "MEDIUM") return 25;
  return 45;
}

function recencyWeight(ageMinutes) {
  return Math.exp(-ageMinutes / DECAY_CONSTANT);
}

function filterOutliers(reports) {
  if (reports.length < 3) return reports;
  const values = reports.map(r => mapWaitTime(r.value || r.wait_time_category));
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return reports.filter(r => {
    const val = mapWaitTime(r.value || r.wait_time_category);
    return val < avg * 2 && val > avg * 0.5;
  });
}

function calculateVariance(reports) {
  if (!reports || reports.length < 2) return 0;
  const values = reports.map(r => mapWaitTime(r.value || r.wait_time_category));
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length;
}

function realTimePrediction(reports) {
  const now = Date.now();
  const validReports = reports.filter(r => {
    const ts = r.timestamp || new Date(r.created_at).getTime();
    return (now - ts) / (1000 * 60) <= MAX_AGE;
  });
  if (validReports.length === 0) return null;

  const cleaned = filterOutliers(validReports);
  let weightedSum = 0;
  let totalWeight = 0;

  for (const r of cleaned) {
    const ts = r.timestamp || new Date(r.created_at).getTime();
    const ageMinutes = (now - ts) / (1000 * 60);
    const weight = recencyWeight(ageMinutes) * (r.userTrust || 1);
    weightedSum += mapWaitTime(r.value || r.wait_time_category) * weight;
    totalWeight += weight;
  }

  return totalWeight === 0 ? null : weightedSum / totalWeight;
}

function detectSurge(reports) {
  const now = Date.now();
  return reports.filter(r => {
    const ts = r.timestamp || new Date(r.created_at).getTime();
    return (now - ts) / (1000 * 60) <= 15;
  }).length >= 5;
}

function detectTrend(reports) {
  const cleaned = filterOutliers(reports);
  if (cleaned.length < 3) return 'STABLE';
  
  const sorted = [...cleaned].sort((a, b) => {
    const tsA = a.timestamp || new Date(a.created_at).getTime();
    const tsB = b.timestamp || new Date(b.created_at).getTime();
    return tsA - tsB;
  });

  const mid = Math.floor(sorted.length / 2);
  const avgFirst = sorted.slice(0, mid).reduce((sum, r) => sum + mapWaitTime(r.value || r.wait_time_category), 0) / mid;
  const avgSecond = sorted.slice(mid).reduce((sum, r) => sum + mapWaitTime(r.value || r.wait_time_category), 0) / (sorted.length - mid);
  
  if (avgSecond > (avgFirst + 5)) return 'INCREASING';
  if (avgSecond < (avgFirst - 5)) return 'DECREASING';
  return 'STABLE';
}

function historicalPrediction(historicalData, currentDay, currentHour) {
  const key = `${currentDay}_${currentHour}`;
  return historicalData[key] || null;
}

function calculateConfidence(reports) {
  if (!reports.length) return 0;
  const countScore = Math.min(reports.length / 10, 1);
  const now = Date.now();
  const recentReports = reports.filter(r => {
    const ts = r.timestamp || new Date(r.created_at).getTime();
    return (now - ts) / (1000 * 60) < 30;
  });
  const recencyScore = recentReports.length / reports.length;
  const values = reports.map(r => mapWaitTime(r.value || r.wait_time_category));
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length;
  const consistencyScore = variance < 50 ? 1 : 0.5;
  return (countScore * 0.4) + (recencyScore * 0.3) + (consistencyScore * 0.3);
}

// ─── Data Reliability Scoring ────────────────────

function computeReliability(confidenceScore, reportCount, dataFreshness) {
  if (confidenceScore >= 70 && reportCount >= 5 && dataFreshness !== 'stale') return 'HIGH';
  if (confidenceScore >= 30 || reportCount >= 2) return 'MEDIUM';
  return 'LOW';
}

// ══════════════════════════════════════════════════
// MAIN PREDICTION ENGINE
// ══════════════════════════════════════════════════

function predictWaitTime({
  reports,
  historicalData,
  currentDay,
  currentHour,
  poiId,
  poiType  // optional — used for baseline bootstrapping
}) {
  const realTime = realTimePrediction(reports);
  const historical = historicalPrediction(historicalData, currentDay, currentHour);
  const confidence = calculateConfidence(reports);

  let finalPrediction;
  let predictionSource = 'blended';

  if (realTime === null && historical === null) {
    // ─── Bootstrap: use category baseline instead of null ─
    const baseline = CATEGORY_BASELINES[poiType] || CATEGORY_BASELINES.OTHER;
    finalPrediction = baseline;
    predictionSource = 'baseline';
  } else if (realTime === null) {
    finalPrediction = historical;
    predictionSource = 'historical';
  } else if (historical === null) {
    finalPrediction = realTime;
    predictionSource = 'realtime';
  } else {
    finalPrediction = realTime * confidence + historical * (1 - confidence);
    predictionSource = 'blended';
  }

  // ─── ML Blending (confidence-weighted) ───────────
  let mlContribution = null;
  if (poiId) {
    try {
      const mlPredictor = require('./mlPredictor');
      if (mlPredictor.hasModel(String(poiId))) {
        const mlPred = mlPredictor.predict(String(poiId), currentDay, currentHour, historical);
        if (mlPred !== null && finalPrediction !== null) {
          const confidenceAdjustedML = mlPred * confidence;
          mlContribution = Math.round(mlPred);
          finalPrediction = finalPrediction * 0.7 + confidenceAdjustedML * 0.3;
        }
      }
    } catch (e) { /* ML not available */ }
  }

  // ─── Signal Detection ──────────────────────────
  let surgeDetected = false;
  let queueTrend = 'STABLE';

  if (reports && reports.length > 0) {
    surgeDetected = detectSurge(reports);
    queueTrend = detectTrend(reports);
  }

  let numericWait = Math.round(finalPrediction || 0);

  // Adaptive trend adjustment
  let trendStrength = 0;
  if (queueTrend === 'INCREASING') trendStrength = 1;
  else if (queueTrend === 'DECREASING') trendStrength = -1;
  numericWait = Math.max(1, numericWait + Math.round(trendStrength * confidence * 10));

  // Category mapping
  let categoryWait = 'UNKNOWN';
  if (numericWait > 0) {
      if (numericWait <= 15) categoryWait = 'SHORT';
      else if (numericWait <= 35) categoryWait = 'MEDIUM';
      else categoryWait = 'LONG';
  }

  // ─── Decision Engine ───────────────────────────
  const confidenceScore = Math.round(confidence * 100);
  let decisionRecommendation = 'WAIT';
  
  if (surgeDetected || numericWait > 45) {
    decisionRecommendation = 'AVOID';
  } else if (numericWait <= 15 && confidenceScore > 60) {
    decisionRecommendation = 'GO_NOW';
  } else if (queueTrend === 'DECREASING') {
    decisionRecommendation = 'WAIT';
  } else if (numericWait <= 35) {
    decisionRecommendation = queueTrend === 'INCREASING' ? 'GO_NOW' : 'WAIT'; 
  }

  // For baseline predictions, always recommend WAIT (low confidence)
  if (predictionSource === 'baseline') {
    decisionRecommendation = 'WAIT';
  }

  // ─── Uncertainty Quantification ────────────────
  const variance = calculateVariance(reports);
  const stdDev = Math.sqrt(variance);
  const uncertaintyMultiplier = confidenceScore > 0 ? (1 - confidence) + 0.5 : 2;
  const uncertaintyMinutes = Math.max(2, Math.round(stdDev * uncertaintyMultiplier));
  const uncertainty = predictionSource === 'baseline' ? '±10 min' : `±${uncertaintyMinutes} min`;

  // ─── Data Credibility ─────────────────────────
  const now = Date.now();
  const reportCount = reports ? reports.length : 0;
  let lastReportAge = null;
  let dataFreshness = 'none';

  if (reports && reports.length > 0) {
    const lastTs = Math.max(...reports.map(r => new Date(r.created_at || r.timestamp).getTime()));
    lastReportAge = Math.round((now - lastTs) / (1000 * 60));
    dataFreshness = lastReportAge < 10 ? 'fresh' : lastReportAge < 60 ? 'moderate' : 'stale';
  }

  // ─── Data Reliability ─────────────────────────
  const dataReliability = computeReliability(confidenceScore, reportCount, dataFreshness);

  // ─── Network Effect ───────────────────────────
  let accuracyTrend = 'stable';
  if (reportCount >= 10 && confidenceScore > 70) {
    accuracyTrend = 'improving';
  } else if (reportCount < 3) {
    accuracyTrend = 'building';
  }

  // ─── Explainability ────────────────────────────
  let explanation = '';
  if (predictionSource === 'baseline') {
    explanation = '📊 Estimated based on typical patterns for this category.';
  } else if (confidenceScore < 30) {
    explanation = '⚠️ Prediction uncertain — needs more crowd reports.';
  } else if (realTime === null && historical !== null) {
    explanation = 'Historical mode: based on past patterns for this time slot.';
  } else {
    const recentMin = lastReportAge !== null ? ` in last ${Math.max(1, lastReportAge)} min` : '';
    explanation = `Based on ${reportCount} report${reportCount !== 1 ? 's' : ''}${recentMin}.`;
    if (mlContribution !== null) {
      explanation += ` ML layer contributed ~${mlContribution}m.`;
    }
  }

  return {
    waitTime: numericWait,
    avgWait: categoryWait,
    confidence: confidenceScore,
    uncertainty,
    surgeDetected,
    isTrendingUp: queueTrend === 'INCREASING',
    queueTrend,
    decisionRecommendation,
    explanation,
    predictionSource,
    // Data Credibility
    reportCount,
    lastReportAge,
    dataFreshness,
    dataReliability,
    // ML
    mlContribution,
    // Network Effect
    accuracyTrend,
  };
}

module.exports = {
  predictWaitTime,
};
