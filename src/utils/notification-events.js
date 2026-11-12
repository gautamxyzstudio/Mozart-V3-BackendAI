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
   * 2. RELEASE STATUS CHANGE NOTIFICATION
   * Triggered when a release status changes (e.g. Completed, Cancelled, In-Progress).
   *
   * @param {number|string} userId
   * @param {string} releaseTitle
   * @param {string} newStatus - "Completed" | "Cancelled" | "In-Progress"
   * @param {number|string} [releaseId]
   */
  async onReleaseStatusChanged(userId, releaseTitle, newStatus, releaseId = null) {
    try {
      if (!userId) return;

      const titleName = releaseTitle || 'Your release';
      let title = `Release Update: ${titleName} 🎵`;
      let message = `Your release "${titleName}" is now ${newStatus}.`;

      if (newStatus === 'Completed') {
        title = 'Release Approved & Live! 🎉';
        message = `Great news! "${titleName}" has been approved and successfully distributed to streaming platforms.`;
      } else if (newStatus === 'Cancelled') {
        title = 'Action Required: Release Cancelled ⚠️';
        message = `Your release "${titleName}" was cancelled. Please check your dashboard for details or submit a support ticket.`;
      } else if (newStatus === 'In-Progress') {
        title = 'Release Under Review ⏳';
        message = `"${titleName}" is currently being processed by our curation team.`;
      }

      await notification.sendToUser(
        userId,
        title,
        message,
        {
          type: 'RELEASE_STATUS_UPDATE',
          status: newStatus,
          releaseId: String(releaseId || ''),
          screen: 'ReleaseDetails',
        }
      );

      strapi.log.info(`🎶 [NotificationEvents] Status (${newStatus}) notification sent to user #${userId} for "${titleName}"`);
    } catch (error) {
      strapi.log.error('❌ [NotificationEvents] Error in onReleaseStatusChanged:', error);
    }
  },

  /**
   * 3. ARTIST VERIFICATION REQUEST SUBMITTED
   * Triggered when a user requests verification for their artist profile.
   *
   * @param {number|string} userId
   * @param {string} artistName
   * @param {number|string} [artistId]
   */
  async onArtistVerificationRequested(userId, artistName, artistId = null) {
    try {
      if (!userId) return;

      const name = artistName || 'Your artist';
      const title = 'Verification Request Submitted ⏳';
      const message = `Your request to verify "${name}" has been received and is pending admin review.`;

      await notification.sendToUser(
        userId,
        title,
        message,
        {
          type: 'ARTIST_VERIFICATION_REQUESTED',
          artistId: String(artistId || ''),
          screen: 'ArtistDetails',
        }
      );

      strapi.log.info(`🎤 [NotificationEvents] Verification request notification sent to user #${userId} for "${name}"`);
    } catch (error) {
      strapi.log.error('❌ [NotificationEvents] Error in onArtistVerificationRequested:', error);
    }
  },

  /**
   * 4. ARTIST VERIFICATION REVIEWED BY ADMIN (itsVerified updated)
   * Triggered when admin approves or rejects artist verification.
   *
   * @param {number|string} userId
   * @param {string} artistName
   * @param {boolean} itsVerified - true if approved, false if rejected
   * @param {number|string} [artistId]
   */
  async onArtistVerificationUpdated(userId, artistName, itsVerified, artistId = null) {
    try {
      if (!userId) return;

      const name = artistName || 'Your artist';
      let title = 'Artist Verification Update';
      let message = `Your artist profile "${name}" verification has been updated.`;

      if (itsVerified === true) {
        title = 'Artist Profile Verified! 🌟';
        message = `Congratulations! Your artist profile "${name}" has been successfully verified.`;
      } else if (itsVerified === false) {
        title = 'Artist Verification Rejected ❌';
        message = `Your verification request for "${name}" was not approved. Please review your artist details or contact support.`;
      }

      await notification.sendToUser(
        userId,
        title,
        message,
        {
          type: itsVerified ? 'ARTIST_VERIFIED' : 'ARTIST_VERIFICATION_REJECTED',
          status: itsVerified ? 'verified' : 'rejected',
          artistId: String(artistId || ''),
          screen: 'ArtistDetails',
        }
      );

      strapi.log.info(`🎤 [NotificationEvents] Artist verification (${itsVerified ? 'VERIFIED' : 'REJECTED'}) sent to user #${userId} for "${name}"`);
    } catch (error) {
      strapi.log.error('❌ [NotificationEvents] Error in onArtistVerificationUpdated:', error);
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
