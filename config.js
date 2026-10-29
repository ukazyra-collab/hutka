// Hutka — connection settings (public values; access is limited by the database policies in supabase/schema.sql)
window.HUTKA_CONFIG = {
  supabaseUrl: "https://tqixfqrludqpxqxypiia.supabase.co",
  supabaseAnonKey: "sb_publishable_Dk2eCbfo6mKZi0fB1VsJZQ_Td0ezi-a",
  askUrl: "https://tqixfqrludqpxqxypiia.supabase.co/functions/v1/ask",   // the edge functions live next to it (wallet, stripe-checkout, ...); "coming soon" until they are deployed
  googleAuth: true,      // the Google button works once the Google provider is enabled in Supabase Auth (README §1A)
  appleAuth: true,       // Sign in with Apple — on since 29 Oct 2026 (Services ID ai.hutka.web, key S22F73Y8XY; app/README.md §1.3); with it on, the iOS/Android app shows the Google button too (App Store rule 4.8)
  pricing: { pro: "$29", pack25: "$9", pack80: "$24" },  // what the credits modal shows when billing is on (FREE_MODE=0); the real prices live in Stripe
  aiPrice: { in: 3, out: 15 },                            // $ per million tokens, only for the cost estimate in Admin → AI coach usage
  analytics: "G-WVRM2J1STW"                               // Google Analytics 4 — the hutka.ai web stream's Measurement ID (not a secret; ga.js, README v34.47)
  // satTiles: "https://…/{z}/{x}/{y}.png", satAttribution: "…", satMaxZoom: 20   // another imagery provider; default is Esri World Imagery
};
