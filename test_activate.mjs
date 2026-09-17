import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const termsMarkdown = \
# JezSy Terms of Service
**Version 1.0.0**

Welcome to JezSy. By using our platform, you agree to these terms.

## 1. Reservations and Downpayments
A non-refundable downpayment may be required to secure your fitting and rental reservation. The remaining balance must be paid prior to or at the time of pickup.

## 2. Refunds and Returns
Refunds for cancelled reservations will be processed according to our cancellation policy. If an item is returned damaged, late, or requires excessive alteration reversal, additional fees may apply. Refunds are processed to the original payment method or via authorized payment processors.

## 3. Account Deletion and Retention
You may request account deletion at any time via the app. Upon deletion, your personal data (name, contact info, measurements) is permanently scrubbed. However, a pseudonymized record of your acceptance of these Terms and our Privacy Policy is retained indefinitely for legal audit and compliance purposes.

## 4. Payment Processors
All transactions are processed securely by our authorized third-party payment processors. JezSy does not store raw credit card information.

## 5. Contact and Support
For any questions or support requests, please contact our team at support@jezsy.com.
\;

const privacyMarkdown = \
# JezSy Privacy Policy
**Version 1.0.0**

Your privacy is important to us. This policy explains how we collect and use your data.

## 1. Data Collection
We collect your name, email, phone number, and physical measurements necessary to provide tailored fitting and rental services. 

## 2. Augmented Reality (AR) Features
When using AR try-on features, camera data is processed locally on your device. We do not store or transmit raw video feeds to our servers.

## 3. Account Deletion and Anonymization
If you delete your account, your profile data and measurements are immediately and irreversibly deleted. Your historical transactions and legal consent records are anonymized and retained purely for accounting and legal compliance, completely severed from your identity.

## 4. Contact
For privacy-related inquiries, please contact privacy@jezsy.com.
\;

async function runActivation() {
  console.log('=== STARTING TRACK 2 ACTIVATION SEQUENCE ===\\n');

  console.log('[1] Authenticating as Owner (Staff Harness)...');
  const { data: ownerAuth, error: authErr } = await supabase.auth.signInWithPassword({
    email: process.env.HARNESS_STAFF_EMAIL,
    password: process.env.HARNESS_STAFF_PASSWORD
  });
  if (authErr) throw authErr;
  
  console.log('[2] Publishing Terms v1.0.0...');
  const { data: termsData, error: termsErr } = await supabase.rpc('publish_legal_document_version', {
    _document_type: 'terms',
    _version: '1.0.0',
    _title: 'Terms of Service',
    _content_markdown: termsMarkdown
  });
  if (termsErr) throw termsErr;
  console.log('    Terms Published:', termsData.document_id);

  console.log('[3] Publishing Privacy v1.0.0...');
  const { data: privData, error: privErr } = await supabase.rpc('publish_legal_document_version', {
    _document_type: 'privacy',
    _version: '1.0.0',
    _title: 'Privacy Policy',
    _content_markdown: privacyMarkdown
  });
  if (privErr) throw privErr;
  console.log('    Privacy Published:', privData.document_id);

  console.log('\\n[4] Verifying Gate Status (Owner)...');
  const { data: gateStatus1, error: gateErr1 } = await supabase.rpc('get_legal_acceptance_status');
  if (gateErr1) throw gateErr1;
  console.log('    Gate Enabled:', gateStatus1.gate_enabled);
  console.log('    Can Continue:', gateStatus1.can_continue);

  console.log('\\n[5] Authenticating as Customer...');
  const { data: custAuth, error: custAuthErr } = await supabase.auth.signInWithPassword({
    email: process.env.HARNESS_CUSTOMER_EMAIL,
    password: process.env.HARNESS_CUSTOMER_PASSWORD
  });
  if (custAuthErr) throw custAuthErr;

  console.log('    Checking Status...');
  const { data: gateStatus2 } = await supabase.rpc('get_legal_acceptance_status');
  console.log('    Gate Enabled:', gateStatus2.gate_enabled);
  console.log('    Can Continue:', gateStatus2.can_continue);

  if (!gateStatus2.gate_enabled) throw new Error('Gate should be enabled!');
  if (gateStatus2.can_continue) throw new Error('Customer should be blocked!');

  console.log('\\n[6] Simulating Full Document Views (Customer)...');
  await supabase.rpc('record_legal_document_view', { _document_id: termsData.document_id, _client_platform: 'admin_web' });
  await supabase.rpc('record_legal_document_view', { _document_id: privData.document_id, _client_platform: 'admin_web' });
  console.log('    Views recorded.');

  console.log('\\n[7] Simulating Explicit Acceptance (Customer)...');
  const { error: acceptErr } = await supabase.rpc('accept_legal_documents', {
    _terms_document_id: termsData.document_id,
    _privacy_document_id: privData.document_id,
    _client_platform: 'admin_web',
    _user_agent: 'Node Integration Test'
  });
  if (acceptErr) throw acceptErr;
  console.log('    Documents accepted.');

  console.log('\\n[8] Verifying Customer Unblocked...');
  const { data: gateStatus3 } = await supabase.rpc('get_legal_acceptance_status');
  console.log('    Can Continue:', gateStatus3.can_continue);
  if (!gateStatus3.can_continue) throw new Error('Customer should be unblocked now!');

  console.log('\\n[9] Fetching Verification Evidence...');
  const { data: acceptances, error: accQErr } = await supabase
    .from('legal_acceptances')
    .select('document_type, document_version, acceptance_method, client_platform, accepted_at, legal_subject_id');
  
  if (accQErr) throw accQErr;
  console.log('    My Acceptances Found:', acceptances.length);
  console.log(JSON.stringify(acceptances, null, 2));

  console.log('\\n=== ACTIVATION COMPLETE & VERIFIED ===');
}

runActivation().catch(console.error);
