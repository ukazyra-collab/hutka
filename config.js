// Hutka — connection settings (public values; access is limited by the database policies in supabase/schema.sql)
window.HUTKA_CONFIG = {
  supabaseUrl: "https://tqixfqrludqpxqxypiia.supabase.co",
  supabaseAnonKey: "sb_publishable_Dk2eCbfo6mKZi0fB1VsJZQ_Td0ezi-a",
  askUrl: "https://tqixfqrludqpxqxypiia.supabase.co/functions/v1/ask",   // the edge functions live next to it (wallet, stripe-checkout, ...); "coming soon" until they are deployed
  googleAuth: false,     // true once the Google provider is enabled in Supabase Auth
  pricing: { pro: "$29", pack25: "$9", pack80: "$24" }   // what the credits modal shows; the real prices live in Stripe
};
