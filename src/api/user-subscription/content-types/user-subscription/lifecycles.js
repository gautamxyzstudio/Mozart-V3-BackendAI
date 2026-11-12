'use strict';

const notificationEvents = require('../../../../utils/notification-events');

module.exports = {
  /**
   * Fires after a new subscription record is created
   */
  async afterCreate(event) {
    try {
      const { result } = event;
      if (!result || !result.id) return;

      if (result.status === 'active') {
        const sub = await strapi.db
          .query('api::user-subscription.user-subscription')
          .findOne({
            where: { id: result.id },
            populate: ['users_permissions_user', 'plan'],
          });

        const userId = sub?.users_permissions_user?.id;
        const planName = sub?.plan?.name;

        if (userId && planName) {
          await notificationEvents.onSubscriptionPurchased(
            userId,
            planName,
            sub.subscriptionType
          );
        }
      }
    } catch (error) {
      strapi.log.error('❌ [UserSubscription Lifecycles] Error in afterCreate:', error);
    }
  },

  /**
   * Fires after an existing subscription record is updated (e.g. status activated)
   */
  async afterUpdate(event) {
    try {
      const { result, params } = event;
      if (!result || !result.id) return;

      if (params?.data?.status === 'active' && result.status === 'active') {
        const sub = await strapi.db
          .query('api::user-subscription.user-subscription')
          .findOne({
            where: { id: result.id },
            populate: ['users_permissions_user', 'plan'],
          });

        const userId = sub?.users_permissions_user?.id;
        const planName = sub?.plan?.name;

        if (userId && planName) {
          await notificationEvents.onSubscriptionPurchased(
            userId,
            planName,
            sub.subscriptionType
          );
        }
      }
    } catch (error) {
      strapi.log.error('❌ [UserSubscription Lifecycles] Error in afterUpdate:', error);
    }
  },
};
