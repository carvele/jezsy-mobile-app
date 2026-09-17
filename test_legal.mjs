import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// Load .env
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../../jezsy-mobile-app/.env') });

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Missing supabase credentials");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function runTests() {
  console.log("--- 1. Testing unauthenticated get_legal_acceptance_status ---");
  const { data: data1, error: err1 } = await supabase.rpc('get_legal_acceptance_status');
  console.log("Result:", data1, "Error:", err1?.message);

  console.log("\n--- 2. Login as a customer to test dormant state ---");
  const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
    email: process.env.HARNESS_CUSTOMER_EMAIL,
    password: process.env.HARNESS_CUSTOMER_PASSWORD
  });
  if (authErr) {
    console.error("Auth Error:", authErr.message);
    return;
  }
  
  const { data: dormantData, error: dormantErr } = await supabase.rpc('get_legal_acceptance_status');
  console.log("Dormant Status Result:", JSON.stringify(dormantData, null, 2));
  console.log("Error:", dormantErr?.message);

  console.log("\n--- 3. Login as a staff/owner to test management ---");
  const { error: authErr2 } = await supabase.auth.signInWithPassword({
    email: process.env.HARNESS_STAFF_EMAIL,
    password: process.env.HARNESS_STAFF_PASSWORD
  });
  if (authErr2) {
    console.error("Staff Auth Error:", authErr2.message);
    return;
  }

  const { data: canPub, error: canPubErr } = await supabase.rpc('can_publish_legal_documents');
  console.log("Can Publish:", canPub, "Error:", canPubErr?.message);

  // We won't publish yet to not activate the gate globally until the end,
  // or we can test publishing and then disable the gate.
  // We'll leave this to manual verification or write another query if needed.
}

runTests();
