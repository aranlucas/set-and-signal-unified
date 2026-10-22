# Fivefold design revision — 22 October 2026

## Product constraints and direction

The user requested a simple 5×5 counter/log using the latest React Native, Expo UI only, native Android behavior, a tested APK, and a redesign inspired by current workout apps. This revision follows StrongLifts' focused straight-set counters and Strong/Hevy's dense previous-performance context. The user subsequently confirmed **StrongLifts-style focus** as the lead direction and **building directly in the native app** as the workflow. Strong and Hevy remain secondary references for density and previous-performance context. The workflow preference is saved as `buildPath: "code"` in `.impeccable/config.json`.

Use native Material controls, 16dp screen gutters, compact exercise sections, numbered 48dp set targets with 8dp gaps, Material type roles, a green seeded Material palette, and neutral tonal surfaces. Finish stays in the top app bar. Completed, partial, unlogged and next sets differ in text as well as color. Do not add motivational hero copy above working data.

Current public official screenshots are research references, not proof of the competitors' exact installed Android versions. See competitor-ui.md and the source manifest. Reference assets are not bundled into the app. Navigation XML uses Google's Material Symbols Rounded, Apache 2.0; the source paths are in the upstream material-design-icons symbols/android directory. Local changes remove theme resource references so Expo UI's runtime XML parser can tint the vectors; paths are otherwise unmodified.

## Review response

- The first independent review identified oversized slogans/cards, ambiguous corrections, a large timer, wrapping history and verbose settings. Replaced these with compact session chrome, an explicit rep sheet and Undo, a shorter persistent dock, aligned results, and native preference sheets.
- Competitor research independently examined 16 official image assets. Adopted direct weight editing, configured-increment shortcuts, previous results, a weekly calendar strip, lift records and dated weight history.
- A source regression review found missing current-value context in the rep editor and missing upcoming-set context in the rest dock. Both are implemented before native verification.
- Four labelled bottom destinations remain. This preserves clear access to native settings; the suggested three-tab arrangement is not required for the product flow.

## Verification boundaries

Only native installed-APK screenshots establish the redesign's rendered appearance. Capture light and dark, active and idle, history, progress, settings, rep editor, weight editor, and larger text. Unit tests validate progression and mixed-unit records; screenshots do not establish TalkBack or physical-device performance.
