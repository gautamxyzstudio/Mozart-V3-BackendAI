'use strict';

/**
 * Media cleanup → keeps Cloudflare R2 in sync with Strapi.
 *
 * 1. Logs every provider delete so you can see R2 removals in the server log
 *    (Media Library delete + "Replace media" already call provider.delete).
 * 2. When an entry (release, track, artist, user, blog, ticket...) is DELETED,
 *    its media files are removed from the Media Library AND from R2.
 * 3. When an entry is UPDATED and a media field is changed/cleared
 *    (e.g. new CoverArt), the old file is removed from the Media Library AND R2.
 *
 * Safety: a file is only removed if no other entry still references it
 * (e.g. the same CoverArt shared by a draft and a published release).
 */

const FILE_UID = 'plugin::upload.file';

// ---------- helpers ----------

const getMediaFieldMap = (strapi) => {
  const map = {};
  for (const [uid, ct] of Object.entries(strapi.contentTypes)) {
    if (!(uid.startsWith('api::') || uid === 'plugin::users-permissions.user')) continue;
    const fields = Object.entries(ct.attributes || {})
      .filter(([, attr]) => attr.type === 'media')
      .map(([name]) => name);
    if (fields.length) map[uid] = fields;
  }
  return map;
};

const getMorphTable = (strapi) => {
  try {
    return strapi.db.metadata.get(FILE_UID).attributes.related.joinTable.name;
  } catch (_) {
    return 'files_related_morphs';
  }
};

const collectMediaIds = async (strapi, uid, fields, where) => {
  if (!where) return [];
  const entries = await strapi.db.query(uid).findMany({
    where,
    select: ['id'],
    populate: Object.fromEntries(fields.map((f) => [f, { select: ['id'] }])),
  });

  const ids = new Set();
  for (const entry of entries) {
    for (const f of fields) {
      const val = entry[f];
      if (!val) continue;
      (Array.isArray(val) ? val : [val]).forEach((m) => m?.id && ids.add(m.id));
    }
  }
  return [...ids];
};

const removeUnusedFiles = async (strapi, fileIds, reason) => {
  if (!fileIds?.length) return;
  const morphTable = getMorphTable(strapi);

  for (const id of fileIds) {
    try {
      const row = await strapi.db
        .connection(morphTable)
        .where('file_id', id)
        .count('* as c')
        .first();
      if (Number(row?.c || 0) > 0) {
        strapi.log.info(`[media-cleanup] file #${id} still used elsewhere → kept`);
        continue;
      }

      const file = await strapi.db.query(FILE_UID).findOne({ where: { id } });
      if (!file) continue;

      // Deletes the original + all formats (thumbnail/small/...) from R2 and the DB row
      await strapi.plugin('upload').service('upload').remove(file);
      strapi.log.info(`[media-cleanup] removed file #${id} (${file.name}) – ${reason}`);
    } catch (err) {
      // Never block the admin action because of storage cleanup
      strapi.log.error(`[media-cleanup] failed to remove file #${id}: ${err.message}`);
    }
  }
};

// ---------- main ----------

module.exports = function registerMediaCleanup(strapi) {
  // (1) Log R2 deletes coming from the provider (Media Library delete / replace)
  const provider = strapi.plugin('upload').provider;
  if (provider && !provider.__r2LogWrapped) {
    const originalDelete = provider.delete.bind(provider);
    provider.delete = async (file, customParams) => {
      try {
        const res = await originalDelete(file, customParams);
        strapi.log.info(`[R2] deleted ${file.path ? file.path + '/' : ''}${file.hash}${file.ext}`);
        return res;
      } catch (err) {
        strapi.log.error(`[R2] delete FAILED for ${file.hash}${file.ext}: ${err.name} ${err.message}`);
        throw err;
      }
    };
    provider.__r2LogWrapped = true;
  }

  // (2) + (3) lifecycle cleanup on entries that have media fields
  const mediaMap = getMediaFieldMap(strapi);
  const models = Object.keys(mediaMap);
  strapi.log.info(`[media-cleanup] watching media on: ${models.join(', ')}`);

  strapi.db.lifecycles.subscribe({
    models,

    async beforeUpdate(event) {
      const fields = mediaMap[event.model.uid];
      const data = event.params?.data || {};
      // Only do work when a media field is part of this update
      const touched = fields.filter((f) => Object.prototype.hasOwnProperty.call(data, f));
      if (!touched.length) return;
      event.state = event.state || {};
      event.state.mediaFields = touched;
      event.state.oldMediaIds = await collectMediaIds(strapi, event.model.uid, touched, event.params.where);
    },

    async afterUpdate(event) {
      const { oldMediaIds, mediaFields } = event.state || {};
      if (!oldMediaIds?.length) return;
      const currentIds = await collectMediaIds(
        strapi,
        event.model.uid,
        mediaFields,
        { id: event.result?.id ?? event.params.where?.id }
      );
      const replaced = oldMediaIds.filter((id) => !currentIds.includes(id));
      await removeUnusedFiles(strapi, replaced, `replaced on ${event.model.uid}#${event.result?.id}`);
    },

    async beforeDelete(event) {
      event.state = event.state || {};
      event.state.oldMediaIds = await collectMediaIds(
        strapi, event.model.uid, mediaMap[event.model.uid], event.params.where
      );
    },

    async afterDelete(event) {
      await removeUnusedFiles(strapi, event.state?.oldMediaIds, `entry deleted on ${event.model.uid}`);
    },

    async beforeDeleteMany(event) {
      event.state = event.state || {};
      event.state.oldMediaIds = await collectMediaIds(
        strapi, event.model.uid, mediaMap[event.model.uid], event.params.where
      );
    },

    async afterDeleteMany(event) {
      await removeUnusedFiles(strapi, event.state?.oldMediaIds, `bulk delete on ${event.model.uid}`);
    },
  });
};
