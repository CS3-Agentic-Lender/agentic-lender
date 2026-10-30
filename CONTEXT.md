# Agentic Lender

A prototype mortgage and HELOC origination platform. This glossary holds the lending words the team uses the same way in every subsystem.

## Language

**Risk tier**:
A grade from A (lowest risk) to D (highest) worked out for each application from its numbers after every committee run. The committee's vote is never an input.
_Avoid_: Risk score, risk rating

**Concern**:
One of four findings that count against an application when grading its risk tier: the stressed debt-to-income is in the Caution band, the surplus is in the Caution band, the LTV is over 80%, or the price needs review or the model support is low.

**LTV band**:
Which range the LTV the underwriter judges the loan on falls in: 80% or less, over 80 up to 90%, or over 90%. Exactly 80% and exactly 90% fall in the lower band.
_Avoid_: LTV bracket, LTV bucket

**Price needs review**:
The asking price is further above the valuation estimate than the calibrated threshold allows. An application with no asking price (a HELOC) is never flagged.

**Low model support**:
The home falls outside what the valuation model was trained on, so its estimate is less reliable. A failed explanation of the estimate is not low support: the estimate itself is still sound. Counts as the same single concern as a price that needs review.
_Avoid_: Low confidence

**Combined LTV**:
For a HELOC, what is owed on the existing mortgage plus the new credit line, as a share of the home's estimated value.
_Avoid_: CLTV in prose (it is the name of a rule ID only)
