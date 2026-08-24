export type Objection = {
  id: string;
  triggerExamples: string[];
  category: string;
  approvedResponse: string;
  prohibitedClaims: string[];
};

const globalProhibitedClaims = [
  "fabricated customers",
  "fabricated statistics",
  "unsupported ROI claims",
  "legal interpretation",
  "unauthorized pricing",
  "invented capabilities"
] as const;

export const objectionLibrary = {
  version: "v1",
  prohibitedAcrossAllObjections: [...globalProhibitedClaims],
  objections: [
    {
      id: "already_have_system",
      triggerExamples: [
        "We already have a system",
        "We use SharePoint",
        "We track that in Excel"
      ],
      category: "existing_system",
      approvedResponse:
        "Totally fair. What are you using today? The reason Mathieu wanted feedback is that a lot of teams have something in place, but still get hit by the documentation scramble when a file is missing, expired, or sitting in the wrong place.",
      prohibitedClaims: [...globalProhibitedClaims]
    },
    {
      id: "handled_internally",
      triggerExamples: [
        "We handle this internally",
        "Our team already manages that",
        "We have someone for compliance"
      ],
      category: "internal_process",
      approvedResponse:
        "That makes sense. When an inspection happens, how do those documents usually surface — is it pretty clean, or is there still some digging? Either way, the 10 minutes with Mathieu is really just to see if this is relevant at all.",
      prohibitedClaims: [...globalProhibitedClaims]
    },
    {
      id: "not_priority",
      triggerExamples: [
        "Not a priority right now",
        "We're too busy",
        "Maybe later"
      ],
      category: "timing",
      approvedResponse:
        "I hear you. I do not want to push if the timing is wrong. Would it make more sense for Mathieu to send something brief by email, or should we try at a better time?",
      prohibitedClaims: [...globalProhibitedClaims]
    },
    {
      id: "no_budget",
      triggerExamples: [
        "No budget",
        "We are not buying anything",
        "We can't spend on this"
      ],
      category: "budget",
      approvedResponse:
        "Totally understand. This is not meant to be a sales close on the phone. It is just a short conversation with Mathieu to see whether the problem is relevant for you at all.",
      prohibitedClaims: [...globalProhibitedClaims, "pricing claims"]
    },
    {
      id: "who_are_you",
      triggerExamples: [
        "How did you get my number",
        "Who are you",
        "Is this sales"
      ],
      category: "identity_source",
      approvedResponse:
        "Fair question. I'm Mathieu's assistant with AxenOps. This is a brief field safety call, not a sales close. I just wanted to ask one or two quick questions and see if a 10-minute feedback call with Mathieu makes sense.",
      prohibitedClaims: [...globalProhibitedClaims, "defensive or evasive identity claims"]
    }
  ] satisfies Objection[]
} as const;
