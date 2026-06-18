const { graphFetch } = require('./graph');

async function listGroups(search = '') {
  const term = search ? `SP ${search}` : 'SP -';
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
  return graphFetch(`/groups/${groupId}/members/$ref`, {
    method: 'POST',
    body: {
      '@odata.id': `https://graph.microsoft.com/v1.0/directoryObjects/${userId}`,
    },
  });
}

async function getGroupById(id) {
  return graphFetch(`/groups/${id}?$select=id,displayName`);
}

module.exports = { listGroups, addMemberToGroup, getGroupById };
