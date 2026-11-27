# Test case: AL-348

**Story:** As an underwriter, I run the rate shock on a redesigned page with a 3D view of the portfolio

**Tested by:** Nikoloz Chilachava (recorded evidence)  
**Evidence cut-off:** 26 Nov 2026  
**Build:** origin/main at ebcfa88, except work marked open, in review.

## Preconditions

- Open merged rate shock as an underwriter.
- PR #286 browser preview used sample responses on emulators.

## Steps

| # | Criterion | Steps | Expected | Actual | Result |
|---|---|---|---|---|---|
| 1 | "All figures come from the rate-shock response; nothing is invented." | Compare tiles, towers and table against the rate-shock response. | Every displayed figure comes from the response. | PR #286 sample-response browser preview and scene-figure tests passed; towers/labels checked. Review 712a559 preserves true capped DTI. Separate review-fix browser re-test remains Not run. | Pass |
| 2 | "The slider, presets and buttons work by keyboard with visible focus." | Use keyboard on slider, presets, Reset, Recalculate and retry; inspect focus. | All controls keyboard usable with visible retained focus. | Origin/main uses native slider/buttons and focus-visible styling; review 712a559 retains focus. PR evidence covers controls but does not record a complete manual keyboard/focus run. 26 Nov browser check on main ebcfa88 (sample results, see Notes): Tab from the page heading reached the slider; ArrowRight moved it 200 to 225 bps, End to 300, Home to 100, and the page ran the new value once the slider stopped ("Showing +100 bps."). Tab reached +100, +200, +300, Recalculate and Reset in that order; Enter and Space ran the presets, Enter ran Recalculate and Reset (back to +200). With a failed result, Tab reached Try again and Enter re-ran it; focus then moved to Recalculate. Every focused control matched :focus-visible with a 3px light-brass outline on the dark panel. Evidence: evidence/1-keyboard-focus-visible.png. | Pass |
| 3 | "Text is at least 16px for body copy with 4.5:1 contrast; reduced motion turns animation off." | Measure body text and contrast; enable reduced motion. | At least 16px, 4.5:1 contrast, animation disabled. | Implementation contains text-base and reduced-motion handling. 26 Nov browser check on main ebcfa88: a script measured every visible text node on the page (109) at 1280px and 375px. Smallest font 16px. Lowest contrast 6.49:1 at 375px; at 1280px, where the control panel sits over the dark stage, the lowest enabled control text is 7.16:1 and the disabled-looking Reset is 5.40:1 (measured against the stage colour behind the panel). Reduced motion: the OS setting was not changed; instead `matchMedia('(prefers-reduced-motion: reduce)')` was made to match before the page opened. With normal motion the scene's frame requests kept rising (1, 37, 45, 55); with reduced motion they stopped at 36 once the towers were drawn at full height (32, 36, 36, 36). CSS animations under the real OS setting were not checked. Evidence: evidence/2-reduced-motion-towers-static.png. | Pass (reduced motion emulated in the page, not via the OS setting) |
| 4 | "It works at 375px wide with no horizontal scroll." | Open the rate-shock page at 375px and check horizontal overflow. | No horizontal scrolling. | 26 Nov browser check on main ebcfa88 at 375 x 812 (Chromium phone emulation): `document.documentElement.scrollWidth` stayed 375 at five scroll positions from top to bottom; no element inside the page runs past the right edge outside a scroll container; the slider, presets, Recalculate and Reset all sit within the width. Real phone not checked. Evidence: evidence/3-phone-375-no-horizontal-scroll.png. | Pass (Chromium, phone emulation) |
| 5 | "Loading, error and no-WebGL states render without breaking the controls." | Exercise loading, failed/empty result, absent WebGL and lost context. | Controls remain usable and states render. | PR #286 automated controls, empty-stage, failure, no-WebGL and lost-context checks passed; scene freeing/tower selection also tested. No successful hosted re-test recorded. 26 Nov browser check on main ebcfa88 (sample results; the sample service was made slow or to fail on purpose): loading showed "Calculating +100 bps…", skeleton placeholders and Recalculate/Reset marked unavailable, while the slider and presets still worked (choosing +300 mid-load ran +300). A failed run showed an alert ("The +100 bps rate shock could not be calculated", last result kept), the towers dropped and dimmed as designed, all controls stayed enabled and Try again recovered. With WebGL switched off in the page the stage shows "3D view unavailable — figures are in the table below.", the table and tiles still render, the +100 preset still ran, and there were no page errors. Lost context was not exercised in the browser. Evidence: evidence/4-loading-state.png, evidence/5-error-state-try-again.png, evidence/6-no-webgl-fallback.png. | Pass |
| 6 | "npm test and npm run build pass, and the page is checked in the browser." | Review recorded npm test/build and browser preview. | Tests/build pass and page checked in browser. | PR #286: 1048 tests; facts record 1054 after review 712a559. Unrelated admin timeouts pass alone; tsc/build/leak scan clean. Emulator sample preview checked; review-fix browser re-test Not run. | Pass |

## Automated test run

PR #286: npm test 1048 passed, then 1054 after 712a559 (facts). Unrelated admin timeouts pass alone. tsc -b, npm run build and betterleaks clean; three.js remains lazy.

## Notes

Merged 26 Nov, ebcfa88. Presentation uses the existing response. Parent Epic not supplied.

Rows 2 to 5 also carry new browser checks run on 26 Nov 2026 against main at ebcfa88 (Vite dev server, Firebase Auth and Firestore emulators with the seeded data, Chromium in the Claude desktop browser pane, signed in as the seeded underwriter). al-ai does not run locally, so for these checks the page was fed sample results: in a throwaway copy of main, `StressContext.tsx` returned `shockFixture(bps)` from `components/stress/rateShockFixture` (optionally delayed or made to fail) instead of calling al-ai. The sample uses fixed rates (4.00% to 6.00%) whatever the shock, so figures in these screenshots are sample data, not portfolio results. That copy was deleted afterwards and nothing was committed. The pane was not on screen, so animation frames ran only while a screenshot was being taken; the frame counts in row 3 come from those frames. Screenshots are in `evidence/`. The other rows are recorded checks, not new application test runs during submission preparation. Criterion wording is quoted from the supplied verbatim Jira acceptance-criteria file; results distinguish browser, preview, automated and code-audit evidence.

## Earlier grouped checks retained as evidence

These preserve the previously recorded results and unrun checks; their former row numbers were not Jira criterion numbers. They do not replace the criterion table above.

- **Controls** ? Steps: Read page and docked controls. Expected: Light page, dark stage, slider, presets, Recalculate and Reset. Actual: PR #286 records sample preview; tests cover controls. Recorded result: Pass (preview and automated).

- **Towers** ? Steps: Read towers and 40%/50% rings. Expected: After-rise DTI height; retain true labels when capped. Actual: Preview checked tallest-label clearance. Review fix 712a559 keeps true capped DTI and focus. Separate review-fix browser re-test not supplied. Recorded result: Pass (preview); review-fix browser re-test Not run.

- **Table link** ? Steps: Click a tower; read Every application. Expected: Scroll to and mark row; all figures available as text. Actual: PR #286 records click and scene-figure tests. Recorded result: Pass (automated).

- **Fallback** ? Steps: Remove WebGL or lose its context. Expected: Controls still work; show table fallback. Actual: RateShockStage.test.tsx covers both states. Recorded result: Pass (automated).

- **States** ? Steps: Leave the page; use empty or failed results. Expected: Free scene; show empty/error state. Actual: PR #286 records scene-freeing, empty-stage and failure tests. Recorded result: Pass (automated).

- **Hosted call** ? Steps: Run against live API. Expected: Successful authenticated calculation. Actual: No successful run supplied. Facts record localhost deployment fault; fix #288 open, in review. Recorded result: Fail (known deployment fault).
