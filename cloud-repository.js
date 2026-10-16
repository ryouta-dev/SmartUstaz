(function (root) {
  'use strict';

  function client() {
    if (!root.SmartAuth || !root.SmartAuth.isConfigured()) throw new Error('cloud_not_configured');
    return root.SmartAuth.getClient();
  }

  function validObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value) && JSON.stringify(value).length <= 1048576;
  }

  async function list(table) {
    var result = await client().from(table).select('*').order('updated_at', { ascending: false }).limit(500);
    if (result.error) throw result.error;
    return result.data || [];
  }

  async function create(table, values) {
    if (!validObject(values.content) || !values.local_id || String(values.local_id).length > 160) throw new Error('invalid_cloud_record');
    var api = client();
    var session = await api.auth.getSession();
    if (session.error) throw session.error;
    if (!session.data.session || !session.data.session.user) throw new Error('auth_required');
    values.user_id = session.data.session.user.id;
    var result = await api.from(table).insert(values).select('*').single();
    if (result.error) throw result.error;
    return result.data;
  }

  async function update(table, id, expected, values) {
    if (!validObject(values.content)) throw new Error('invalid_cloud_record');
    var query = client().from(table).update(values).eq('id', id);
    query = table === 'documents' ? query.eq('version', expected) : query.eq('updated_at', expected);
    var result = await query.select('*').maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) throw new Error('cloud_conflict');
    return result.data;
  }

  async function remove(table, id) {
    var result = await client().from(table).delete().eq('id', id);
    if (result.error) throw result.error;
  }

  root.SmartCloud = {
    listDocuments: function () { return list('documents'); },
    listTemplates: function () { return list('templates'); },
    createDocument: function (values) { return create('documents', values); },
    createTemplate: function (values) { return create('templates', values); },
    updateDocument: function (id, version, values) { return update('documents', id, version, values); },
    updateTemplate: function (id, updatedAt, values) { return update('templates', id, updatedAt, values); },
    deleteDocument: function (id) { return remove('documents', id); },
    deleteTemplate: function (id) { return remove('templates', id); }
  };
})(window);
