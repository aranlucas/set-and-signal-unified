# Competitor UI research for Fivefold

Researched 2026-10-22 from official product pages, official help centres, and developer-supplied Google Play screenshots. **All 16 saved images were opened and visually inspected.** These are current publicly served reference assets, not captures of installed apps: asset age and exact shipping-version parity are unknown. Strong and StrongLifts images show Android chrome; Hevy’s phone images on Google Play show iPhone-style chrome. Hevy Android pixel parity therefore remains unverified. Enlarged rows, charts, ribbons, shadows, and annotations extending beyond phones are marketing composites, not literal in-app geometry.

## Recommended direction

**Build a calm, native Android 5×5 log: StrongLifts’ immediate planned workout and large set targets, with Strong/Hevy’s previous-performance context and clear editing.** Keep Fivefold’s scope around Train → log → rest → finish → review. Prioritize legibility, predictable alignment, and reachable controls over adding more dashboard content. Recommendations below are design judgments, not competitor observations.

## Observed visuals

### StrongLifts: decisive and sparse

- **Logging / density:** Three exercise blocks fit together: name at left, red `5×5 45lb` summary and chevron at right, five large numbered circles beneath. Red filled circles versus pale pending circles make progress legible. Workout/Warmup tabs separate modes. This is lower density than a per-set table, well suited to repeated straight sets. [Logging image][sl2]
- **Timer:** A dark bottom panel shows `1:45`, `Rest 3min`, a close icon, and a thin red progress track; it preserves the exercise overview. The panel is enlarged in the promotional composition, so its exact installed position/size is not established. [Logging image][sl2]
- **Navigation / start:** A “Next Workout” card shows date, A/B selector, all three prescriptions, and a wide red Start Workout action, followed by upcoming sessions. Active workout has a collapse chevron; Finish appears in another logging image. Full global navigation is cropped out. [Next workout][sl1], [plate view][sl7]
- **Prior sets / quick weight changes:** The visible log shows current prescriptions and current-session completion, not a dedicated previous-session column. Weight summaries have chevrons; another image explicitly connects the weight summary to a plate breakdown with per-side loading. A weight-entry keyboard is not pictured here. [Logging][sl2], [plate view][sl7]
- **Progress / history:** Exercise-specific line/area charts have point markers, numeric axes, and `1M / 3M / 6M / 1Y / 2Y / ∞` ranges. History has List/Calendar/Notes tabs; completed dates are filled red circles. The selected image shows the calendar, not the list contents. [Charts][sl3], [history][sl6]

### Strong: a dense working notebook

- **Logging / prior sets:** A compact `SET | PREVIOUS | KG | REPS | ✓` table sits beneath the exercise title and notes. Previous values remain in the same row as today’s values. Warmups use `W`; completed rows have green backgrounds and checks. Dark and light variants retain the same hierarchy. [Dark log][st1], [light log][st2]
- **Quick editing / timer:** The light screenshot shows a focused `82.5` weight field, adjacent reps field, custom numeric keyboard with Next, and plate calculator. A blue countdown bar sits between set rows, with rest-duration labels beneath. Top chrome contains elapsed time, timer icon, collapse, and Finish. This gives more set detail than StrongLifts but consumes more vertical space, especially with notes and keyboard open. [Editing image][st2]
- **Navigation:** Five labelled bottom destinations: Profile, History, Workout, Exercises, Measure. Workout provides a prominent empty-workout action and templates grouped into folders. Exercise detail has About/History/Charts/Records tabs. [Templates][st5], [exercise detail][st3]
- **Progress / history:** Profile combines workouts-per-week bars with exercise trend cards; the enlarged bench chart labels estimated 1RM and uses dates and kg. History is a visible destination and an exercise tab; the saved examples do not establish the full workout-history list layout. [Progress][st4], [exercise detail][st3]

### Hevy: readable tables with more context

- **Logging / density:** The log has a Time/Volume/Sets summary, exercise thumbnail/title, notes, rest-duration link, and `SETS | PREVIOUS | KG | REPS | ✓` rows. Completed rows are green; pending rows are muted; Add Set spans the exercise width. This uses more header space than Strong’s table. Bright floating rows in the store image are promotional emphasis. [Log][hv2]
- **Navigation:** The official help screenshot shows three bottom destinations: Home, Workout, Profile. Workout offers Start Empty Workout, New Routine, Explore, and routine cards with Start Routine. The active log has collapse, timer, and Finish controls. This evidence is iOS-style, including the help image. [Help screenshot][hvhelp], [routine screen][hv4]
- **Progress / history:** A Heaviest Weight chart uses blue point markers and explicit kg/date axes, with selectors for other metrics. The official product image shows Summary/History/How to exercise tabs. Chart and PR ribbon are enlarged outside the phone; do not copy that composition as an installed screen. The history tab’s contents are not shown. [Store chart][hv3], [official progress image][hvprogress]
- **Prior sets / weight editing / timer:** Previous values sit directly beside current weights/reps; the help screenshot also shows an RPE column. Rest Timer is a visible exercise-level link. These phone assets do not demonstrate the weight keyboard or an active rest-countdown layout. [Log][hv2], [help screenshot][hvhelp]

## Documented or advertised features — separate from visual evidence

- **StrongLifts:** Official help documents tapping the exercise weight to edit it, a keyboard with deload and ±5lb shortcuts, and plate breakdown. Separate documentation describes automatic increases after successful sets, repeating incomplete weights, and configurable deloads. These behaviors were not interactively tested. [Weight editing](https://support.stronglifts.com/article/8-change-weight), [progression](https://support.stronglifts.com/article/71-progression)
- **Strong:** Google Play advertises supersets, set types, notes, volume/1RM graphs, warmup/plate calculators, and export. Help documents automatic rest timers, full-screen adjustment/Skip, and separate warmup/working-set durations. The pictured inline timer and the help article’s top-left/full-screen description differ; treat exact timer presentation as version-dependent. [Android listing](https://play.google.com/store/apps/details?id=io.strongapp.strong), [timer help](https://help.strongapp.io/article/231-rest-timer)
- **Hevy:** Official pages advertise routine planning, exercise history, personal records, social features, and automatic timers. Help confirms per-exercise rest duration and automatic start on completion. The saved feature panel advertises plate calculation, RPE, four set types, and dark mode; it is a feature graphic rather than UI proof. [Product](https://www.hevyapp.com/), [timer help](https://help.hevyapp.com/hc/en-us/articles/35385404949143-Rest-Timer-Default-Rest-Timer-How-to-Add-Adjust-Volume-and-Sound), [feature graphic][hv8]

## Focused Fivefold implementation brief

1. **Train first:** A single next-session card with A/B, three lifts, weight × sets × reps, last performed date, and one Start action. During a workout, replace the large motivational heading with a compact session bar, elapsed time, sets completed, and Finish.
2. **One exercise section, clear state:** Name and tappable weight summary above large set targets. Show a secondary `Last: 5/5/5/5/5 at 60 kg` line. For this fixed program, circles preserve speed; expose exact reps in a small editor when correcting a set. Completion should use a check/state label as well as color. Avoid silently turning repeated taps into failures.
3. **Immediate weight editing:** Tap the visible weight → bottom sheet with selected decimal input, unit, decrement/increment by the configured step, plate breakdown, and explicit Apply. Label whether the change affects today, the next workout, or both. Preserve existing completed sets. Keep routine/program settings behind a secondary action.
4. **Rest in context:** A persistent bottom strip with countdown, progress, `−30s`, `+30s`, Skip, and exercise/rest label. Start after a completed set; keep it visible across scrolling and keyboard transitions. Timer persistence and background alerts need application logic, not just a progress component.
5. **History + progress that answer a question:** History rows show date, A/B, completion and lift summaries, opening the exact set record. Progress shows one lift and one metric at a time, 1M/3M/All ranges, labelled units/dates, latest/best values, and access to the source session. Include empty and single-session states.
6. **Native visual system:** Use consistent 16dp screen gutters, a restrained 8dp spacing rhythm, 48dp interactive targets, strong numeric type, subtle surface boundaries, and one brand accent. Reserve success color for completion. Keep density in workout data; move explanations and secondary tools out of the active log. Support larger text without squeezing five targets off-screen.

### Feasibility with installed @expo/ui

The repository declares `@expo/ui ~58.0.22`; its installed Compose exports include `Host`, `TopAppBar`, `NavigationBar`, `LazyColumn`, `Row`, `Column`, `Card`, `Surface`, `IconButton`, `ModalBottomSheet`, `SegmentedButton`, `TextField`/`BasicTextField`, and progress indicators. Use these for the structure above. Native inputs expose decimal/number keyboards, Next/Done actions, focus, and text selection, supporting fast weight entry. [Expo Compose docs](https://docs.expo.dev/versions/latest/sdk/ui/jetpack-compose/); local API evidence: `node_modules/@expo/ui/src/jetpack-compose/index.ts` and `TextField/shared.ts`.

Compose’s installed export list has no chart component. Budget a small custom native Compose chart or a separately chosen renderer hosted through `RNHostView`; do not assume the SwiftUI Chart API works on Android. Start with an accessible value/history list while implementing a real labelled chart. The proposed 3 primary destinations are **Train / History / Progress**, with Settings in an app-bar action. This is a Fivefold recommendation, not a claim about any competitor’s full navigation.

## Saved reference index

Assets are unmodified official downloads at up to 1200px requested width. Some originals are smaller. The manifest records exact requested image URL, referring page, retrieval date, dimensions and SHA-256. Assets remain the respective owners’ copyrighted material and are reference-only.

- **StrongLifts:** [stronglifts-google-play-01](references/stronglifts-google-play-01.png), [stronglifts-google-play-02](references/stronglifts-google-play-02.png), [stronglifts-google-play-03](references/stronglifts-google-play-03.png), [stronglifts-google-play-06](references/stronglifts-google-play-06.png), [stronglifts-google-play-07](references/stronglifts-google-play-07.png)
- **Strong:** [strong-google-play-01](references/strong-google-play-01.png), [strong-google-play-02](references/strong-google-play-02.png), [strong-google-play-03](references/strong-google-play-03.png), [strong-google-play-04](references/strong-google-play-04.png), [strong-google-play-05](references/strong-google-play-05.png)
- **Hevy:** [hevy-google-play-02](references/hevy-google-play-02.png), [hevy-google-play-03](references/hevy-google-play-03.png), [hevy-google-play-04](references/hevy-google-play-04.png), [hevy-google-play-08](references/hevy-google-play-08.png), [hevy-official-progress](references/hevy-official-progress.png), [hevy-help-start-workout](references/hevy-help-start-workout.png)

[Source manifest](references/sources.json). Exact image citations:

[sl1]: https://play-lh.googleusercontent.com/sNVqGXSTUOExmV7FV3J9aoJnSvPHPyWdSF-kE18ONvrfevOkUgdBLE_X6DJyxXmYOWw5vE0_KUzngNiesJmy=w1200
[sl2]: https://play-lh.googleusercontent.com/A2gPdBTl9K_4HFt3xOHk40XJZO_DAzgmEtg0hRRJytPU_1mowWuW-fDvb7Xt92fcysjAviwEgopJ7JEwd5PA5Q=w1200
[sl3]: https://play-lh.googleusercontent.com/yMB5f5_8Z7-SlAkYvtHoxAZegz-WYWUIz315jwcL5mhW59xuv31ic3wEL-vyWwjByGyJ0nKKB-hT4SUmI3mLJA=w1200
[sl6]: https://play-lh.googleusercontent.com/3u4i58FmCrAkxpv10j79u8V_rwMzTuXlnZ9mQ3z-l0kaF5_7Uya1wlsXsBVOdvnRc2CHQt09Cl5AtIVB1J3s_Qs=w1200
[sl7]: https://play-lh.googleusercontent.com/unJn9ZtEKufWFebj_vO5iCpgii7gk9Lr4tRqo7-TBrS796cfSL4168ZbDZkYyQSChOOxPTNHOmNM9Y706m1VSA=w1200
[st1]: https://play-lh.googleusercontent.com/_diyWJGK0Fdrv5aA6hMpqY7x_1RxQMNhRiAJu4s2j2aJ7Yy_lucc7eMq5yWU4ParyjuapEo2-EU0GIQBq6YZtHY=w1200
[st2]: https://play-lh.googleusercontent.com/dDlbHBPSFcUXevwgEIjxAA6-zGlXiEbqge_9T0vbQzV0AsUkYFCn4VELuMvJXLjaYF7tmpudOY8KUrzGsrRmGg=w1200
[st3]: https://play-lh.googleusercontent.com/VU4WWCzlwrWKtBabcttfk9wc6O00BHz9k8aCUu2Rk9G4PPL6c3avx40gPe5XV4nRSV_q-VokbspBDnPSPy5NEQ=w1200
[st4]: https://play-lh.googleusercontent.com/Simc1cH9npsjkCop7vRY9UJPqtfrGKrsyypIZiDh-LArOdK-017q1pOcE2OoEYFy5PSnprtOr6P-gchTIqGD=w1200
[st5]: https://play-lh.googleusercontent.com/sIiwco_0w52BVMCafpGRXb3Yr-hwOdJqYGZwgdrys7kAAQtFBl0wgqFKaF38sctfn_WW_RPCzp1R6FGH9078jA=w1200
[hv2]: https://play-lh.googleusercontent.com/dl-2sqzqV3GbXir4YNAidot3n6H5iDYrIy-0xY8aVAibWjKwzuvzi8FuIAHzHe7H6anPFVvAPfQQQrPlbT6vfg=w1200
[hv3]: https://play-lh.googleusercontent.com/j3d0gGip2qXk2fsnuBqrtqTQ-ZlGhEkOccdKvVT3hImIwZHnk1lfxU3ScXuoU3QKcPN0lR7alVhVZPSkgwDfsQ=w1200
[hv4]: https://play-lh.googleusercontent.com/z3XEkPIdhm67z5MoqYVoPydljz_Lg9gDAJ-eVC8bVPZvDQN0o4NapWHPvBVIGgrRAtNUgAThNF-iAru-1aYK6A=w1200
[hv8]: https://play-lh.googleusercontent.com/NCb0KnVIYO1ErLh1ciMCukHcnL86OPsxwiFZ2FqdMMw2PZ4JHXmZkXrnu9WwlB0KBJdNi2oKMosOA-TEyF68bw=w1200
[hvprogress]: https://www.hevyapp.com/wp-content/uploads/image-4-1-768x785.png
[hvhelp]: https://help.hevyapp.com/hc/article_attachments/35388406647703
