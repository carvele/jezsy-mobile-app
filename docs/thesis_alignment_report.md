# Thesis Alignment & System Compliance Report
## Fast-Shown: Online Fashion Management for JezSy Collection with Augmented Reality

This report analyzes how the current **Expo (React Native) + Supabase (Postgres)** codebase aligns with the design goals, conceptual models, activity diagrams, and database designs outlined in your Bataan Peninsula State University Bachelor of Science in Information Technology thesis project.

---

## 1. Technical Stack Translation & Evolution
Your thesis proposal specifies a Java/Kotlin Android Studio native app with Firebase and a PHP web-based admin interface. The current implementation has evolved into a modern, cross-platform architecture:
*   **Frontend**: React Native + Expo (TypeScript). This satisfies the **ISO 25010 Portability & Compatibility** requirements by allowing a single codebase to support both iOS and Android platforms seamlessly.
*   **Backend & Database**: Supabase (PostgreSQL) instead of Firebase NoSQL (Firestore). This transition maintains **data integrity** through relational constraints (Foreign Keys) and facilitates robust analytical aggregation for reports.
*   **Media & Assets**: Cloudinary integration for product images and Supabase Storage for model/receipt uploads, achieving the cloud-hosted storage requirements.

---

## 2. Core Functional Requirements Compliance

Here is how the codebase maps to the **Specific Problems** (Page 4) and **Objectives** (Page 5):

### A. User Registration & Profile Management
*   **Specification (Page 5)**: *How can the customers and staff register and create accounts within the system?*
*   **Implementation**: Powered by **Supabase Auth** with full credential validation, profile setup screens, and email verification. Distinct user roles (`customer` and `admin/staff`) are managed in the `profiles` table.

### B. Product Catalog & Sorting
*   **Specification (Page 5)**: *How can a customer view the products and sort items per category?*
*   **Implementation**: Done via the main shop/explore dashboard where products are fetched from the `products` table and filtered using standard database relations with the `categories` table.

### C. Digital Wardrobe & Outfit Customization
*   **Specification (Page 68)**: *Allows customers to view available products on a digital wardrobe, match different outfits... randomize and customize.*
*   **Implementation**: Implemented in `app/outfit-builder.tsx` where users can view top/bottom clothing item selections, save outfit configurations to `saved_outfits`, and randomized matches.

### E. Voice-Guided Body Scan & Size Recommendations
*   **Specification (Page 70)**: *Uploading body measurements to have a suggested size that will match...*
*   **Implementation**: 
    *   **Auto-Capture & Guidance**: Leverages `expo-sensors` (Accelerometer) in `src/components/TiltGuide.tsx` to detect device orientation.
    *   **Text-to-Speech**: Integrated `expo-speech` in `app/profile/body-scan.tsx` to read out loud guiding commands ("Tilt phone down", "Hold steady") and auto-captures the frame when vertical parameters are held steady for 3 seconds.
    *   **Size Recommender**: Custom algorithm `src/utils/sizeRecommender.ts` uses user height/weight/chest/waist measurements from `user_measurements` to recommend an optimal size against product measurements.

### F. Augmented Reality (AR) Wear
*   **Specification (Page 68)**: *Allows customers to view and wear clothes virtually...*
*   **Implementation**: `app/ar-tryon/` integrates three-dimensional model rendering (3D `.glb` assets) to preview fits visually on mobile screens.

### G. Reservation & Downpayment Processing
*   **Specification (Page 68)**: *A reservation is also available for three (3) days with half-price downpayment...*
*   **Implementation**: 
    *   `app/reserve/[id].tsx` handles pickup scheduling.
    *   Calculates a **50% deposit requirement** dynamically based on product price.
    *   Prompts customers to upload a receipt of the downpayment, storing it securely in Supabase Storage (`payment_receipts`).
    *   Status begins as `Pending` awaiting administrator verification.

### H. Direct Messaging / Inquiry Module
*   **Specification (Page 74)**: *A registered user can also access her/his profile to have a direct message to admin for their queries.*
*   **Implementation**: Integrated real-time messaging using Supabase Realtime Channels. A "Message Seller" button on the product details page automatically creates or opens a conversation instance between the customer and shop administrators.

---

## 3. Database Schema Mapping
The actual database tables map directly to the **Figure 5.0 Entity Relationship Model** (Page 76):

| Thesis ERD Table | Codebase Database Table | Description |
| :--- | :--- | :--- |
| **USERS** | `profiles` | Stores user credentials, contact details, fit preference, and registration timestamps. |
| **PRODUCTS** | `products` | Holds catalog descriptors, sizes, materials, prices, sale rates, and 3D asset URLs. |
| **CATEGORIES** | `categories` | Handles catalog organization and parent/child hierarchy. |
| **RESERVATIONS** | `reservations` | Records fitting slot appointments, deposits, GCash receipt storage references, and statuses. |
| **FAVORITES** | `wishlists` | Associates users with their bookmarked product listings. |
| **INVENTORY** | `inventory` | Manages size-specific stocks, tracking available versus reserved quantities. |
| **CONVERSATIONS** | `conversations` / `messages` | Controls the real-time support channels between clients and staff. |
| **LOGS** | `logs` | Logs user activities and administrative status updates for auditing. |

---

## 4. ISO 25010 Compliance & Recent Usability Fixes
To align with the ISO 25010 "Usability" goals of your evaluation criteria, we audited and resolved usability constraints on critical CTAs (as specified in your `TODO.md` roadmap):

1.  **Accessibility Pass (Functional Suitability & Usability)**: Applied standard `accessibilityRole`, `accessibilityLabel`, `accessibilityHint`, and dynamic `accessibilityState` indicators to color/size swatches, back buttons, and checkout fields.
2.  **Date Gating (Reliability)**: Reinforced `app/checkout.tsx` to validate pickup date inputs (strictly expecting `YYYY-MM-DD` formats) and prevents button submission for invalid inputs.
3.  **Non-Blocking Feedback (User Experience)**: Removed blocking `alert` dialogs upon adding items to the bag, swapping them out for dynamic toast notices.

---

### Verification Status
*   **TypeScript check:** Passes compilation with no errors in the frontend app codebase.
*   **GitHub Status:** All changes committed and pushed to `main` branch.
