# 🧾 GLB File Checklist for AR Try‑On

This checklist defines the technical requirements for 3D garments (`.glb`) to be successfully rendered, rigged, and occluded within the AR Try-On pipeline.

### File Integrity
- [ ] Verify the `.glb` opens in a standard viewer (e.g., Babylon.js Sandbox, Three.js loader).
- [ ] Ensure no missing textures or broken references.

### Mesh Quality
- [ ] Garment mesh should be clean, manifold, and free of non‑manifold edges.
- [ ] Reasonable polygon count (optimized for real-time mobile/web rendering).

### Rigging / Skeleton
- [ ] Confirm the GLB contains a usable armature (bones/joints).
- [ ] Skeleton hierarchy should match or be retargetable to MediaPipe’s torso/arms (e.g., Mixamo standard rigs).
- [ ] Skin weights properly assigned (no unbound vertices).

### Scale & Orientation
- [ ] Model must be in meters, aligned to world axes.
- [ ] Origin/pivot must be at the garment center for predictable coordinate transforms.

### Materials & Textures
- [ ] Use PBR materials (baseColor, normal, roughness, metallic).
- [ ] Texture maps must be embedded or referenced correctly.
- [ ] Avoid oversized textures that bloat memory and slow down WebGL.

### Animation Data (Optional)
- [ ] If included, confirm animations are compatible (though skeletal retargeting will override them).
- [ ] Remove unnecessary baked animations to reduce file size.

### Performance Readiness
- [ ] File size ideally < 10 MB for web delivery.
- [ ] Compress textures (KTX2 / Basis) if possible.
- [ ] Test load time in Three.js to confirm smooth initialization without blocking the main thread.

### Compatibility Test
- [ ] Load into the Phase 4 Three.js + Skeletal Retargeter pipeline.
- [ ] Check bone retargeting mapping accurately tracks MediaPipe pose constraints.
- [ ] Verify segmentation + Body-Part Depth field occlusion produces correct depth-buffer layering.
