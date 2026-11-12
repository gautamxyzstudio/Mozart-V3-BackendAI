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
   * 5. SUBSCRIPTION PURCHASED OR UPGRADED NOTIFICATION
   * Triggered when a user buys or upgrades to a plan (Artist, Artist Plus, Pro Label, etc.).
   *
   * @param {number|string} userId
   * @param {string} planName - e.g. "Artist", "Artist Plus", "Pro Label"
   * @param {string} [subscriptionType="subscription"] - "subscription" | "upgrade"
   */
  async onSubscriptionPurchased(userId, planName, subscriptionType = 'subscription') {
    try {
      if (!userId) return;

      const name = planName || 'Subscription';
      const isUpgrade = String(subscriptionType || '').toLowerCase() === 'upgrade';

      const title = isUpgrade
        ? `Plan Upgraded to ${name}! 🚀`
        : `Subscription Activated! 👑`;

      const message = isUpgrade
        ? `Congratulations! Your plan has been upgraded to ${name}. Your new limits and benefits are now active.`
        : `Welcome to ${name}! Your subscription is now active. Enjoy full access to all your plan benefits.`;

      await notification.sendToUser(
        userId,
        title,
        message,
        {
          type: isUpgrade ? 'SUBSCRIPTION_UPGRADED' : 'SUBSCRIPTION_PURCHASED',
          plan: name,
          screen: 'Subscription',
        }
      );

      strapi.log.info(`👑 [NotificationEvents] Subscription notification sent to user #${userId} for plan "${name}"`);
    } catch (error) {
      strapi.log.error('❌ [NotificationEvents] Error in onSubscriptionPurchased:', error);
    }
  },

  /**
   * 6. ARTIST ADD-ON PURCHASED NOTIFICATION
   * Triggered when a user purchases extra artist slots.
   *
   * @param {number|string} userId
   * @param {number|string} additionalArtists - e.g. 5, 10
   * @param {number|string} [newTotalLimit]
   */
  async onArtistAddonPurchased(userId, additionalArtists, newTotalLimit = null) {
    try {
      if (!userId) return;

      const count = Number(additionalArtists) || 1;
      const title = 'Artist Add-on Activated! 🎤';
      const message = newTotalLimit
        ? `Success! You added ${count} extra artist slot${count > 1 ? 's' : ''}. Your total artist limit is now ${newTotalLimit}.`
        : `Success! You added ${count} extra artist slot${count > 1 ? 's' : ''} to your account.`;

      await notification.sendToUser(
        userId,
        title,
        message,
        {
          type: 'ARTIST_ADDON_PURCHASED',
          additionalArtists: String(count),
          newTotalLimit: String(newTotalLimit || ''),
          screen: 'ArtistList',
        }
      );

      strapi.log.info(`🎤 [NotificationEvents] Artist add-on (${count} slots) notification sent to user #${userId}`);
    } catch (error) {
      strapi.log.error('❌ [NotificationEvents] Error in onArtistAddonPurchased:', error);
    }
  },

  /**
   * 7. MORNING RELEASE-DAY NOTIFICATION
   * Runs daily in the morning to find releases whose DigitalReleaseDate is TODAY.
   * If a release was already completed (live before DigitalReleaseDate) or cancelled, it is skipped.
   */
  async checkAndSendReleaseDayNotifications() {
    try {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const todayStr = `${year}-${month}-${day}`;

      const startOfDay = new Date(year, now.getMonth(), now.getDate(), 0, 0, 0);

      strapi.log.info(`📅 [NotificationEvents] Checking for releases scheduled to go live today: ${todayStr}`);

      // Only query releases where DigitalReleaseDate is strictly today,
      // and Status is NOT 'Completed' (already live) and NOT 'Cancelled'
      const releases = await strapi.db
        .query('api::publish-distribute.publish-distribute')
        .findMany({
          where: {
            DigitalReleaseDate: todayStr,
            Status: {
              $notIn: ['Completed', 'Cancelled'],
            },
          },
          populate: ['UserDetail'],
        });

      if (!releases || releases.length === 0) {
        strapi.log.info(`ℹ️ [NotificationEvents] No pending releases scheduled to go live on ${todayStr}.`);
        return { count: 0, sent: 0 };
      }

      let sentCount = 0;

      for (const release of releases) {
        const userId = release.UserDetail?.id;
        if (!userId) continue;

        const releaseTitle = release.ReleaseTitle || 'Your release';

        // Prevent duplicate notification on the same day if server restarts
        const alreadyNotified = await strapi.db
          .query('api::notification.notification')
          .findOne({
            where: {
              users_permissions_user: userId,
              title: 'Your Release Goes Live Today! 🚀',
              createdAt: {
                $gte: startOfDay,
              },
            },
          });

        if (alreadyNotified) {
          strapi.log.info(`⏭️ [NotificationEvents] User #${userId} already notified today for "${releaseTitle}".`);
          continue;
        }

        const title = 'Your Release Goes Live Today! 🚀';
        const message = `Get ready! Your release "${releaseTitle}" is scheduled to go live today. Share it with your fans and stream it now!`;

        await notification.sendToUser(
          userId,
          title,
          message,
          {
            type: 'RELEASE_GOES_LIVE_TODAY',
            releaseId: String(release.id),
            screen: 'ReleaseDetails',
          }
        );

        sentCount++;
      }

      strapi.log.info(`🎉 [NotificationEvents] Sent ${sentCount} release-day notifications for ${todayStr}.`);
      return { count: releases.length, sent: sentCount };
    } catch (error) {
      strapi.log.error('❌ [NotificationEvents] Error in checkAndSendReleaseDayNotifications:', error);
      return { error: error.message };
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
