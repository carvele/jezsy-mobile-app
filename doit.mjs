import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
const terms = `# Terms
Version 1.0.0

1. Refunds
Refunds for cancelled reservations will be processed to the original payment method. Items must be returned in their original condition.
2. Downpayment
A non-refundable deposit may be required to secure a reservation.
3. Payments
Processed securely via our authorized payment processors.
4. Account Deletion
You may request account deletion. Upon deletion, personal data is scrubbed, but anonymized audit logs of your legal acceptances are retained.
Contact support@jezsy.com.`;

const privacy = `# Privacy
Version 1.0.0

1. AR
Local processing for AR try-on.
2. Data Retention
We keep pseudonymized acceptances of this privacy policy even after account deletion.
Contact privacy@jezsy.com.`;

async function run() {
  console.log("Authenticating as owner...");
  await supabase.auth.signInWithPassword({ email: process.env.HARNESS_STAFF_EMAIL, password: process.env.HARNESS_STAFF_PASSWORD });
  
  console.log("Publishing Terms and Privacy...");
  const { data: t } = await supabase.rpc('publish_legal_document_version', { _document_type: 'terms', _version: '1.0.0', _title: 'Terms of Service', _content_markdown: terms });
  const { data: p } = await supabase.rpc('publish_legal_document_version', { _document_type: 'privacy', _version: '1.0.0', _title: 'Privacy Policy', _content_markdown: privacy });
  console.log('Published IDs:', t.document_id, p.document_id);
  
  const { data: g } = await supabase.rpc('get_legal_acceptance_status');
  console.log('Gate Enabled (Owner):', g.gate_enabled, 'CanContinue:', g.can_continue);
  
  console.log("Authenticating as customer...");
  await supabase.auth.signInWithPassword({ email: process.env.HARNESS_CUSTOMER_EMAIL, password: process.env.HARNESS_CUSTOMER_PASSWORD });
  
  const { data: g2 } = await supabase.rpc('get_legal_acceptance_status');
  console.log('Gate Enabled (Customer):', g2.gate_enabled, 'CanContinue:', g2.can_continue);
  
  console.log("Simulating view and accept...");
  await supabase.rpc('record_legal_document_view', { _document_id: t.document_id, _client_platform: 'admin_web' });
  await supabase.rpc('record_legal_document_view', { _document_id: p.document_id, _client_platform: 'admin_web' });
  await supabase.rpc('accept_legal_documents', { _terms_document_id: t.document_id, _privacy_document_id: p.document_id, _client_platform: 'admin_web', _user_agent: 'Node' });
  
  const { data: g3 } = await supabase.rpc('get_legal_acceptance_status');
  console.log('Customer Post-Accept CanContinue:', g3.can_continue);
  
  const { data: acc } = await supabase.from('legal_acceptances').select('*');
  console.log('Customer Acceptances Evidence:', JSON.stringify(acc, null, 2));
}

run();
