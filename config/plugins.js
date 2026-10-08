module.exports = ({ env }) => ({
  upload: {
    config: {
      provider: "aws-s3",
      providerOptions: {
        baseUrl: env("R2_PUBLIC_URL"),
        s3Options: {
          credentials: {
            accessKeyId: env("R2_ACCESS_KEY_ID", env("AWS_ACCESS_KEY_ID")),
            secretAccessKey: env("R2_SECRET_ACCESS_KEY", env("AWS_ACCESS_SECRET")),
          },
          region: env("R2_REGION", env("AWS_REGION", "auto")),
          endpoint: env("R2_ENDPOINT"),
          params: {
            ACL: env("R2_ACL", null),
            Bucket: env("R2_BUCKET", env("AWS_BUCKET")),
          },
        },
      },
    },
  },

 
   email: {
    config: {
      provider: "strapi-provider-email-brevo",
      providerOptions: {
        apiKey: env("BREVO_API_KEY"),
      },
      settings: {
        defaultFrom: env("BREVO_FROM_EMAIL"),   
        defaultReplyTo: env("BREVO_FROM_EMAIL"),    
      },
    },
  },
  "users-permissions": {
    config: {
      register: {
        allowedFields: [
          "firstName", "lastName", "phoneNumber", "distribute_drafts", "artist_details",
          "Profile_image", "currency", "dob", "notifications", "user_type",
          "label_fee_histories", "admin_fee_histories", "invoices", "published_track_update_logs",
          "platformFeeOverride", "commissionOverride", "availableBalance", "pendingBalance",
          "paymentMethod", "payout_requests", "user_subscriptions", "payment_logs",
          "enterprise_commissions", "csv_report_logs", "billing_cards", "user_payout_details",
          "ticket_messages", "activity_logs", "user_activity_logs", "ticket_raises",
          "assigned_tickets", "resolved_tickets"
        ]
      }
    }
  }
});