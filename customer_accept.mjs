import { createClient } from '@supabase/supabase-js';
async function run() {
  const s = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
  await s.auth.signInWithPassword({ email: process.env.HARNESS_CUSTOMER_EMAIL, password: process.env.HARNESS_CUSTOMER_PASSWORD });
  
  console.log('Customer logged in. Checking gate status...');
  const { data: status1 } = await s.rpc('get_legal_acceptance_status');
  console.log('Gate Enabled:', status1.gate_enabled);
  console.log('Can Continue:', status1.can_continue);
  
  if (status1.gate_enabled && !status1.can_continue) {
     console.log('Simulating view...');
     await s.rpc('record_legal_document_view', { _document_id: status1.terms.document_id, _client_platform: 'admin_web' });
     await s.rpc('record_legal_document_view', { _document_id: status1.privacy.document_id, _client_platform: 'admin_web' });
     
     console.log('Simulating acceptance...');
     await s.rpc('accept_legal_documents', { 
       _terms_document_id: status1.terms.document_id, 
       _privacy_document_id: status1.privacy.document_id, 
       _client_platform: 'admin_web', 
       _user_agent: 'Automated Activation Test' 
     });
     
     const { data: status2 } = await s.rpc('get_legal_acceptance_status');
     console.log('Can Continue after accept:', status2.can_continue);
  }
}
run();
