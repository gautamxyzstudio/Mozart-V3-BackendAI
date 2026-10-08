module.exports = [
  'strapi::errors',
  {
    name: "strapi::security",
    config: {
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "img-src": [
            "'self'",
            "data:",
            "blob:",
            "https://storage.googleapis.com",
            "https://mozart-app.s3.ap-southeast-2.amazonaws.com",
            "https://*.r2.cloudflarestorage.com",
            "https://*.r2.dev",
            "https://pub-dce31bae92a7491490a787f1cc5e40bb.r2.dev",
          ],
          "media-src": [
            "'self'",
            "data:",
            "blob:",
            "https://storage.googleapis.com",
            "https://*.r2.cloudflarestorage.com",
            "https://*.r2.dev",
            "https://pub-dce31bae92a7491490a787f1cc5e40bb.r2.dev",
          ],
        },
      },
    },
  },
  {
    name: 'strapi::cors',
    config: {
      origin: ['http://localhost:5173', 'https://v3.amozart.com', 'https://localhost:5173', 'https://admin.amozart.com', 'https://amozart.com', 'https://www.amozart.com', 'http://localhost:3000'],

      methods: [
        'GET',
        'POST',
        'PUT',
        'PATCH',
        'DELETE',
        'OPTIONS',
      ],

      headers: [
        'Content-Type',
        'Authorization',
        'Origin',
        'Accept',
        'client-ip',
      ],
    },
  },
  'strapi::poweredBy',
  'strapi::logger',
  'strapi::query',
  {
    name: 'strapi::body',
    config: {
      formLimit: "256mb",
      jsonLimit: "256mb",
      textLimit: "256mb",
      formidable: {
        maxFileSize: 250 * 1024 * 1024, // 250MB
      },
      includeUnparsed: true,
    },
  },
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
  // V3 — Priority 7: append-only audit log for admin mutations.
  'global::audit-log',
];