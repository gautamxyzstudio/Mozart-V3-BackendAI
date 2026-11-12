'use strict';

const notification = require('./notification');

/**
 * ====================================================================
 * NOTIFICATION EVENTS MANAGER
 * ====================================================================
 * Centralized place to define all trigger-based notifications (both in-app & push).
 * You can add any new notification scenarios here without modifying core business logic.
 */

module.exports = {

  /**
   * 1. PRIORITY RELEASE UPLOAD NOTIFICATION
   * Triggered when a new publish-distribute record is created with Priority = 'Priority'.
   * Sends notification EXCLUSIVELY to the user who uploaded the release.
   *
   * @param {object} event - Strapi lifecycle event or release object
   */
  async onPublishDistributeCreated(event) {
    try {
      const result = event.result || event;
      const data = event.params?.data || {};

      if (!result || !result.id) return;

      // Check if Priority is set to "Priority" (case-insensitive check)
      const priorityValue = result.Priority || data.Priority;
      const isPriority = String(priorityValue || '').trim().toLowerCase() === 'priority';

      if (!isPriority) {
        // Not a priority upload - do nothing
        return;
      }

      // Fetch release with UserDetail populated to guarantee we have the owner user ID
      const release = await strapi.db
        .query('api::publish-distribute.publish-distribute')
        .findOne({
          where: { id: result.id },
          populate: ['UserDetail'],
        });

      if (!release) return;

      const userId = release.UserDetail?.id;
      if (!userId) {
        strapi.log.warn(`⚠️ [NotificationEvents] No UserDetail found for Priority release #${result.id}`);
        return;
      }

      const releaseTitle = release.ReleaseTitle || 'Your release';
      const title = 'Priority Release Uploaded! 🚀';
      const message = `Your release "${releaseTitle}" was submitted with Priority status and has been queued for expedited processing.`;

      // Sends in-app DB notification + Push Notification (Expo / Firebase) to ONLY this user
      await notification.sendToUser(userId, title, message, {
        type: 'PRIORITY_RELEASE_UPLOADED',
        releaseId: String(release.id),
        screen: 'ReleaseDetails',
      });

      strapi.log.info(`⚡ [NotificationEvents] Priority release notification sent to user #${userId} for release "${releaseTitle}"`);
    } catch (error) {
      strapi.log.error('❌ [NotificationEvents] Error in onPublishDistributeCreated:', error);
    }
  },

  /**
   * ====================================================================
   * TEMPLATES / HOOKS FOR FUTURE NOTIFICATIONS (ADD YOUR OWN BELOW)
   * ====================================================================
   */

  /**
   * Example: Send notification when release status changes (e.g. Completed, Live, Rejected)
   */
  async onReleaseStatusChanged(userId, releaseTitle, newStatus) {
    try {
      if (!userId) return;
      await notification.sendToUser(
        userId,
        `Release ${newStatus} 🎵`,
        `Your release "${releaseTitle}" status is now ${newStatus}.`,
        { type: 'RELEASE_STATUS_UPDATE', status: newStatus }
      );
    } catch (error) {
      strapi.log.error('❌ [NotificationEvents] Error in onReleaseStatusChanged:', error);
    }
  },

  /**
   * Example: Send notification on payout status updates
   */
  async onPayoutUpdated(userId, amount, status) {
    try {
      if (!userId) return;
      await notification.sendToUser(
        userId,
        `Payout ${status} 💰`,
        `Your payout request for ${amount} has been ${status.toLowerCase()}.`,
        { type: 'PAYOUT_UPDATE', status }
      );
    } catch (error) {
      strapi.log.error('❌ [NotificationEvents] Error in onPayoutUpdated:', error);
    }
  },

  /**
   * Example: Send notification on ticket response
   */
  async onTicketMessageReceived(userId, ticketNumber) {
    try {
      if (!userId) return;
      await notification.sendToUser(
        userId,
        `New Ticket Reply 📩`,
        `You have received a new reply on ticket #${ticketNumber}.`,
        { type: 'TICKET_REPLY', ticketNumber }
      );
    } catch (error) {
      strapi.log.error('❌ [NotificationEvents] Error in onTicketMessageReceived:', error);
    }
  },

};
