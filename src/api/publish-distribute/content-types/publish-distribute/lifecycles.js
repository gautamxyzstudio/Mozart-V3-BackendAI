'use strict';

const { onPublishDistributeCreated } = require('../../../../utils/notification-events');

module.exports = {
  async afterCreate(event) {
    await onPublishDistributeCreated(event);
  },
};
