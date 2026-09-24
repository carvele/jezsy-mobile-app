-- Migration: 20260924061500_update_legal_documents_v2.sql
-- Description: Publish Version 2.0.0 of Privacy Policy and Terms of Service for JezSy Collection

DO $$
DECLARE
  v_owner_id uuid;
  v_privacy_text text;
  v_terms_text text;
  v_privacy_sha text;
  v_terms_sha text;
  v_privacy_id uuid;
  v_terms_id uuid;
BEGIN
  -- 1. Identify active owner profile
  SELECT id INTO v_owner_id
  FROM public.profiles
  WHERE role = 'owner' AND employment_status = 'active' AND deleted = false
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_owner_id IS NULL THEN
    -- Fallback to system owner ID if none returned
    v_owner_id := 'f846e33c-d453-4f59-a750-f7d55462249d'::uuid;
  END IF;

  -- 2. Define Privacy Policy Markdown (v2.0.0)
  v_privacy_text := '# JezSy Collection Privacy Policy
**Document Version:** 2.0.0
**Effective Date:** September 24, 2026
**Governing Law:** Republic Act No. 10173 (Data Privacy Act of 2012, Philippines)

Welcome to **Fast-Shown: Online Fashion Management for JezSy Collection with Augmented Reality** ("JezSy", "we", "our", or "us"). We are committed to safeguarding your personal data in strict compliance with Republic Act No. 10173 (Data Privacy Act of 2012 - DPA) and the regulatory guidelines of the National Privacy Commission (NPC) of the Philippines.

---

### 1. Information We Collect
We collect personal information necessary to deliver our tailored fashion catalog, custom fitting, and garment reservation services:
* **Account & Identity Information:** Full name, email address, Philippine mobile contact number, and encrypted password credentials.
* **Physical Body Measurements:** Height, bust, waist, hips, and body shape metrics provided voluntarily for accurate size recommendations and personalized 3D mannequin fitting.
* **Reservation & Payment Records:** Selected garment SKUs, variant sizing/colors, scheduled pickup dates, transaction reference numbers, and uploaded GCash payment receipts.
* **In-App Messaging:** Real-time customer support logs between you and JezSy staff regarding product availability, styling, and pickup coordination.
* **Technical Telemetry:** Device model, operating system, client platform identifier (mobile_android, mobile_ios, admin_web), IP address, and security authentication tokens.

---

### 2. Augmented Reality (AR) & Camera Permissions (Strict Ephemeral Processing)
When utilizing the **Live Camera AR Try-On** or **3D Studio Mode**:
* **Camera Access:** Camera permission is requested strictly to track anatomical body landmarks in real-time using on-device machine learning (Google ARCore and MediaPipe Pose Detection).
* **Zero Video Streaming or Image Storage:** All camera frames are processed **ephemerally in real-time within local device memory (RAM)**.
* **Privacy Guarantee:** JezSy **never** records, streams, uploads, or stores your raw video feeds, photos, or facial/body images on our cloud servers. Pose landmark coordinate vectors are discarded immediately upon frame rendering.

---

### 3. Purpose and Legal Basis for Processing
We process personal data solely for legitimate business operations:
1. Managing and confirming garment reservations with physical store pickup.
2. Generating tailored garment sizing recommendations.
3. Verifying 50% GCash downpayment receipts to prevent fraud.
4. Facilitating two-way customer communication via Supabase Realtime in-app chat.
5. Complying with statutory tax, accounting, and consumer protection mandates under Philippine law.

---

### 4. Third-Party Service Providers & Infrastructure
* **Supabase Inc. (Backend & Database):** Hosted cloud infrastructure with PostgreSQL Row Level Security (RLS) and encrypted Auth tokens.
* **Cloudinary:** Content Delivery Network (CDN) for garment photography and secure customer payment receipt upload verification.
* **GCash (G-Xchange Inc.):** External mobile wallet channel used for downpayment settlement. We do not store or process your MPIN or GCash account credentials.

---

### 5. Data Security Safeguards
* All network transmissions are protected with Transport Layer Security (**TLS 1.3**).
* Database records are isolated by **Row Level Security (RLS)**, ensuring customers can only access their own profile, measurements, and reservations.
* Administrative staff access is restricted via Role-Based Access Control (RBAC) and monitored through immutable system audit logs.

---

### 6. Account Deletion and Cryptographic Audit Retention
You may request complete account deletion at any time via the mobile app profile settings:
* **Immediate Purge:** Your personal profile, contact information, saved body measurements, and wardrobe items are permanently and irreversibly destroyed.
* **Pseudonymous Audit Retention:** To satisfy Philippine tax and auditing regulations, historical transaction records and your timestamped legal consent records are permanently unlinked from your identity and retained under a pseudonymous cryptographic identifier (`legal_subject_id`).

---

### 7. Rights of the Data Subject (RA 10173)
Under the Philippine Data Privacy Act of 2012, you possess:
1. **Right to be Informed:** Transparent notification of data processing.
2. **Right to Access:** Requesting copies of your stored personal information.
3. **Right to Rectification:** Correcting inaccurate or outdated profile details.
4. **Right to Erasure or Blocking:** Suspending or deleting your personal data.
5. **Right to Damages:** Restitution for damages sustained due to privacy violations.

---

### 8. Contact Our Privacy Office
For data privacy inquiries or rights enforcement, contact:
* **Entity:** JezSy Collection (Fast-Shown Platform)
* **Location:** Balanga City, Bataan, Philippines
* **Email:** admin@jezsycollection.com / support@jezsy.com
* **Supervisory Authority:** National Privacy Commission (NPC) - https://privacy.gov.ph';

  -- 3. Define Terms of Service Markdown (v2.0.0)
  v_terms_text := '# JezSy Collection Terms of Service
**Document Version:** 2.0.0
**Effective Date:** September 24, 2026
**Applicable Jurisdiction:** Republic of the Philippines

Welcome to **Fast-Shown: Online Fashion Management for JezSy Collection with Augmented Reality** ("JezSy", "Platform", "we", "our"). These Terms of Service ("Terms") constitute a legally binding agreement between you ("Customer", "User", "you") and JezSy Collection governing your use of our mobile app and administrative services.

---

### 1. Acceptance of Terms
By creating an account, browsing catalog apparel, reserving garments, or utilizing our Augmented Reality fitting features, you agree to be bound by these Terms and our Privacy Policy. If you do not agree, discontinue use immediately.

---

### 2. User Accounts and Eligibility
* **Age Requirement:** You must be at least 18 years of age (Republic Act No. 6809), or have parental/guardian consent, to register an account and make reservations.
* **Account Security:** You are responsible for safeguarding your credentials and must notify JezSy immediately of any unauthorized access.
* **Information Accuracy:** You agree to maintain accurate contact information to ensure reliable pickup confirmations.

---

### 3. Augmented Reality (AR) & Sizing Disclaimer
* **Visual Simulation:** 3D apparel models and AR try-on renderings are computer-generated simulations designed to assist visual fit evaluation.
* **Fabric & Color Variance:** Minor variations in fabric drape, stretch, and color hue may occur across different device displays and ambient lighting.
* **In-Store Fitting:** AR visualization does not guarantee exact tailoring. Final sizing, garment adjustments, and physical inspections occur during in-store pickup.

---

### 4. Reservation Policy & 3-Day Hold Window (Core Rule)
* **50% Downpayment Requirement:** To reserve a garment and lock physical inventory, customers must submit a **50% downpayment** of the total item price via GCash.
* **Payment Window:** Customers have **120 minutes (2 hours)** from reservation creation to upload their GCash payment receipt reference. Reservations without proof of payment within 120 minutes automatically expire.
* **Admin Verification:** Reservations remain in `Pending` status until boutique staff verifies the GCash reference and receipt. Upon approval, the status updates to `Confirmed`.
* **Three (3) Calendar Day Hold Rule:** Confirmed garments are held at the boutique for **three (3) calendar days** starting from the selected pickup date.
* **Extension & Forfeiture:** Customers may request a one (1) day extension through in-app chat. If the item is not claimed within the hold window, the reservation is cancelled, inventory is released, and the 50% downpayment is forfeited to cover holding costs.

---

### 5. In-Store Pickup, Balance Settlement & Inspection
* **Balance Payment:** The remaining 50% balance must be settled in full at the boutique upon claiming the garment (Cash or GCash).
* **Physical Inspection:** Customers must thoroughly inspect garments for fit, stitching, and fabric condition prior to leaving the store.
* **Completion:** Acceptance and receipt of the garment marks the reservation as `Completed`.

---

### 6. Cancellations, Alterations & Returns
* **Customer Cancellation:** Cancellations requested prior to staff verification may be refunded at store discretion. Cancellations after inventory lock are subject to downpayment forfeiture.
* **Custom Alterations:** Garments tailored, hemmed, or altered at customer request are strictly non-refundable and non-exchangeable.
* **Return Window:** Unworn standard garments with tags intact may be returned within **seven (7) days** for evaluation in accordance with the Consumer Act of the Philippines (RA 7394).
* **Store Cancellation:** If an item becomes unavailable or damaged prior to pickup, JezSy will notify the customer and issue a 100% refund of the downpayment.

---

### 7. Intellectual Property Rights
* All digital assets, 3D meshes (.glb models), high-resolution photography, branding, UI designs, and codebase are the proprietary property of JezSy Collection and the Fast-Shown capstone developers.
* Reproduction, scraping, reverse-engineering, or unauthorized distribution of assets is strictly prohibited.

---

### 8. User Conduct & Messaging
You agree not to:
* Submit forged, altered, or fraudulent GCash payment receipts.
* Harass, abuse, or send inappropriate messages to boutique staff via the in-app chat.
* Inject malicious code, exploit vulnerabilities, or use automated scraping bots.
Violations will result in immediate account termination and legal referral.

---

### 9. Limitation of Liability
JezSy Collection is not liable for indirect, incidental, or consequential damages resulting from app downtime or device incompatibility with AR frameworks. Maximum store liability is limited to the downpayment amount paid for the affected reservation.

---

### 10. Governing Law & Dispute Resolution
These Terms are governed by the laws of the **Republic of the Philippines** (Civil Code, RA 8792, RA 7394). Any legal disputes shall be settled before the competent courts of **Bataan, Philippines**, following good-faith amicable mediation.

---

### 11. Contact & Store Schedule
* **Boutique:** JezSy Collection (Fast-Shown Platform)
* **Location:** Balanga City, Bataan, Philippines
* **Support Email:** admin@jezsycollection.com / support@jezsy.com
* **Operating Hours:** Monday to Friday, 10:00 AM – 5:00 PM PHT (Saturday & Sunday Closed)';

  -- 4. Compute SHA-256 hashes
  v_privacy_sha := encode(sha256(v_privacy_text::bytea), 'hex');
  v_terms_sha := encode(sha256(v_terms_text::bytea), 'hex');

  -- 5. Deactivate prior active documents
  UPDATE public.legal_documents
  SET is_active = false
  WHERE is_active = true AND document_type IN ('privacy', 'terms');

  -- 6. Insert or activate published Privacy Policy (v2.0.0)
  SELECT id INTO v_privacy_id
  FROM public.legal_documents
  WHERE document_type = 'privacy' AND version = '2.0.0';

  IF v_privacy_id IS NULL THEN
    INSERT INTO public.legal_documents (
      document_type,
      version,
      title,
      content_markdown,
      content_sha256,
      effective_at,
      is_active,
      is_published,
      published_at,
      published_by,
      created_by
    ) VALUES (
      'privacy',
      '2.0.0',
      'Privacy Policy',
      v_privacy_text,
      v_privacy_sha,
      now(),
      true,
      true,
      now(),
      v_owner_id,
      v_owner_id
    ) RETURNING id INTO v_privacy_id;
  ELSE
    UPDATE public.legal_documents
    SET is_active = true
    WHERE id = v_privacy_id;
  END IF;

  -- 7. Insert or activate published Terms of Service (v2.0.0)
  SELECT id INTO v_terms_id
  FROM public.legal_documents
  WHERE document_type = 'terms' AND version = '2.0.0';

  IF v_terms_id IS NULL THEN
    INSERT INTO public.legal_documents (
      document_type,
      version,
      title,
      content_markdown,
      content_sha256,
      effective_at,
      is_active,
      is_published,
      published_at,
      published_by,
      created_by
    ) VALUES (
      'terms',
      '2.0.0',
      'Terms of Service',
      v_terms_text,
      v_terms_sha,
      now(),
      true,
      true,
      now(),
      v_owner_id,
      v_owner_id
    ) RETURNING id INTO v_terms_id;
  ELSE
    UPDATE public.legal_documents
    SET is_active = true
    WHERE id = v_terms_id;
  END IF;

  -- 8. Add immutable audit log entries
  INSERT INTO public.logs (user_id, user_name, action, target_type, target_id, details, timestamp)
  VALUES 
    (
      v_owner_id,
      'Owner',
      'publish_legal_document_version',
      'legal_document',
      v_privacy_id::text,
      jsonb_build_object('document_type', 'privacy', 'version', '2.0.0', 'content_sha256', v_privacy_sha),
      now()
    ),
    (
      v_owner_id,
      'Owner',
      'publish_legal_document_version',
      'legal_document',
      v_terms_id::text,
      jsonb_build_object('document_type', 'terms', 'version', '2.0.0', 'content_sha256', v_terms_sha),
      now()
    );

  RAISE NOTICE 'Successfully published Privacy Policy v2.0.0 (ID: %) and Terms of Service v2.0.0 (ID: %)', v_privacy_id, v_terms_id;
END $$;
