'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/device-tokens/register',
      handler: 'device-token.registerToken',
      config: {
        auth: {},
      },
    },
    {
      method: 'POST',
      path: '/device-tokens/unregister',
      handler: 'device-token.removeToken',
      config: {
        auth: {},
      },
    },
    {
      method: 'POST',
      path: '/device-tokens/test-push',
      handler: 'device-token.testPush',
      config: {
        auth: {},
      },
    },
    {
      method: 'POST',
      path: '/device-tokens/send-promotional',
      handler: 'device-token.sendPromotionalNotification',
      config: {
        auth: {},
      },
    },
  ],
};
