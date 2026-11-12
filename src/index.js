'use strict';

const sharp = require('sharp');

module.exports = {
  register(/*{ strapi }*/) {
    // Disable sharp cache on Windows to avoid EBUSY file lock errors on temp files
    sharp.cache(false);
  },

  async bootstrap({ strapi }) {

    const releases = await strapi.db
      .query('api::publish-distribute.publish-distribute')
      .findMany({ select: ['id'] });

    for (const release of releases) {
      await strapi
        .service('api::distribute-track.distribute-track')
        .checkAndUpdatePublish(release.id);
    }

    strapi.log.info('✔ PublishDistribute statuses recalculated');

    // =========================================================
    //    MORNING RELEASE-DAY NOTIFICATION CRON (Daily at 09:00 AM)
    // =========================================================
    const cron = require('node-cron');
    const notificationEvents = require('./utils/notification-events');

    cron.schedule('0 9 * * *', async () => {
      strapi.log.info('⏰ [Cron] Running morning release-day notification check...');
      try {
        await notificationEvents.checkAndSendReleaseDayNotifications();
      } catch (err) {
        strapi.log.error('❌ [Cron] Error during morning release-day notification check:', err);
      }
    });

    strapi.log.info('✔ Morning release-day notification cron scheduled (09:00 AM daily)');


    // =========================================================
    //    SEND NOTIFICATION TO ADMINS ON NEW USER/ARTIST/SONGS
    // =========================================================

    let previousStatusMap = {};
    let previousArtistVerifyMap = {};

    const notification = require('./utils/notification');

    strapi.db.lifecycles.subscribe({
      models: [
        "plugin::users-permissions.user",
        "api::artist-detail.artist-detail",
        "api::publish-distribute.publish-distribute",
      ],

      async afterCreate(event) {
        const { result, model } = event;

        console.log("🔥 GLOBAL AFTER CREATE:", model.uid);

        try {
          // 👤 USER
          if (model.uid === "plugin::users-permissions.user") {
            await notification.sendToAuthenticatedUsers(
              "New User Joined ",
              `${result.username || result.email} has joined`
            );
          }

          // 🎤 ARTIST
          if (model.uid === "api::artist-detail.artist-detail") {
            await notification.sendToAuthenticatedUsers(
              "New Artist Added",
              `${result.artistName} has been added`
            );

            // If artist was created with verification requested
            if (result.requiredVerification === true) {
              await notification.sendToAuthenticatedUsers(
                "Artist Verification Request",
                `${result.artistName} has submitted a verification request`
              );

              const artist = await strapi.db
                .query("api::artist-detail.artist-detail")
                .findOne({
                  where: { id: result.id },
                  populate: ["owner"],
                });
              const userId = artist?.owner?.id;
              if (userId) {
                const notificationEvents = require('./utils/notification-events');
                await notificationEvents.onArtistVerificationRequested(
                  userId,
                  artist.artistName,
                  artist.id
                );
              }
            }
          }

          // 🎶 RELEASE CREATED
          if (model.uid === "api::publish-distribute.publish-distribute") {
            await notification.sendToAuthenticatedUsers(
              "New song uploaded",
              `${result.ReleaseTitle} has been uploaded`
            );
          }

        } catch (err) {
          console.error("❌ Notification error:", err);
        }
      },

      async beforeUpdate(event) {
        const { where } = event.params;

        // 🎶 Track release status
        if (event.model.uid === "api::publish-distribute.publish-distribute") {
          const existing = await strapi.db
            .query("api::publish-distribute.publish-distribute")
            .findOne({
              where: { id: where.id },
              select: ["Status"],
            });

          previousStatusMap[where.id] = existing?.Status;
        }

        // 🎤 Track artist verification
        if (event.model.uid === "api::artist-detail.artist-detail") {
          const targetId = where?.id || (typeof where === 'number' || typeof where === 'string' ? where : null);
          if (targetId) {
            const existing = await strapi.db
              .query("api::artist-detail.artist-detail")
              .findOne({
                where: { id: targetId },
                select: ["itsVerified", "requiredVerification"],
              });

            previousArtistVerifyMap[targetId] = {
              itsVerified: existing?.itsVerified,
              requiredVerification: existing?.requiredVerification,
            };
          }
        }
      },
      async afterUpdate(event) {
        const { result, params, model } = event;
        const notification = require('./utils/notification');

        // =====================================================
        // 🎤 ARTIST VERIFICATION NOTIFICATIONS → notify owner
        // =====================================================
        if (model.uid === "api::artist-detail.artist-detail") {
          const previous = previousArtistVerifyMap[result.id] || {};
          delete previousArtistVerifyMap[result.id];

          const artist = await strapi.db
            .query("api::artist-detail.artist-detail")
            .findOne({
              where: { id: result.id },
              populate: ["owner"],
            });

          const userId = artist?.owner?.id;
          if (userId) {
            const notificationEvents = require('./utils/notification-events');

            // 1. User submitted verification request (requiredVerification changed to true)
            const isVerificationRequested =
              previous.requiredVerification !== true &&
              result.requiredVerification === true;

            if (isVerificationRequested) {
              await notification.sendToAuthenticatedUsers(
                "Artist Verification Request",
                `${artist.artistName} has submitted a verification request`
              );

              await notificationEvents.onArtistVerificationRequested(
                userId,
                artist.artistName,
                artist.id
              );
            }

            // 2. Admin approved verification (itsVerified changed to true)
            const isVerificationApproved =
              previous.itsVerified !== true &&
              result.itsVerified === true;

            if (isVerificationApproved) {
              await notificationEvents.onArtistVerificationUpdated(
                userId,
                artist.artistName,
                true,
                artist.id
              );
            }

            // 3. Admin rejected verification:
            // - requiredVerification reset from true to false while itsVerified remains false/not true
            // - OR itsVerified revoked from true to false
            const isVerificationRejected =
              (previous.requiredVerification === true && result.requiredVerification === false && result.itsVerified !== true) ||
              (previous.itsVerified === true && result.itsVerified === false);

            if (isVerificationRejected) {
              await notificationEvents.onArtistVerificationUpdated(
                userId,
                artist.artistName,
                false,
                artist.id
              );
            }
          }
        }

        // =====================================================
        // 🎶 RELEASE STATUS CHANGE → notify owner
        // =====================================================
        if (model.uid === "api::publish-distribute.publish-distribute") {

          const oldStatus = previousStatusMap[result.id];
          const newStatus = result.Status;

          delete previousStatusMap[result.id];

          console.log("OLD:", oldStatus, "NEW:", newStatus);

          // ✅ only when status actually changed
          if (oldStatus === newStatus) return;

          if (newStatus === "Completed" || newStatus === "Cancelled") {

            const release = await strapi.db
              .query("api::publish-distribute.publish-distribute")
              .findOne({
                where: { id: result.id },
                populate: ["UserDetail"],
              });

            const userId = release?.UserDetail?.id;

            if (userId) {
              const notificationEvents = require('./utils/notification-events');
              await notificationEvents.onReleaseStatusChanged(
                userId,
                release.ReleaseTitle,
                newStatus,
                release.id
              );
            }
          }
        }

        // =====================================================
        // 🌍 EXISTING GLOBAL PUBLISH NOTIFICATION 
        // =====================================================
        if (model.uid === "api::publish-distribute.publish-distribute") {

          const isPublishing =
            params?.data?.publishedAt && !params?.where?.publishedAt;

          if (!isPublishing) return;

          try {
            await notification.sendToAuthenticatedUsers(
              "New Release Published ",
              `${result.ReleaseTitle} is now live`
            );
          } catch (err) {
            console.error("❌ Publish notification error:", err);
          }
        }
      }
    });

  },
};