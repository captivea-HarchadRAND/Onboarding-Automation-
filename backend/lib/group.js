const { graphFetch } = require('./graph');

async function listGroups(search = '') {
  // Sanitisation par liste blanche (plus robuste qu'une denylist) : on ne garde que
  // lettres, chiffres, espace, point et tiret — neutralise toute syntaxe OData/URL.
  const safe = [...String(search)].filter(c => /[\p{L}\p{N} .\-]/u.test(c)).join('').slice(0, 128).trim();
  const term = safe ? `SP ${safe}` : 'SP -';
  const data = await graphFetch(
    `/groups?$search="displayName:${term}"&$select=id,displayName,description,securityEnabled,mailEnabled&$top=200&$count=true`,
    {},
    { ConsistencyLevel: 'eventual' }
  );
  return (data.value || [])
    .filter(g => g.securityEnabled === true && g.mailEnabled === false)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

async function addMemberToGroup(groupId, userId) {
  return graphFetch(`/groups/${encodeURIComponent(groupId)}/members/$ref`, {
    method: 'POST',
    body: {
      '@odata.id': `https://graph.microsoft.com/v1.0/directoryObjects/${encodeURIComponent(userId)}`,
    },
  });
}

async function getGroupById(id) {
  return graphFetch(`/groups/${encodeURIComponent(id)}?$select=id,displayName`);
}

module.exports = { listGroups, addMemberToGroup, getGroupById };
