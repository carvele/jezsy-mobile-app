# Jezsy Mobile App — Capstone Defense & Free-Tier Audit

## Overview
This document outlines the architectural decisions and technology choices made for the Jezsy Mobile App capstone project. A primary constraint for this academic project was a strict **$0 budget** for production, meaning all features had to be implemented using free-tier services, open-source libraries, and on-device processing.

## 1. Backend & Infrastructure: Supabase
We selected **Supabase** as the backend-as-a-service (BaaS) due to its generous free tier which covers all our capstone requirements:
- **Database (PostgreSQL):** Free tier includes up to 500MB of database space. This is more than sufficient for storing user profiles, product catalogs, wardrobe items, and saved outfits.
- **Storage:** Free tier provides 1GB of storage space. We optimized image uploads (e.g., resizing before upload) to ensure wardrobe item photos fit well within this limit. We configured public read access and authenticated write access (RLS) to manage assets securely.
- **Authentication:** Supabase Auth easily handles up to 50,000 monthly active users (MAU) on the free tier, well beyond our demo requirements.

## 2. Digital Wardrobe & Background Removal
A core feature of the digital wardrobe is removing the background from user-uploaded clothing photos. 
- **The Challenge:** Cloud-based API services for background removal (like remove.bg or Photoroom) charge per image or require paid subscriptions.
- **The Solution (On-Device Processing):** We integrated `@six33/react-native-bg-removal`. This library uses on-device Machine Learning (MLKit/Vision) to extract the foreground of an image *locally on the user's phone*. 
- **Outcome:** $0 cost per image, complete offline capability, and enhanced user privacy since raw photos never leave the device to be processed.

## 3. Outfit Builder & Color Harmony Engine
To help users build outfits, we implemented a Color Harmony engine.
- **The Challenge:** Calling LLMs (like OpenAI GPT-4 Vision) to analyze outfits for fashion compatibility incurs API costs per request.
- **The Solution (Rule-Based Engine):** We built `colorMatcher.ts`, a pure JavaScript utility that uses traditional fashion color theory. It extracts color tags from selected items and applies predefined rules (Complementary, Analogous, Neutral Balancing, and Clashing Metals).
- **Outcome:** The outfit compatibility score calculates instantly on the device, requires zero network requests, and costs nothing, providing immediate feedback without server overhead.

## 4. Body Scan & AR Try-On
The AR try-on and body measurement scan required creative workarounds to avoid enterprise AR SDK licensing.
- **The Challenge:** Professional AR tracking SDKs or cloud-based virtual try-on ML models (like VTO APIs) are highly expensive and rarely offer robust free tiers.
- **The Solution (Sensor Fusion & 2D Overlays):** 
  - **Body Scan Guidance:** Instead of relying on a heavyweight ML pose-estimation model that might bloat the app size or crash older devices, we utilized `expo-sensors`. The `TiltGuide` component reads the device's hardware accelerometer to ensure the phone is held perfectly vertical before allowing a capture. We overlay a CSS-based dashed silhouette to guide the user's position physically.
  - **AR Try-On:** We implemented a two-pronged approach. First, we use `model-viewer` in a WebView to render `.glb`/`.usdz` 3D files using standard WebXR, which requires no native SDKs. Second, for items without 3D models, we built a **2D Static Camera Overlay**. It feeds the live front-facing camera into the UI and renders a transparent 2D image of the product on top.
- **Outcome:** We achieve an "AR-like" experience that fulfills the capstone requirement for virtual try-on, running efficiently on-device at no cost.

## Conclusion
By aggressively pushing computation to the edge (on-device background removal, local color theory algorithms, sensor-based guides), the Jezsy Mobile App demonstrates a highly scalable and cost-effective mobile architecture. All project features function smoothly within a completely $0 free-tier stack.
