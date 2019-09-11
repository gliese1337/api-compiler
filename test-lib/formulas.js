module.exports = [
  function escSaleRate(saleRate, saleEscFactor) {
    return saleRate * saleEscFactor;
  },
  function escUtilityRate(
    utilityRate,
    utilityEscFactor
  ) {
    return utilityRate * utilityEscFactor;
  },
  function defaultTrigger(
    escSaleRate,
    escUtilityRate
  ) {
    return escSaleRate < escUtilityRate ? 0 : 1;
  },
  function defaultRateDelta(
    escSaleRate,
    escUtilityRate,
    savingsBuffer,
    defaultTrigger
  ) {
    return Math.max(escSaleRate - escUtilityRate * (1 - savingsBuffer), 0) * defaultTrigger;
  },
  function upsideSlopeFactor(
    saleRate,
    baseRate,
    upsideScale
  ) {
    return 1 + Math.max(saleRate - baseRate, 0) * upsideScale;
  },
  function salesCost(
    contractDiscRevShare,
    upsideSlopeFactor,
    contractLowRatePenalty,
    contractDefPenalty
  ) {
    return contractDiscRevShare * upsideSlopeFactor - contractLowRatePenalty - contractDefPenalty;
  },
];