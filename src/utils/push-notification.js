'use strict';

const axios = require('axios');
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');

let firebaseApp = null;

/**
 * Initializes and returns the Firebase Admin instance.
 * Returns null if credentials are not configured in .env.
 */
function getFirebaseAdmin() {
  if (firebaseApp) {
    return firebaseApp;
  }

  const existingApps = getApps();
  if (existingApps && existingApps.length > 0) {
    firebaseApp = existingApps[0];
    return firebaseApp;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    strapi.log.warn('⚠️ [Firebase] Credentials missing in .env (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY). Push notifications via Firebase are disabled.');
    return null;
  }

  // Handle quotes and escaped \n characters from .env
  if (typeof privateKey === 'string') {
    privateKey = privateKey.replace(/^"(.*)"$/, '$1');
    if (privateKey.includes('\\n')) {
      privateKey = privateKey.replace(/\\n/g, '\n');
    }
  }

  try {
    firebaseApp = initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
    strapi.log.info('🔥 [Firebase] Admin SDK initialized successfully.');
    return firebaseApp;
  } catch (error) {
    strapi.log.error('❌ [Firebase] Initialization error:', error);
    return null;
  }
}

/**
 * Prunes dead, invalid, or unregistered tokens from the database.
 *
 * @param {string[]} tokens
 */
async function pruneInvalidTokens(tokens) {
  if (!tokens || !tokens.length) return;
  try {
    await strapi.db.query('api::device-token.device-token').deleteMany({
      where: {
        token: {
          $in: tokens,
        },
      },
    });
    strapi.log.info(`🧹 [Push] Pruned ${tokens.length} invalid/expired device token(s).`);
  } catch (err) {
    strapi.log.error('❌ [Push] Failed to prune invalid tokens:', err);
  }
}

/**
 * Sends push notifications to Expo Push Tokens (ExponentPushToken[...])
 * Optimized for Android with high priority and default notification channel.
 *
 * @param {string[]} tokens
 * @param {object} payload - { title, body, data }
 */
async function sendExpoPush(tokens, { title, body, data = {} }) {
  if (!tokens || tokens.length === 0) {
    return { successCount: 0, failureCount: 0, invalidTokens: [] };
  }

  const messages = tokens.map((token) => ({
    to: token,
    sound: 'default',
    title,
    body,
    data,
    priority: 'high',           // Required for instant display on Android
    channelId: 'default',       // Required for Android 8.0+ notification channels
    _displayInForeground: true, // Display banner even if app is in foreground
  }));

  try {
    const response = await axios.post('https://exp.host/--/api/v2/push/send', messages, {
      headers: {
        'Accept': 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
    });

    const invalidTokens = [];
    let successCount = 0;
    let failureCount = 0;

    const tickets = response.data?.data || [];
    tickets.forEach((ticket, idx) => {
      if (ticket.status === 'ok') {
        successCount++;
      } else {
        failureCount++;
        strapi.log.error(`❌ [Expo Push Failed] Token: "${tokens[idx]}"`);
        strapi.log.error(`   Message: ${ticket.message || 'No message'}`);
        strapi.log.error(`   Details: ${JSON.stringify(ticket.details || {})}`);
        if (ticket.details?.error === 'DeviceNotRegistered') {
          invalidTokens.push(tokens[idx]);
        }
      }
    });

    if (invalidTokens.length > 0) {
      await pruneInvalidTokens(invalidTokens);
    }

    strapi.log.info(`📱 [Expo Push] Sent: ${successCount} ok, ${failureCount} failed.`);
    return { successCount, failureCount, invalidTokens };
  } catch (error) {
    strapi.log.error('❌ [Expo Push] Error sending push notification:', error.response?.data || error.message);
    return { successCount: 0, failureCount: tokens.length, invalidTokens: [] };
  }
}

/**
 * Sends push notifications to native Firebase (FCM) tokens
 *
 * @param {string[]} tokens
 * @param {object} payload - { title, body, data, imageUrl }
 */
async function sendFirebasePush(tokens, { title, body, data = {}, imageUrl = null }) {
  const app = getFirebaseAdmin();
  if (!app || !tokens || tokens.length === 0) {
    return { successCount: 0, failureCount: 0, invalidTokens: [] };
  }

  const sanitizedData = {};
  if (data && typeof data === 'object') {
    for (const [key, value] of Object.entries(data)) {
      sanitizedData[key] = typeof value === 'string' ? value : JSON.stringify(value);
    }
  }

  const message = {
    notification: {
      title,
      body,
      ...(imageUrl ? { imageUrl } : {}),
    },
    data: sanitizedData,
    tokens,
    android: {
      priority: 'high',
      notification: {
        sound: 'default',
        channelId: 'default',
        priority: 'high',
      },
    },
  };

  try {
    const messaging = getMessaging(app);
    const response = await messaging.sendEachForMulticast(message);

    const invalidTokens = [];
    response.responses.forEach((resp, idx) => {
      if (!resp.success) {
        const errorCode = resp.error?.code;
        if (
          errorCode === 'messaging/registration-token-not-registered' ||
          errorCode === 'messaging/invalid-registration-token' ||
          errorCode === 'messaging/invalid-argument'
        ) {
          invalidTokens.push(tokens[idx]);
        }
      }
    });

    if (invalidTokens.length > 0) {
      await pruneInvalidTokens(invalidTokens);
    }

    strapi.log.info(`🔥 [Firebase FCM] Sent: ${response.successCount} ok, ${response.failureCount} failed.`);
    return {
      successCount: response.successCount,
      failureCount: response.failureCount,
      invalidTokens,
    };
  } catch (error) {
    strapi.log.error('❌ [Firebase] Error sending multicast push notification:', error);
    return { successCount: 0, failureCount: tokens.length, invalidTokens: [] };
  }
}

/**
 * Sends push notifications to an array of tokens.
 * Automatically identifies Expo vs Firebase tokens and routes them accordingly.
 *
 * @param {string[]} tokens - Array of device tokens
 * @param {object} payload - { title, body, data, imageUrl }
 * @returns {Promise<{ successCount: number, failureCount: number, invalidTokens: string[] }>}
 */
async function sendPushToTokens(tokens, { title, body, data = {}, imageUrl = null }) {
  if (!tokens || tokens.length === 0) {
    return { successCount: 0, failureCount: 0, invalidTokens: [] };
  }

  const cleanTokens = [...new Set(tokens.filter(Boolean))];
  if (cleanTokens.length === 0) {
    return { successCount: 0, failureCount: 0, invalidTokens: [] };
  }

  // Separate Expo tokens (ExponentPushToken[...]) from native Firebase FCM tokens
  const expoTokens = cleanTokens.filter(
    (t) => t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken[')
  );
  const firebaseTokens = cleanTokens.filter(
    (t) => !t.startsWith('ExponentPushToken[') && !t.startsWith('ExpoPushToken[')
  );

  let successCount = 0;
  let failureCount = 0;
  let invalidTokens = [];

  // 1. Dispatch Expo tokens
  if (expoTokens.length > 0) {
    const expoResult = await sendExpoPush(expoTokens, { title, body, data });
    successCount += expoResult.successCount;
    failureCount += expoResult.failureCount;
    invalidTokens.push(...expoResult.invalidTokens);
  }

  // 2. Dispatch Firebase tokens
  if (firebaseTokens.length > 0) {
    const fcmResult = await sendFirebasePush(firebaseTokens, { title, body, data, imageUrl });
    successCount += fcmResult.successCount;
    failureCount += fcmResult.failureCount;
    invalidTokens.push(...fcmResult.invalidTokens);
  }

  return {
    successCount,
    failureCount,
    invalidTokens,
  };
}

/**
 * Sends a push notification to all devices registered to a specific user.
 *
 * @param {number|string} userId - Strapi user ID
 * @param {object} payload - { title, body, data, imageUrl }
 */
async function sendPushToUser(userId, { title, body, data = {}, imageUrl = null }) {
  if (!userId) return;

  try {
    const deviceRecords = await strapi.db
      .query('api::device-token.device-token')
      .findMany({
        where: { users_permissions_user: userId },
        select: ['token'],
      });

    if (!deviceRecords || !deviceRecords.length) {
      return { successCount: 0, failureCount: 0, invalidTokens: [] };
    }

    const tokens = deviceRecords.map((d) => d.token).filter(Boolean);
    return await sendPushToTokens(tokens, { title, body, data, imageUrl });
  } catch (error) {
    strapi.log.error(`❌ [Push] Failed to send push to user ${userId}:`, error);
  }
}

/**
 * Sends a push notification to all authenticated users with registered devices.
 *
 * @param {object} payload - { title, body, data, imageUrl }
 */
async function sendPushToAllAuthenticatedUsers({ title, body, data = {}, imageUrl = null }) {
  try {
    const deviceRecords = await strapi.db
      .query('api::device-token.device-token')
      .findMany({
        select: ['token'],
      });

    if (!deviceRecords || !deviceRecords.length) return;

    const allTokens = deviceRecords.map((d) => d.token).filter(Boolean);

    // Multicast in chunks of 500
    const CHUNK_SIZE = 500;
    for (let i = 0; i < allTokens.length; i += CHUNK_SIZE) {
      const chunk = allTokens.slice(i, i + CHUNK_SIZE);
      await sendPushToTokens(chunk, { title, body, data, imageUrl });
    }
  } catch (error) {
    strapi.log.error('❌ [Push] Failed to send push to all users:', error);
  }
}

module.exports = {
  getFirebaseAdmin,
  pruneInvalidTokens,
  sendPushToTokens,
  sendPushToUser,
  sendPushToAllAuthenticatedUsers,
};
