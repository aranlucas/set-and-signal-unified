# Fivefold 1.2.1 phone captures

Captured on 22 October 2026 from the signed release APK on Pixel_API_35 (Android 15). [captures.json](captures.json) records the APK hash, image dimensions and checksums. Workout data is synthetic and was created by the installed-app E2E fixture.

These are complete device viewports, not stitched full-page images. Consistency and weight-history captures intentionally show scrolled sections.

- `history-light.png`, `history-filter-b-light.png`, `progress-light.png`, `consistency-light.png`, `weight-history-light.png`: normal-text training history, filters and progress.
- `history-dark.png`, `progress-dark.png`: system dark appearance.
- `train-font150.png`, `history-font150.png`, `progress-font150.png`, `consistency-font150.png`: Android font scale 1.5, portrait.
- `finish-font150.png`: full finish preview at font scale 1.5 in portrait.
- `finish-landscape-font150-top.png`, `finish-landscape-font150-bottom.png`: the same preview in landscape, before and after scrolling the body. Cancel and Save workout remain in fixed native action slots.

Independent Impeccable finish review: **`disposition: ship`**, with no material fixes. The review inspected all 14 images and matched their dimensions and hashes to the manifest. See [the review record](../../../docs/design/roadmap-review.md) for scope and limitations.
