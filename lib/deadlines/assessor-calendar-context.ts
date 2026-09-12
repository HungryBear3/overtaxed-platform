// Reader grammar, not a dated snapshot: any explanatory framing change requires review.
export const ASSESSOR_CONTEXT = [
  `Properties located in the south and west suburbs of Cook County are undergoing reassessment this year. When
a township "opens" property owners will receive a Reassessment Notice in the mail that contains important
information including the following: New estimated Fair Market Value of their property. The date on which a
township opens for appeal is listed below. A property owner has until the date listed under "last file date"
to file an appeal if they choose to do so. Note: Updated values take an additional business day to appear
online from the mail date. By law, the assessment roll must also be published in a print newspaper. The
"published" date refers to when the information will be available in the newspaper. The CCAO publishes
residential and commercial valuation reports for each township as they are reassessed. To access these
reports, click the button below, scroll to the bottom of the page, and locate your township. Valuation
Reports`,
  `Properties in the north suburbs & City of Chicago are not being reassessed this year. However, if an
individual property undergoes significant changes related to division work, permit applications, or other
special applications, then it may be reassessed. Under this circumstance, the property owner would receive a
Reassessment Notice containing the new estimated fair market value. Even though the townships listed below
are not scheduled to be reassessed in 2026, property owners still have an opportunity to file an appeal.
When a township opens, the appeal filing deadline will be listed below. Note: updated values take an
additional business day to appear online from the mail date. As townships are certified, updated values also
take an additional business day to appear online from the "Certified" date. By law, the assessment roll must
also be published in a print newspaper. The "published" date refers to when the information will be
available in the newspaper.`,
].map(value => value.replace(/\s+/g, " ").trim())
