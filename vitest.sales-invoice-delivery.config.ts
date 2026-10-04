import { defineConfig } from 'vitest/config';
export default defineConfig({test:{environment:'node',include:['supabase/functions/_shared/sales-invoice-delivery/*.test.ts','supabase/functions/_shared/email-attachments.test.ts']}});
