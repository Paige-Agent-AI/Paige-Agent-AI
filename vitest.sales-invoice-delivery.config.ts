import { defineConfig } from 'vitest/config';
export default defineConfig({test:{environment:'node',include:['supabase/functions/_shared/sales-invoice-delivery/*.test.ts','supabase/functions/_shared/email-attachments.test.ts','supabase/functions/_shared/comms-email/**/*.test.ts'],exclude:['**/node_modules/**','supabase/functions/_shared/comms-email/sendgrid-webhook-admin.test.ts']}});
