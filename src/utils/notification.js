'use strict';

const { sendPushToUser, sendPushToAllAuthenticatedUsers } = require('./push-notification');

module.exports = {
  /**
   * Broadcast in-app notification to all authenticated users.
   * Push notification to devices is DISABLED by default so that routine system events
   * (e.g. artist creation, user registration) do not spam every user's mobile device.
   *
   * @param {string} title
   * @param {string} message
   * @param {object} [extraData] - Optional metadata payload for client deep-linking
   * @param {object} [options]
   * @param {boolean} [options.sendPush=false] - Only send device push if explicitly set to true
   */
  async sendToAuthenticatedUsers(title, message, extraData = {}, options = {}) {
    try {
      const role = await strapi.db
        .query('plugin::users-permissions.role')
        .findOne({
          where: { type: 'authenticated' },
        });

      if (!role) return;

      const users = await strapi.db
        .query('plugin::users-permissions.user')
        .findMany({
          where: { role: role.id },
          select: ['id'],
        });

      if (!users.length) return;

      // 1. Create in-app notification records in DB for each user
      for (const user of users) {
        await strapi.db
          .query('api::notification.notification')
          .create({
            data: {
              title,
              message,
              users_permissions_user: user.id,
              publishedAt: new Date(),
            },
          });
      }

      strapi.log.info(`✅ [Notification] In-app notifications created for ${users.length} users.`);

      // 2. Only dispatch broadcast push notifications if explicitly requested
      if (options.sendPush === true) {
        await sendPushToAllAuthenticatedUsers({
          title,
          body: message,
          data: extraData,
        });
      }

    } catch (err) {
      strapi.log.error('❌ Notification broadcast error:', err);
    }
  },

  /**
   * Send notification to a specific user (In-App DB + FCM/Expo Device Push)
   *
   * @param {number|string} userId - Strapi user ID
   * @param {string} title
   * @param {string} message
   * @param {object} [extraData] - Optional metadata payload for client deep-linking
   * @param {object} [options]
   * @param {boolean} [options.sendPush=true] - Whether to send device push (defaults to true)
   */
  async sendToUser(userId, title, message, extraData = {}, options = { sendPush: true }) {
    try {
      if (!userId) return;

      // 1. Save in-app notification to database
      await strapi.db
        .query('api::notification.notification')
        .create({
          data: {
            title,
            message,
            users_permissions_user: userId,
            publishedAt: new Date(),
          },
        });

      // 2. Dispatch push notification to this specific user's registered devices
      if (options.sendPush !== false) {
        await sendPushToUser(userId, {
          title,
          body: message,
          data: extraData,
        });
      }

      strapi.log.info(`✅ [Notification] Sent to user #${userId} (In-App + Push)`);
    } catch (err) {
      strapi.log.error('❌ User notification error:', err);
    }
  },
};
