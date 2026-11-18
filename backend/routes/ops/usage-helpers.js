"use strict";

const { estimateUsd } = require("../../config/pricing");

/**
 * usage-helpers.js — cost estimation utilities for the usage dashboard.
 *
 * Prices come from config/pricing.js, the single price table shared with the
 * daily dollar budget and the Sanctum cost view.
 */

/**
 * Estimate cost for one job item based on model + provider fields.
 * Returns 0 for unknown models/providers.
 *
 * @param {object} item - DynamoDB JOB# item
 * @param {string} [item.model]
 * @param {string} [item.provider]
 * @returns {number} estimated cost in USD
 */
const estimateJobCost = (item = {}) => {
  const model = String(item.model || "")
    .toLowerCase()
    .trim();
  const provider = String(item.provider || "")
    .toLowerCase()
    .trim();

  return estimateUsd({ priceKey: model, provider, count: 1 });
};

/**
 * Parse a window string ("24h", "7d", "30d") into a "since" ISO timestamp.
 * Defaults to 24h if unrecognised.
 *
 * @param {string} window
 * @returns {string} ISO timestamp
 */
const parseUsageWindow = (window = "24h") => {
  const now = Date.now();
  if (window === "7d") return new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  if (window === "30d") return new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  // Default: 24h
  return new Date(now - 24 * 60 * 60 * 1000).toISOString();
};

/**
 * Aggregate JOB# items into a usage summary.
 *
 * @param {Array<object>} items - JOB# DynamoDB items
 * @returns {object} aggregated usage data
 */
const aggregateUsage = (items = []) => {
  let jobCount = 0;
  let failedCount = 0;
  let totalUsd = 0;
  const byProviderMap = new Map();
  const byModelMap = new Map();

  for (const item of items) {
    jobCount += 1;
    const status = String(item.status || "").toLowerCase();
    if (status === "failed") failedCount += 1;

    const provider = String(item.provider || "unknown").toLowerCase();
    const model = String(item.model || "unknown").toLowerCase();
    const cost = estimateJobCost(item);
    totalUsd += cost;

    // by provider
    const provEntry = byProviderMap.get(provider) || { provider, count: 0, usd: 0 };
    provEntry.count += 1;
    provEntry.usd += cost;
    byProviderMap.set(provider, provEntry);

    // by model
    const modelEntry = byModelMap.get(model) || { model, count: 0, usd: 0 };
    modelEntry.count += 1;
    modelEntry.usd += cost;
    byModelMap.set(model, modelEntry);
  }

  const recentFailureRate = jobCount > 0 ? failedCount / jobCount : 0;

  const byProvider = Array.from(byProviderMap.values()).sort((a, b) => b.count - a.count);
  const byModel = Array.from(byModelMap.values()).sort((a, b) => b.count - a.count);

  return {
    jobCount,
    failedCount,
    recentFailureRate: Math.round(recentFailureRate * 1000) / 1000,
    totalUsd: Math.round(totalUsd * 10000) / 10000,
    byProvider,
    byModel,
  };
};

module.exports = {
  estimateJobCost,
  parseUsageWindow,
  aggregateUsage,
};
