# QueueForge 3D asset authoring

`author_attestation_forge.py` creates the original QueueForge Attestation Forge from Blender-native geometry and materials. It does not embed third-party models, textures, HDRIs, or fonts.

Run it with Blender 4.5 or newer from the repository root:

```powershell
blender --background --factory-startup `
  --python tools/queueforge-3d/author_attestation_forge.py -- `
  --glb apps/web/public/3d/queueforge/attestation-forge-v1.glb `
  --blend tools/queueforge-3d/source/attestation-forge-v1.blend `
  --poster apps/web/public/3d/queueforge/attestation-forge-poster.webp `
  --preview output/blender/attestation-forge-authoring/attestation-forge-preview.png
```

The `.blend` file is the editable source and stays outside the public web directory. The GLB is the web runtime asset, and the WebP poster is rendered from the same model for constrained-device and reduced-motion fallbacks. The temporary PNG is intentionally kept outside shipped application assets.

The exported GLB uses the `QF_*` node/material namespace and contains one 12-second animation named `ProofCycle`.
