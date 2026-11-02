// Safe to commit: the publishable key is designed to be public. What it can actually do is
// decided by the row-level security rules in supabase/migrations, not by keeping this secret.
// Never put the Secret key (sb_secret_...) or the database password in any file here.
export const SUPABASE_URL = 'https://oxjzuvkdveatsjnawmjx.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_30q6pZ1oBSSKtyuP62kEEQ_XReIz7Pq';
