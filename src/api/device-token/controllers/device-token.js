'use strict';

/**
 * device-token controller
 */

const { createCoreController } = require('@strapi/strapi').factories;
const { sendPushToUser } = require('../../../utils/push-notification');

module.exports = createCoreController('api::device-token.device-token', ({ strapi }) => ({

  /**
   * Register or refresh an FCM device token for the authenticated user
   * POST /api/device-tokens/register
   */
  async registerToken(ctx) {
    try {
      const user = ctx.state.user;
      if (!user) {
        return ctx.unauthorized('Authentication required');
      }

      const { token, platform = 'web' } = ctx.request.body || {};

      if (!token || typeof token !== 'string' || !token.trim()) {
        return ctx.badRequest('A valid FCM token is required in "token" field');
      }

      const cleanToken = token.trim();
      const validPlatforms = ['web', 'android', 'ios'];
      const normalizedPlatform = validPlatforms.includes(platform) ? platform : 'web';

      // Check if token already exists in DB
      const existing = await strapi.db
        .query('api::device-token.device-token')
        .findOne({
          where: { token: cleanToken },
        });

      if (existing) {
        // Re-assign token to current user and refresh lastActivityAt
        await strapi.db
          .query('api::device-token.device-token')
          .update({
            where: { id: existing.id },
            data: {
              users_permissions_user: user.id,
              platform: normalizedPlatform,
              lastActivityAt: new Date(),
            },
          });

        return ctx.send({
          success: true,
          message: 'Device token refreshed successfully',
        });
      }

      // Create new token mapping
      await strapi.db
        .query('api::device-token.device-token')
        .create({
          data: {
            token: cleanToken,
            platform: normalizedPlatform,
            users_permissions_user: user.id,
            lastActivityAt: new Date(),
          },
        });

      return ctx.send({
        success: true,
        message: 'Device token registered successfully',
      });
    } catch (error) {
      strapi.log.error('❌ Error registering device token:', error);
      return ctx.internalServerError('Failed to register device token');
    }
  },

  /**
   * Unregister / remove an FCM device token on user logout
   * POST /api/device-tokens/unregister
   */
  async removeToken(ctx) {
    try {
      const { token } = ctx.request.body || {};

      if (!token || typeof token !== 'string' || !token.trim()) {
        return ctx.badRequest('A valid "token" field is required');
      }

      await strapi.db
        .query('api::device-token.device-token')
        .deleteMany({
          where: { token: token.trim() },
        });

      return ctx.send({
        success: true,
        message: 'Device token unregistered successfully',
      });
    } catch (error) {
      strapi.log.error('❌ Error unregistering device token:', error);
      return ctx.internalServerError('Failed to unregister device token');
    }
  },

  /**
   * Send a test push notification to the logged-in user
   * POST /api/device-tokens/test-push
   */
  async testPush(ctx) {
    try {
      const user = ctx.state.user;
      if (!user) {
        return ctx.unauthorized('Authentication required');
      }

      const devices = await strapi.db
        .query('api::device-token.device-token')
        .findMany({
          where: { users_permissions_user: user.id },
          select: ['id', 'token'],
        });

      if (!devices.length) {
        return ctx.badRequest('No registered device tokens found for your user account. Please call /api/device-tokens/register first.');
      }

      const title = ctx.request.body?.title || 'Test Notification 🎵';
      const body = ctx.request.body?.message || 'Push notifications are working properly!';
      const data = ctx.request.body?.data || { type: 'TEST_PUSH' };

      const result = await sendPushToUser(user.id, {
        title,
        body,
        data,
      });

      return ctx.send({
        success: true,
        message: 'Test push notification dispatched',
        stats: result,
      });
    } catch (error) {
      strapi.log.error('❌ Error sending test push:', error);
      return ctx.internalServerError('Failed to send test push notification');
    }
  },

}));
