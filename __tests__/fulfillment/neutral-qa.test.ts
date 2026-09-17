import { decideNeutralQa } from "@/lib/fulfillment/neutral-qa"

const base = { decision:"approve" as const, minutesSpent:12, reasonCode:"QA_PASSED", reservationStatus:"PROMOTED", currentStatus:"PENDING", weeklyDecisions:0 }

describe("neutral report QA authority",()=>{
  it("approves only a promoted artifact inside the hard stop",()=>{
    expect(decideNeutralQa(base)).toEqual({ok:true,status:"APPROVED"})
    expect(decideNeutralQa({...base,reservationStatus:"STAGED"})).toEqual({ok:false,blocker:"ARTIFACT_NOT_PROMOTED"})
    expect(decideNeutralQa({...base,minutesSpent:21})).toEqual({ok:false,blocker:"QA_HARD_STOP"})
  })

  it("makes report unavailability durable refund work, not an automatic refund",()=>{
    expect(decideNeutralQa({...base,decision:"unavailable",reasonCode:"REPORT_INCOMPLETE"})).toEqual({ok:true,status:"REFUND_REQUIRED"})
  })

  it("enforces one decision and the weekly reviewer cap",()=>{
    expect(decideNeutralQa({...base,currentStatus:"APPROVED"})).toEqual({ok:false,blocker:"QA_ALREADY_DECIDED"})
    expect(decideNeutralQa({...base,weeklyDecisions:25})).toEqual({ok:false,blocker:"WEEKLY_REVIEW_LIMIT"})
  })

  it("rejects unbounded reason text and invalid time",()=>{
    expect(decideNeutralQa({...base,reasonCode:"customer@example.com"})).toEqual({ok:false,blocker:"INVALID_REASON"})
    expect(decideNeutralQa({...base,minutesSpent:1.5})).toEqual({ok:false,blocker:"QA_HARD_STOP"})
    expect(decideNeutralQa({...base,minutesSpent:0})).toEqual({ok:false,blocker:"QA_HARD_STOP"})
  })

  it("binds each disposition to an allowlisted reason",()=>{
    expect(decideNeutralQa({...base,decision:"approve",reasonCode:"OPERATOR_HOLD"})).toEqual({ok:false,blocker:"REASON_DECISION_MISMATCH"})
    expect(decideNeutralQa({...base,decision:"hold",reasonCode:"OPERATOR_HOLD"})).toEqual({ok:true,status:"HELD"})
    expect(decideNeutralQa({...base,decision:"unavailable",reasonCode:"HARD_STOP_EXCEEDED"})).toEqual({ok:true,status:"REFUND_REQUIRED"})
  })
})
