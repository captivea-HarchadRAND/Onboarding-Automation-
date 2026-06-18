const { graphFetch } = require('./graph');

// Noms lisibles pour les SKUs les plus courants
const FRIENDLY_NAMES = {
  SPE_E3: 'Microsoft 365 E3',
  SPE_E5: 'Microsoft 365 E5',
  SPE_F1: 'Microsoft 365 F1',
  O365_BUSINESS_PREMIUM: 'Microsoft 365 Business Premium',
  O365_BUSINESS_ESSENTIALS: 'Microsoft 365 Business Basic',
  O365_BUSINESS: 'Microsoft 365 Apps for Business',
  ENTERPRISEPACK: 'Office 365 E3',
  ENTERPRISEPREMIUM: 'Office 365 E5',
  STANDARDPACK: 'Office 365 E1',
  EXCHANGESTANDARD: 'Exchange Online (Plan 1)',
  EXCHANGEENTERPRISE: 'Exchange Online (Plan 2)',
  TEAMS_FREE: 'Microsoft Teams (Free)',
  POWER_BI_STANDARD: 'Power BI (Free)',
  POWER_BI_PRO: 'Power BI Pro',
  PROJECTPREMIUM: 'Project Plan 5',
  PROJECTPROFESSIONAL: 'Project Plan 3',
  VISIOCLIENT: 'Visio Plan 2',
  MCOSTANDARD: 'Skype for Business Online (Plan 2)',
  INTUNE_A: 'Microsoft Intune',
  AAD_PREMIUM: 'Azure Active Directory Premium P1',
  AAD_PREMIUM_P2: 'Azure Active Directory Premium P2',
};

async function listAvailableLicenses() {
  const data = await graphFetch('/subscribedSkus');
  return (data.value || [])
    .filter(
      sku =>
        sku.capabilityStatus === 'Enabled' &&
        sku.prepaidUnits.enabled - sku.consumedUnits > 0
    )
    .map(sku => ({
      skuId: sku.skuId,
      skuPartNumber: sku.skuPartNumber,
      displayName: FRIENDLY_NAMES[sku.skuPartNumber] || sku.skuPartNumber,
      available: sku.prepaidUnits.enabled - sku.consumedUnits,
      total: sku.prepaidUnits.enabled,
      consumed: sku.consumedUnits,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

async function assignLicense(userId, skuId) {
  return graphFetch(`/users/${userId}/assignLicense`, {
    method: 'POST',
    body: {
      addLicenses: [{ skuId, disabledPlans: [] }],
      removeLicenses: [],
    },
  });
}

module.exports = { listAvailableLicenses, assignLicense };
